"""Deterministic resume parsing helpers for the RAG ingestion pipeline.

The parser intentionally uses simple text rules instead of an LLM. Its job is
to extract stable metadata and section boundaries so embeddings can focus on
semantic retrieval later.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Iterable


SECTION_ALIASES = {
    "summary": {
        "summary",
        "profile",
        "professional summary",
        "career summary",
        "about",
    },
    "skills": {
        "skills",
        "technical skills",
        "core skills",
        "key skills",
        "technologies",
        "technical expertise",
    },
    "experience": {
        "experience",
        "work experience",
        "professional experience",
        "employment history",
        "career history",
    },
    "education": {
        "education",
        "qualifications",
        "academic qualifications",
        "academic background",
    },
    "projects": {
        "projects",
        "project experience",
        "selected projects",
    },
    "certifications": {
        "certifications",
        "certification",
        "licenses",
        "licences",
    },
}

HEADING_TO_SECTION = {
    alias: canonical
    for canonical, aliases in SECTION_ALIASES.items()
    for alias in aliases
}

CONTACT_MARKERS = (
    "email",
    "phone",
    "location",
    "linkedin",
    "github",
    "portfolio",
    "@",
    "www.",
    "http",
)

SKILL_CATEGORY_PREFIXES = {
    "languages",
    "frameworks",
    "cloud",
    "databases",
    "data",
    "ml",
    "ai",
    "iac",
    "observability",
    "tools",
    "platforms",
    "devops",
    "testing",
    "security",
    "visualisation",
    "visualization",
}


def parse_resume(text: str) -> dict:
    """Parse raw resume text into structured metadata and logical sections.

    Missing fields are returned as neutral values so ingestion can continue for
    imperfect resumes.
    """
    normalized_text = _normalize_text(text)
    lines = normalized_text.splitlines()
    sections = _extract_sections(lines)

    candidate_name = _extract_name(lines)
    skills = _extract_skills(sections)
    experience_years = _extract_experience_years(normalized_text, sections)
    education = sections.get("education", "").strip()

    return {
        "name": candidate_name,
        "skills": skills,
        "experience_years": experience_years,
        "education": education,
        "sections": sections,
    }


def _normalize_text(text: str) -> str:
    """Normalize line endings and whitespace without changing resume content."""
    if not text:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(lines).strip()


def _extract_sections(lines: list[str]) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    current_section = "header"
    sections[current_section] = []

    for line in lines:
        heading = _canonical_heading(line)
        if heading:
            current_section = heading
            sections.setdefault(current_section, [])
            continue
        sections.setdefault(current_section, []).append(line)

    cleaned = {
        section: "\n".join(_trim_blank_edges(section_lines)).strip()
        for section, section_lines in sections.items()
        if "\n".join(section_lines).strip()
    }
    return cleaned


def _canonical_heading(line: str) -> str | None:
    if not line:
        return None

    candidate = line.strip().strip(":").lower()
    candidate = re.sub(r"^[#*\-\s]+", "", candidate).strip()
    candidate = re.sub(r"\s+", " ", candidate)

    if candidate in HEADING_TO_SECTION:
        return HEADING_TO_SECTION[candidate]

    # Accept uppercase headings with light punctuation, e.g. "WORK EXPERIENCE:"
    if len(candidate.split()) <= 4 and line.strip().upper() == line.strip():
        normalized = re.sub(r"[^a-z\s]", "", candidate).strip()
        return HEADING_TO_SECTION.get(normalized)

    return None


def _trim_blank_edges(lines: Iterable[str]) -> list[str]:
    trimmed = list(lines)
    while trimmed and not trimmed[0].strip():
        trimmed.pop(0)
    while trimmed and not trimmed[-1].strip():
        trimmed.pop()
    return trimmed


def _extract_name(lines: list[str]) -> str | None:
    for line in lines[:8]:
        clean_line = line.strip()
        if not clean_line:
            continue
        if _canonical_heading(clean_line):
            continue
        if any(marker in clean_line.lower() for marker in CONTACT_MARKERS):
            continue
        if re.search(r"\d", clean_line):
            continue
        words = clean_line.split()
        if 2 <= len(words) <= 5:
            return clean_line
    return None


def _extract_skills(sections: dict[str, str]) -> list[str]:
    skills_text = sections.get("skills", "")
    if not skills_text:
        return []

    skills: list[str] = []
    for raw_line in skills_text.splitlines():
        line = raw_line.strip().lstrip("-*").strip()
        if not line:
            continue

        if ":" in line:
            prefix, rest = line.split(":", 1)
            if prefix.strip().lower() in SKILL_CATEGORY_PREFIXES:
                line = rest

        for item in re.split(r",|;|\||/", line):
            skill = item.strip(" .")
            if skill:
                skills.append(skill)

    return _dedupe_preserving_order(skills)


def _dedupe_preserving_order(values: Iterable[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        key = value.lower()
        if key not in seen:
            seen.add(key)
            result.append(value)
    return result


def _extract_experience_years(full_text: str, sections: dict[str, str]) -> int | None:
    explicit_years = [
        int(match.group(1))
        for match in re.finditer(
            r"\b(\d{1,2})\+?\s+(?:years?|yrs?)\s+of\s+experience\b",
            full_text,
            flags=re.IGNORECASE,
        )
    ]
    if explicit_years:
        return max(explicit_years)

    experience_text = sections.get("experience", "")
    years = [
        int(match.group(0))
        for match in re.finditer(r"\b(?:19|20)\d{2}\b", experience_text)
    ]
    if len(years) < 2:
        return None

    start_year = min(years)
    end_year = (
        date.today().year
        if re.search(r"\bpresent\b", experience_text, re.IGNORECASE)
        else max(years)
    )
    estimated = max(0, end_year - start_year)
    return estimated or None
