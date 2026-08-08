"""Match a job description to indexed resume candidates.

This module loads the existing Chroma resume index created by resume_rag.py and
returns candidate-level matches. It does not rebuild the index and does not use
an LLM; scoring and reasoning are deterministic heuristics intended for a
learning assignment and later notebook tuning.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from typing import Any

from resume_rag import (
    COLLECTION_NAME,
    DEFAULT_PERSIST_DIR,
    EMBEDDING_MODEL,
    _get_chroma_class,
    _get_embedding_class,
)


DEFAULT_TOP_K_CANDIDATES = 10
DEFAULT_RETRIEVAL_K = 40
MAX_EXCERPTS_PER_CANDIDATE = 3

SEMANTIC_WEIGHT = 0.50
SKILL_WEIGHT = 0.35
EXPERIENCE_WEIGHT = 0.15

SKILL_ALIASES = {
    "Python": ["Python"],
    "Java": ["Java"],
    "Spring Boot": ["Spring Boot"],
    "JavaScript": ["JavaScript", "JS"],
    "TypeScript": ["TypeScript", "TS"],
    "React": ["React", "React.js", "ReactJS"],
    "Node.js": ["Node.js", "NodeJS", "Node"],
    "FastAPI": ["FastAPI"],
    "Django": ["Django"],
    "Flask": ["Flask"],
    "Go": ["Go", "Golang"],
    "SQL": ["SQL"],
    "PostgreSQL": ["PostgreSQL", "Postgres"],
    "MySQL": ["MySQL"],
    "Redis": ["Redis"],
    "MongoDB": ["MongoDB"],
    "AWS": ["AWS", "Amazon Web Services"],
    "Azure": ["Azure"],
    "GCP": ["GCP", "Google Cloud"],
    "Docker": ["Docker"],
    "Kubernetes": ["Kubernetes", "K8s"],
    "Terraform": ["Terraform"],
    "Ansible": ["Ansible"],
    "Kafka": ["Kafka", "Apache Kafka"],
    "Spark": ["Spark", "Apache Spark"],
    "Airflow": ["Airflow"],
    "Machine Learning": ["Machine Learning", "ML"],
    "PyTorch": ["PyTorch"],
    "TensorFlow": ["TensorFlow"],
    "scikit-learn": ["scikit-learn", "sklearn"],
    "Pandas": ["Pandas"],
    "NumPy": ["NumPy"],
    "CI/CD": ["CI/CD", "CI CD", "CI-CD"],
    "REST APIs": ["REST API", "REST APIs", "RESTful"],
    "Microservices": ["Microservices", "Microservice"],
}


def match_job_description(
    job_description: str,
    top_k_candidates: int = DEFAULT_TOP_K_CANDIDATES,
    retrieval_k: int = DEFAULT_RETRIEVAL_K,
    persist_dir: str = DEFAULT_PERSIST_DIR,
) -> dict:
    """Return top candidate matches for a job description.

    More chunks are retrieved than final candidates because several strong
    chunks can belong to the same resume. The retrieved chunks are grouped by
    candidate before scoring so the final output is resume-level, not chunk-level.
    """
    job_description = (job_description or "").strip()
    if not job_description:
        return _error("empty_job_description", "Job description must not be empty.")

    top_k_candidates = max(1, int(top_k_candidates))
    retrieval_k = max(1, int(retrieval_k), top_k_candidates)

    if not _persisted_chroma_exists(persist_dir):
        return _error(
            "missing_chroma_database",
            f"Chroma database not found at: {os.path.abspath(persist_dir)}",
            job_description,
        )

    job_requirements = extract_job_requirements(job_description)

    try:
        vector_store = _load_vector_store(persist_dir)
        retrieved_chunks = _retrieve_chunks(vector_store, job_description, retrieval_k)
    except Exception as exc:
        return _error(
            "retrieval_failure",
            f"Failed to retrieve resume chunks: {exc}",
            job_description,
        )

    if not retrieved_chunks:
        return _error(
            "no_matching_candidates",
            "No matching resume chunks were found.",
            job_description,
        )

    candidates = _aggregate_candidates(retrieved_chunks)
    if not candidates:
        return _error(
            "no_matching_candidates",
            "Retrieved chunks did not contain candidate metadata.",
            job_description,
        )

    scored_candidates = [
        _score_candidate(candidate, job_requirements) for candidate in candidates.values()
    ]

    # Failing explicit must-have requirements does not silently discard a
    # candidate. Eligible candidates are sorted first, then score is used.
    scored_candidates.sort(
        key=lambda candidate: (candidate["_eligible"], candidate["match_score"]),
        reverse=True,
    )

    return {
        "success": True,
        "error": None,
        "message": "Job matching completed successfully.",
        "job_description": job_description,
        "top_matches": [
            _public_candidate(candidate)
            for candidate in scored_candidates[:top_k_candidates]
        ],
    }


def extract_job_requirements(job_description: str) -> dict:
    """Extract deterministic skills and simple must-have requirements."""
    skills = [
        skill
        for skill, aliases in SKILL_ALIASES.items()
        if _contains_any_alias(job_description, aliases)
    ]
    skills = _dedupe(skills)

    min_experience_years = _extract_min_experience_years(job_description)

    return {
        "skills": skills,
        # For this assignment matcher, every known skill identified in the JD
        # is treated as a must-have requirement. matched_skills remains separate
        # evidence; passed/failed requirements are validation.
        "required_skills": skills,
        "min_experience_years": min_experience_years,
    }


def _load_vector_store(persist_dir: str):
    HuggingFaceEmbeddings = _get_embedding_class()
    Chroma = _get_chroma_class()
    try:
        embeddings = HuggingFaceEmbeddings(
            model_name=EMBEDDING_MODEL, show_progress=False
        )
    except TypeError:
        embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    return Chroma(
        collection_name=COLLECTION_NAME,
        embedding_function=embeddings,
        persist_directory=persist_dir,
    )


def _retrieve_chunks(vector_store, query: str, retrieval_k: int) -> list[dict]:
    try:
        results = vector_store.similarity_search_with_score(query, k=retrieval_k)
        return [
            {
                "text": document.page_content,
                "metadata": document.metadata or {},
                "relevance": _distance_to_relevance(score),
            }
            for document, score in results
        ]
    except Exception:
        # Some LangChain vector stores expose normalized relevance rather than
        # raw distance. Use it when distance retrieval is unavailable.
        results = vector_store.similarity_search_with_relevance_scores(
            query, k=retrieval_k
        )
        return [
            {
                "text": document.page_content,
                "metadata": document.metadata or {},
                "relevance": _clamp_float(score, 0.0, 1.0),
            }
            for document, score in results
        ]


def _aggregate_candidates(chunks: list[dict]) -> dict[str, dict]:
    candidates: dict[str, dict] = {}

    for chunk in chunks:
        metadata = chunk["metadata"]
        resume_path = metadata.get("resume_path")
        candidate_name = metadata.get("candidate_name") or "Unknown Candidate"
        if not resume_path:
            continue

        candidate_key = resume_path
        candidate = candidates.setdefault(
            candidate_key,
            {
                "candidate_name": candidate_name,
                "resume_path": resume_path,
                "sections": set(),
                "chunks": [],
                "skills_text": "",
                "experience_years": 0,
            },
        )

        candidate["sections"].add(metadata.get("section", "unknown"))
        candidate["chunks"].append(chunk)
        candidate["skills_text"] = _longer_text(
            candidate["skills_text"], metadata.get("skills", "")
        )
        candidate["experience_years"] = max(
            candidate["experience_years"], _safe_int(metadata.get("experience_years"))
        )

    for candidate in candidates.values():
        candidate["chunks"].sort(key=lambda chunk: chunk["relevance"], reverse=True)

    return candidates


def _score_candidate(candidate: dict, job_requirements: dict) -> dict:
    candidate_text = " ".join(
        [candidate.get("skills_text", "")]
        + [chunk["text"] for chunk in candidate["chunks"]]
    )
    job_skills = job_requirements["skills"]
    matched_skills = [
        skill
        for skill in job_skills
        if _contains_any_alias(candidate_text, SKILL_ALIASES[skill])
    ]

    top_relevance = candidate["chunks"][0]["relevance"] if candidate["chunks"] else 0
    average_relevance = _average(
        [chunk["relevance"] for chunk in candidate["chunks"][:MAX_EXCERPTS_PER_CANDIDATE]]
    )
    semantic_score = (0.7 * top_relevance + 0.3 * average_relevance) * 100

    skill_score = (
        (len(matched_skills) / len(job_skills)) * 100 if job_skills else 50
    )

    experience_score = _experience_score(
        candidate["experience_years"], job_requirements["min_experience_years"]
    )

    match_score = round(
        (SEMANTIC_WEIGHT * semantic_score)
        + (SKILL_WEIGHT * skill_score)
        + (EXPERIENCE_WEIGHT * experience_score)
    )
    match_score = int(_clamp_float(match_score, 0, 100))

    passed_requirements, failed_requirements = _evaluate_requirements(
        candidate, matched_skills, job_requirements
    )
    eligible = not failed_requirements

    return {
        **candidate,
        "match_score": match_score,
        "matched_skills": matched_skills,
        "semantic_score": round(semantic_score, 1),
        "skill_score": round(skill_score, 1),
        "experience_score": round(experience_score, 1),
        "passed_requirements": passed_requirements,
        "failed_requirements": failed_requirements,
        "_eligible": eligible,
        "reasoning": _build_reasoning(
            candidate,
            job_requirements,
            matched_skills,
            passed_requirements,
            failed_requirements,
        ),
    }


def _evaluate_requirements(
    candidate: dict, matched_skills: list[str], job_requirements: dict
) -> tuple[list[str], list[str]]:
    passed = []
    failed = []

    for skill in job_requirements["required_skills"]:
        requirement = f"Skill: {skill}"
        if skill in matched_skills:
            passed.append(requirement)
        else:
            failed.append(requirement)

    min_years = job_requirements["min_experience_years"]
    if min_years is not None:
        candidate_years = candidate["experience_years"]
        requirement = f"Minimum experience: {min_years}+ years"
        if candidate_years >= min_years:
            passed.append(requirement)
        else:
            failed.append(
                f"{requirement} (candidate metadata: {candidate_years} years)"
            )

    return passed, failed


def _experience_score(candidate_years: int, min_years: int | None) -> float:
    if min_years is None:
        return 100.0
    if candidate_years <= 0:
        return 0.0
    if candidate_years >= min_years:
        return 100.0
    return (candidate_years / min_years) * 100


def _build_reasoning(
    candidate: dict,
    job_requirements: dict,
    matched_skills: list[str],
    passed_requirements: list[str],
    failed_requirements: list[str],
) -> str:
    skill_total = len(job_requirements["skills"])
    parts = [
        "Semantic retrieval found relevant resume sections: "
        + ", ".join(sorted(candidate["sections"]))
        + "."
    ]

    if skill_total:
        examples = ", ".join(matched_skills[:5]) if matched_skills else "none"
        parts.append(
            f"Matched {len(matched_skills)} of {skill_total} identified skills"
            f" including {examples}."
        )
    else:
        parts.append("No known technical skills were confidently extracted from the JD.")

    min_years = job_requirements["min_experience_years"]
    if min_years is not None:
        parts.append(
            f"Candidate has {candidate['experience_years']} years of experience "
            f"against the {min_years}+ year requirement."
        )

    if failed_requirements:
        parts.append("Failed explicit must-have checks: " + "; ".join(failed_requirements) + ".")
    elif passed_requirements:
        parts.append("Meets explicit must-have checks.")

    return " ".join(parts)


def _public_candidate(candidate: dict) -> dict:
    return {
        "candidate_name": candidate["candidate_name"],
        "resume_path": candidate["resume_path"],
        "match_score": candidate["match_score"],
        "matched_skills": candidate["matched_skills"],
        "relevant_excerpts": [
            _truncate(chunk["text"]) for chunk in candidate["chunks"][:MAX_EXCERPTS_PER_CANDIDATE]
        ],
        "reasoning": candidate["reasoning"],
        "eligible": candidate["_eligible"],
        "passed_requirements": candidate["passed_requirements"],
        "failed_requirements": candidate["failed_requirements"],
    }


def _persisted_chroma_exists(persist_dir: str) -> bool:
    return os.path.isdir(persist_dir) and (
        os.path.exists(os.path.join(persist_dir, "chroma.sqlite3"))
        or bool(os.listdir(persist_dir))
    )


def _extract_min_experience_years(text: str) -> int | None:
    patterns = [
        r"\b(\d{1,2})\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience\b",
        r"\b(?:minimum|at least)\s+(\d{1,2})\+?\s*(?:years?|yrs?)\b",
    ]
    years = []
    for pattern in patterns:
        years.extend(
            int(match.group(1)) for match in re.finditer(pattern, text, re.IGNORECASE)
        )
    return max(years) if years else None


def _contains_any_alias(text: str, aliases: list[str]) -> bool:
    return any(_contains_phrase(text, alias) for alias in aliases)


def _contains_phrase(text: str, phrase: str) -> bool:
    escaped = re.escape(phrase).replace(r"\ ", r"\s+")
    return bool(re.search(rf"(?<!\w){escaped}(?!\w)", text, re.IGNORECASE))


def _dedupe(values: list[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        key = value.lower()
        if key not in seen:
            seen.add(key)
            result.append(value)
    return result


def _distance_to_relevance(distance: float) -> float:
    try:
        distance = float(distance)
    except (TypeError, ValueError):
        return 0.0
    return 1 / (1 + max(distance, 0.0))


def _average(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _longer_text(current: str, new: str) -> str:
    return new if len(new or "") > len(current or "") else current


def _clamp_float(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, float(value)))


def _truncate(text: str, max_chars: int = 500) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3].rstrip() + "..."


def _error(code: str, message: str, job_description: str = "") -> dict:
    return {
        "success": False,
        "error": {"code": code, "message": message},
        "message": message,
        "job_description": job_description,
        "top_matches": [],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Match a job description to resumes.")
    parser.add_argument("job_description", help="Job description text to search for.")
    parser.add_argument(
        "--top-k",
        type=int,
        default=DEFAULT_TOP_K_CANDIDATES,
        help="Number of candidate matches to return.",
    )
    parser.add_argument(
        "--retrieval-k",
        type=int,
        default=DEFAULT_RETRIEVAL_K,
        help="Number of Chroma chunks to retrieve before candidate aggregation.",
    )
    args = parser.parse_args()

    result = match_job_description(
        args.job_description,
        top_k_candidates=args.top_k,
        retrieval_k=args.retrieval_k,
    )
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
