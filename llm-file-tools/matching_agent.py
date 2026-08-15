"""LangGraph-based conversational resume matching agent for Milestone 3.

The agent reuses the existing deterministic RAG matcher in job_matcher.py. LLMs
are optional and are only used for language interpretation/synthesis when an API
key is available; candidate scores remain deterministic and explainable.
"""

from __future__ import annotations

import argparse
import re
from typing import Any, Literal, TypedDict

import fs_tools
from job_matcher import (
    DEFAULT_TOP_K_CANDIDATES,
    SKILL_ALIASES,
    extract_job_requirements,
    match_job_description,
)

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover - optional convenience dependency
    pass

try:
    from langgraph.graph import END, START, StateGraph

    LANGGRAPH_AVAILABLE = True
except ImportError:  # pragma: no cover - keeps deterministic tests runnable
    END = "__end__"
    START = "__start__"
    StateGraph = None
    LANGGRAPH_AVAILABLE = False


Intent = Literal[
    "SEARCH",
    "REFINE_REQUIREMENTS",
    "COMPARE",
    "EXPLAIN_RANKING",
    "INTERVIEW_QUESTIONS",
    "EXIT",
]


class AgentState(TypedDict, total=False):
    messages: list[dict[str, str]]
    raw_query: str
    job_description: str
    requirements: dict[str, Any]
    candidate_shortlist: list[dict[str, Any]]
    previous_candidate_shortlist: list[dict[str, Any]]
    deep_analysis: list[dict[str, Any]]
    report: str
    human_feedback: str
    ranking_changes: list[str]
    current_intent: Intent
    comparison: dict[str, Any]
    interview_questions: list[str]
    ranking_explanation: str
    error: str | None


def extract_requirements(jd: str) -> dict[str, Any]:
    """Extract role, must-have skills, nice-to-have skills, and experience.

    This extends job_matcher.extract_job_requirements() instead of replacing its
    technology detection. Known skills are classified with deterministic phrase
    windows and all recognized skills default to must-have when no preference
    signal is present.
    """
    jd = (jd or "").strip()
    base = extract_job_requirements(jd)
    skills = base.get("skills", [])
    must_have: list[str] = []
    nice_to_have: list[str] = []

    for skill in skills:
        signal = _skill_requirement_signal(jd, skill)
        if signal == "nice":
            nice_to_have.append(skill)
        else:
            must_have.append(skill)

    return {
        "role": _extract_role(jd),
        "must_have_skills": _dedupe(must_have),
        "nice_to_have_skills": _dedupe(nice_to_have),
        "min_experience_years": base.get("min_experience_years"),
    }


def compare_candidates(candidate_ids: list[str], state: AgentState | None = None) -> dict[str, Any]:
    """Compare selected candidates from the current shortlist."""
    shortlist = (state or {}).get("candidate_shortlist", [])
    if not shortlist:
        return {"success": False, "message": "Run a search before comparing candidates."}

    selected = _resolve_candidates(candidate_ids, shortlist)
    if not selected:
        return {
            "success": False,
            "message": "No requested candidates were found in the current shortlist.",
        }

    comparison_rows = [_comparison_row(candidate) for candidate in selected]
    explanation = _compare_explanation(selected)
    return {"success": True, "candidates": comparison_rows, "explanation": explanation}


def generate_interview_questions(
    candidate_id: str, state: AgentState | None = None
) -> list[str]:
    """Generate candidate-specific screening questions from actual evidence."""
    shortlist = (state or {}).get("candidate_shortlist", [])
    candidate = _resolve_candidate(candidate_id, shortlist)
    if not candidate:
        return ["Run a search first, or choose a candidate from the current shortlist."]

    questions = []
    for skill in candidate.get("matched_must_haves", [])[:3]:
        questions.append(
            f"Describe a recent project where you used {skill}. What was your specific contribution?"
        )
    for skill in candidate.get("missing_must_haves", [])[:3]:
        questions.append(
            f"The resume has limited evidence for {skill}. What hands-on experience do you have with it?"
        )
    if candidate.get("experience_years") is not None:
        questions.append(
            f"Walk through the roles that make up your {candidate['experience_years']} years of experience."
        )
    for skill in candidate.get("matched_nice_to_haves", [])[:2]:
        questions.append(
            f"How have you applied {skill}, and what tradeoffs did you handle?"
        )

    while len(questions) < 5:
        questions.append(
            "Which resume project best demonstrates your fit for this role, and what measurable outcome did you deliver?"
        )
    return questions[:7]


AGENT_TOOLS = {
    **fs_tools.TOOLS,
    "extract_requirements": extract_requirements,
    "compare_candidates": compare_candidates,
    "generate_interview_questions": generate_interview_questions,
}


def available_agent_tools() -> list[str]:
    """Return the filesystem, RAG, and agent tools explicitly available."""
    return sorted(AGENT_TOOLS)


def call_filesystem_tool(tool_name: str, **kwargs: Any) -> Any:
    """Safely dispatch one of the Milestone 1 filesystem tools by name.

    The conversational matching flow does not need to call these on every turn,
    but exposing this dispatcher makes the Milestone 1 tool layer explicitly
    available to the LangGraph agent backend and easy to demonstrate.
    """
    if tool_name not in fs_tools.TOOLS:
        return {
            "success": False,
            "error": (
                f"Unknown filesystem tool: {tool_name}. "
                f"Available filesystem tools: {', '.join(sorted(fs_tools.TOOLS))}"
            ),
        }
    try:
        return fs_tools.TOOLS[tool_name](**kwargs)
    except TypeError as exc:
        return {"success": False, "error": f"Invalid arguments for {tool_name}: {exc}"}


class MatchingAgent:
    """Small conversational facade over a LangGraph state machine."""

    def __init__(self) -> None:
        self.graph = _build_graph()

    def initial_state(self) -> AgentState:
        return {
            "messages": [],
            "raw_query": "",
            "job_description": "",
            "requirements": {},
            "candidate_shortlist": [],
            "previous_candidate_shortlist": [],
            "deep_analysis": [],
            "report": "",
            "human_feedback": "",
            "ranking_changes": [],
            "current_intent": "SEARCH",
            "error": None,
        }

    def invoke(self, user_input: str, state: AgentState | None = None) -> AgentState:
        state = state or self.initial_state()
        state = {**state}
        state["raw_query"] = user_input
        state["human_feedback"] = user_input
        state["messages"] = state.get("messages", []) + [
            {"role": "user", "content": user_input}
        ]
        if self.graph is None:
            state = _run_without_langgraph(state)
        else:
            state = self.graph.invoke(state)
        state["messages"] = state.get("messages", []) + [
            {"role": "assistant", "content": state.get("report", "")}
        ]
        return state


def _build_graph():
    if not LANGGRAPH_AVAILABLE:
        return None

    graph = StateGraph(AgentState)
    graph.add_node("intent", _intent_node)
    graph.add_node("parse_jd", _parse_jd_node)
    graph.add_node("extract_requirements", _extract_requirements_node)
    graph.add_node("search_resumes", _search_resumes_node)
    graph.add_node("rank_candidates", _rank_candidates_node)
    graph.add_node("deep_analysis", _deep_analysis_node)
    graph.add_node("generate_report", _generate_report_node)
    graph.add_node("human_feedback", _human_feedback_node)
    graph.add_node("compare_candidates", _compare_node)
    graph.add_node("explain_ranking", _explain_ranking_node)
    graph.add_node("interview_questions", _interview_questions_node)

    graph.add_edge(START, "intent")
    graph.add_conditional_edges(
        "intent",
        _route_from_intent,
        {
            "search": "parse_jd",
            "refine": "extract_requirements",
            "compare": "compare_candidates",
            "explain": "explain_ranking",
            "interview": "interview_questions",
            "end": END,
        },
    )
    graph.add_edge("parse_jd", "extract_requirements")
    graph.add_edge("extract_requirements", "search_resumes")
    graph.add_edge("search_resumes", "rank_candidates")
    graph.add_edge("rank_candidates", "deep_analysis")
    graph.add_edge("deep_analysis", "generate_report")
    graph.add_edge("generate_report", "human_feedback")
    graph.add_conditional_edges(
        "human_feedback",
        lambda state: "end" if state.get("current_intent") == "EXIT" else "end",
        {"end": END},
    )
    graph.add_edge("compare_candidates", END)
    graph.add_edge("explain_ranking", END)
    graph.add_edge("interview_questions", END)
    return graph.compile()


def _run_without_langgraph(state: AgentState) -> AgentState:
    state = _intent_node(state)
    route = _route_from_intent(state)
    if route in {"search", "refine"}:
        if route == "search":
            state = _parse_jd_node(state)
        state = _extract_requirements_node(state)
        state = _search_resumes_node(state)
        state = _rank_candidates_node(state)
        state = _deep_analysis_node(state)
        state = _generate_report_node(state)
        return _human_feedback_node(state)
    if route == "compare":
        return _compare_node(state)
    if route == "explain":
        return _explain_ranking_node(state)
    if route == "interview":
        return _interview_questions_node(state)
    state["report"] = "Goodbye."
    return state


def _intent_node(state: AgentState) -> AgentState:
    query = state.get("raw_query", "")
    state["current_intent"] = detect_intent(query)
    return state


def detect_intent(query: str) -> Intent:
    text = (query or "").strip().lower()
    if text in {"exit", "quit", "done", "accept"}:
        return "EXIT"
    if re.search(r"\b(compare|side by side)\b", text):
        return "COMPARE"
    if re.search(r"\b(interview|screening question|questions)\b", text):
        return "INTERVIEW_QUESTIONS"
    if re.search(r"\bwhy\b.*\brank(?:ed)?\b|\brank higher\b", text):
        return "EXPLAIN_RANKING"
    if re.search(
        r"\b(mandatory|required|must have|optional|nice to have|preferred|actually|make|should be)\b",
        text,
    ) and not re.search(r"\b(find|search|candidates|looking for)\b", text):
        return "REFINE_REQUIREMENTS"
    return "SEARCH"


def _route_from_intent(state: AgentState) -> str:
    return {
        "SEARCH": "search",
        "REFINE_REQUIREMENTS": "refine",
        "COMPARE": "compare",
        "EXPLAIN_RANKING": "explain",
        "INTERVIEW_QUESTIONS": "interview",
        "EXIT": "end",
    }[state.get("current_intent", "SEARCH")]


def _parse_jd_node(state: AgentState) -> AgentState:
    state["job_description"] = state.get("raw_query", "").strip()
    return state


def _extract_requirements_node(state: AgentState) -> AgentState:
    intent = state.get("current_intent", "SEARCH")
    query = state.get("raw_query", "")
    if intent == "REFINE_REQUIREMENTS":
        current = state.get("requirements", {}) or {}
        if not current:
            state["requirements"] = extract_requirements(query)
        else:
            state["requirements"] = refine_requirements(current, query)
    else:
        state["requirements"] = extract_requirements(state.get("job_description", query))
    state["job_description"] = _requirements_to_query(state["requirements"])
    return state


def refine_requirements(current: dict[str, Any], feedback: str) -> dict[str, Any]:
    updated = {
        "role": current.get("role") or _extract_role(feedback),
        "must_have_skills": list(current.get("must_have_skills", [])),
        "nice_to_have_skills": list(current.get("nice_to_have_skills", [])),
        "min_experience_years": current.get("min_experience_years"),
    }
    parsed = extract_requirements(feedback)
    if parsed.get("min_experience_years") is not None:
        updated["min_experience_years"] = parsed["min_experience_years"]

    for skill in parsed.get("must_have_skills", []):
        if _skill_requirement_signal(feedback, skill) == "nice":
            _move_skill(skill, updated["must_have_skills"], updated["nice_to_have_skills"])
        else:
            _move_skill(skill, updated["nice_to_have_skills"], updated["must_have_skills"])
    for skill in parsed.get("nice_to_have_skills", []):
        _move_skill(skill, updated["must_have_skills"], updated["nice_to_have_skills"])

    return updated


def _search_resumes_node(state: AgentState) -> AgentState:
    query = state.get("job_description", "").strip()
    state["previous_candidate_shortlist"] = state.get("candidate_shortlist", [])
    if not query:
        state["error"] = "Enter a job description or refinement before searching."
        state["candidate_shortlist"] = []
        return state

    result = match_job_description(
        query,
        top_k_candidates=DEFAULT_TOP_K_CANDIDATES,
        retrieval_k=40,
    )
    if not result.get("success"):
        state["error"] = result.get("message") or "Resume search failed."
        state["candidate_shortlist"] = []
        return state

    requirements = state.get("requirements", {})
    state["candidate_shortlist"] = [
        _enrich_candidate(candidate, requirements, index)
        for index, candidate in enumerate(result.get("top_matches", []), start=1)
    ]
    state["error"] = None
    return state


def _rank_candidates_node(state: AgentState) -> AgentState:
    candidates = state.get("candidate_shortlist", [])
    candidates.sort(
        key=lambda item: (
            item.get("eligible", False),
            len(item.get("matched_must_haves", [])),
            item.get("match_score", 0),
            len(item.get("matched_nice_to_haves", [])),
        ),
        reverse=True,
    )
    for index, candidate in enumerate(candidates, start=1):
        candidate["rank"] = index
    state["candidate_shortlist"] = candidates
    state["ranking_changes"] = _ranking_changes(
        state.get("previous_candidate_shortlist", []), candidates
    )
    return state


def _deep_analysis_node(state: AgentState) -> AgentState:
    state["deep_analysis"] = [
        _deep_analysis(candidate) for candidate in state.get("candidate_shortlist", [])
    ]
    return state


def _generate_report_node(state: AgentState) -> AgentState:
    if state.get("error"):
        state["report"] = state["error"] or "Unable to complete the request."
        return state
    state["report"] = format_report(state)
    return state


def _human_feedback_node(state: AgentState) -> AgentState:
    return state


def _compare_node(state: AgentState) -> AgentState:
    ids = _candidate_ids_from_query(state.get("raw_query", ""), state)
    state["comparison"] = compare_candidates(ids, state)
    state["report"] = format_comparison(state["comparison"])
    return state


def _explain_ranking_node(state: AgentState) -> AgentState:
    names = _names_from_ranking_query(state.get("raw_query", ""))
    state["ranking_explanation"] = explain_ranking(names, state)
    state["report"] = state["ranking_explanation"]
    return state


def _interview_questions_node(state: AgentState) -> AgentState:
    candidate_id = _candidate_id_for_questions(state.get("raw_query", ""), state)
    questions = generate_interview_questions(candidate_id, state)
    state["interview_questions"] = questions
    state["report"] = "Interview questions\n" + "\n".join(
        f"{index}. {question}" for index, question in enumerate(questions, start=1)
    )
    return state


def _enrich_candidate(
    candidate: dict[str, Any], requirements: dict[str, Any], rank: int
) -> dict[str, Any]:
    must = requirements.get("must_have_skills", [])
    nice = requirements.get("nice_to_have_skills", [])
    matched = candidate.get("matched_skills", [])
    matched_must = [skill for skill in must if skill in matched]
    missing_must = [skill for skill in must if skill not in matched]
    matched_nice = [skill for skill in nice if skill in matched]
    min_years = requirements.get("min_experience_years")
    exp_years = _experience_from_failures(candidate)
    if exp_years is None:
        exp_years = _experience_from_reasoning(candidate.get("reasoning", ""))
    experience_ok = min_years is None or (exp_years is not None and exp_years >= min_years)
    eligible = not missing_must and experience_ok

    enriched = {
        **candidate,
        "rank": rank,
        "experience_years": exp_years,
        "matched_must_haves": matched_must,
        "missing_must_haves": missing_must,
        "matched_nice_to_haves": matched_nice,
        "missing_nice_to_haves": [skill for skill in nice if skill not in matched],
        "eligible": eligible,
    }
    enriched["recommendation"] = _recommendation(enriched)
    enriched["hire_recommendation"] = _hire_recommendation(enriched)
    enriched["strengths"] = _strengths(enriched)
    enriched["gaps"] = _gaps(enriched, requirements)
    return enriched


def _deep_analysis(candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "candidate_name": candidate.get("candidate_name"),
        "strengths": candidate.get("strengths", []),
        "gaps": candidate.get("gaps", []),
        "matched_must_haves": candidate.get("matched_must_haves", []),
        "missing_must_haves": candidate.get("missing_must_haves", []),
        "matched_nice_to_haves": candidate.get("matched_nice_to_haves", []),
        "experience_summary": _experience_summary(candidate),
        "relevant_evidence": candidate.get("relevant_excerpts", []),
        "risk_level": _risk_level(candidate),
        "recommendation": candidate.get("recommendation"),
        "hire_recommendation": candidate.get("hire_recommendation"),
    }


def format_report(state: AgentState) -> str:
    requirements = state.get("requirements", {})
    candidates = state.get("candidate_shortlist", [])
    lines = ["Requirements"]
    lines.append(f"- Role: {requirements.get('role') or 'Unspecified'}")
    lines.append(
        "- Must-have skills: "
        + (_join(requirements.get("must_have_skills", [])) or "None detected")
    )
    lines.append(
        "- Nice-to-have skills: "
        + (_join(requirements.get("nice_to_have_skills", [])) or "None detected")
    )
    years = requirements.get("min_experience_years")
    lines.append(f"- Minimum experience: {years}+ years" if years else "- Minimum experience: Not specified")

    changes = state.get("ranking_changes", [])
    if changes:
        lines.extend(["", "Ranking changes"])
        lines.extend(f"- {change}" for change in changes[:5])

    if not candidates:
        lines.extend(["", "No candidates matched the current search."])
        return "\n".join(lines)

    lines.extend(["", "Top candidates"])
    for candidate in candidates[:10]:
        lines.append(
            f"{candidate['rank']}. {candidate['candidate_name']} - "
            f"{candidate['match_score']}/100 - {candidate['recommendation']} - "
            f"{'eligible' if candidate['eligible'] else 'not eligible'}"
        )
        lines.append(
            f"   Must: {_join(candidate.get('matched_must_haves', [])) or 'none'}; "
            f"Missing: {_join(candidate.get('missing_must_haves', [])) or 'none'}; "
            f"Nice: {_join(candidate.get('matched_nice_to_haves', [])) or 'none'}"
        )
        lines.append(f"   Experience: {_experience_summary(candidate)}")
        lines.append(f"   Why: {candidate.get('reasoning', '')}")
        suggestions = _screening_suggestions(candidate)
        if suggestions:
            lines.append("   Screening: " + " ".join(suggestions))
    return "\n".join(lines)


def format_comparison(comparison: dict[str, Any]) -> str:
    if not comparison.get("success"):
        return comparison.get("message", "Unable to compare candidates.")
    lines = ["Candidate comparison"]
    for row in comparison.get("candidates", []):
        lines.append(
            f"- {row['candidate_name']}: rank #{row['rank']}, {row['score']}/100, "
            f"{'eligible' if row['eligibility'] else 'not eligible'}"
        )
        lines.append(f"  Strengths: {_join(row['strengths']) or 'none'}")
        lines.append(f"  Gaps: {_join(row['gaps']) or 'none'}")
    lines.append("")
    lines.append(comparison.get("explanation", ""))
    return "\n".join(lines)


def explain_ranking(names: list[str], state: AgentState) -> str:
    shortlist = state.get("candidate_shortlist", [])
    if len(shortlist) < 2:
        return "Run a search first so I have candidates to explain."
    selected = _resolve_candidates(names, shortlist) if names else shortlist[:2]
    if len(selected) < 2:
        return "I could not find both candidates in the current shortlist."
    first, second = sorted(selected[:2], key=lambda item: item["rank"])
    parts = [
        f"{first['candidate_name']} ranks higher than {second['candidate_name']} because:"
    ]
    if first.get("eligible") != second.get("eligible"):
        parts.append(
            f"- Eligibility differs: {first['candidate_name']} is "
            f"{'eligible' if first.get('eligible') else 'not eligible'}, while "
            f"{second['candidate_name']} is {'eligible' if second.get('eligible') else 'not eligible'}."
        )
    if first.get("match_score") != second.get("match_score"):
        parts.append(
            f"- Score: {first['candidate_name']} has {first['match_score']}/100 vs "
            f"{second['candidate_name']} at {second['match_score']}/100."
        )
    parts.append(
        f"- Must-have matches: {first['candidate_name']} matched "
        f"{_join(first.get('matched_must_haves', [])) or 'none'}; "
        f"{second['candidate_name']} matched {_join(second.get('matched_must_haves', [])) or 'none'}."
    )
    if second.get("missing_must_haves"):
        parts.append(
            f"- {second['candidate_name']} is missing "
            f"{_join(second.get('missing_must_haves', []))}."
        )
    parts.append(f"- Evidence for {first['candidate_name']}: {first.get('reasoning', '')}")
    parts.append(f"- Evidence for {second['candidate_name']}: {second.get('reasoning', '')}")
    return "\n".join(parts)


def _comparison_row(candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "candidate_name": candidate.get("candidate_name"),
        "rank": candidate.get("rank"),
        "score": candidate.get("match_score"),
        "experience": _experience_summary(candidate),
        "matched_skills": candidate.get("matched_skills", []),
        "missing_requirements": candidate.get("missing_must_haves", []),
        "eligibility": candidate.get("eligible", False),
        "strengths": candidate.get("strengths", []),
        "gaps": candidate.get("gaps", []),
    }


def _compare_explanation(candidates: list[dict[str, Any]]) -> str:
    ordered = sorted(candidates, key=lambda item: item.get("rank", 999))
    if len(ordered) < 2:
        return "Only one candidate was selected."
    first, second = ordered[0], ordered[1]
    return (
        f"{first['candidate_name']} ranks ahead of {second['candidate_name']} due to "
        f"rank #{first['rank']} vs #{second['rank']}, score {first['match_score']} vs "
        f"{second['match_score']}, and must-have coverage "
        f"{len(first.get('matched_must_haves', []))} vs "
        f"{len(second.get('matched_must_haves', []))}."
    )


def _skill_requirement_signal(text: str, skill: str) -> str:
    text_lower = text.lower()
    aliases = SKILL_ALIASES.get(skill, [skill])
    nice_terms = ("nice to have", "preferred", "beneficial", "optional", "bonus")
    must_terms = ("required", "mandatory", "must have", "must-have", "need", "needs")
    for alias in aliases:
        alias_lower = alias.lower()
        clauses = re.split(r"[.;,]|\bbut\b|\band\b", text_lower)
        for clause in clauses:
            if alias_lower in clause:
                if any(term in clause for term in nice_terms):
                    return "nice"
                if any(term in clause for term in must_terms):
                    return "must"
        for match in re.finditer(re.escape(alias.lower()), text_lower):
            window = text_lower[max(0, match.start() - 45) : match.end() + 45]
            if any(term in window for term in nice_terms):
                return "nice"
            if any(term in window for term in must_terms):
                return "must"
    return "must"


def _extract_role(text: str) -> str:
    clean = re.sub(r"\s+", " ", text or "").strip()
    patterns = [
        r"\b(?:for|as|role[:\s]+)\s+(?:a|an)?\s*([A-Z][A-Za-z /+-]+?(?:Engineer|Developer|Scientist|Analyst|Architect|Manager))\b",
        r"\b([A-Z][A-Za-z /+-]+?(?:Engineer|Developer|Scientist|Analyst|Architect|Manager))\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, clean)
        if match:
            return match.group(1).strip()
    return ""


def _requirements_to_query(requirements: dict[str, Any]) -> str:
    parts = []
    if requirements.get("role"):
        parts.append(str(requirements["role"]))
    years = requirements.get("min_experience_years")
    if years:
        parts.append(f"{years}+ years experience")
    if requirements.get("must_have_skills"):
        parts.append("required " + ", ".join(requirements["must_have_skills"]))
    if requirements.get("nice_to_have_skills"):
        parts.append("preferred " + ", ".join(requirements["nice_to_have_skills"]))
    return ". ".join(parts) or ""


def _move_skill(skill: str, source: list[str], target: list[str]) -> None:
    source[:] = [item for item in source if item.lower() != skill.lower()]
    if all(item.lower() != skill.lower() for item in target):
        target.append(skill)


def _resolve_candidates(ids: list[str], shortlist: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not ids:
        return shortlist[:2]
    selected = []
    for candidate_id in ids:
        candidate = _resolve_candidate(candidate_id, shortlist)
        if candidate and candidate not in selected:
            selected.append(candidate)
    return selected


def _resolve_candidate(candidate_id: str, shortlist: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not shortlist:
        return None
    text = (candidate_id or "").strip().lower()
    if text in {"", "top", "top candidate", "first"}:
        return shortlist[0]
    rank_match = re.search(r"\b(?:#|rank\s*)?(\d+)\b", text)
    if rank_match:
        index = int(rank_match.group(1)) - 1
        if 0 <= index < len(shortlist):
            return shortlist[index]
    for candidate in shortlist:
        name = candidate.get("candidate_name", "").lower()
        path = candidate.get("resume_path", "").lower()
        if text and (text in name or text in path):
            return candidate
    return None


def _candidate_ids_from_query(query: str, state: AgentState) -> list[str]:
    match = re.search(r"\btop\s+(\d+)\b", query or "", re.IGNORECASE)
    if match:
        count = int(match.group(1))
        return [str(index) for index in range(1, count + 1)]
    names = _names_from_ranking_query(query)
    return names or [str(index) for index in range(1, min(3, len(state.get("candidate_shortlist", []))) + 1)]


def _candidate_id_for_questions(query: str, state: AgentState) -> str:
    if re.search(r"\btop\b|\bfirst\b", query or "", re.IGNORECASE):
        return "top"
    names = _names_from_ranking_query(query)
    return names[0] if names else "top"


def _names_from_ranking_query(query: str) -> list[str]:
    ranking_match = re.search(
        r"why\s+did\s+(.+?)\s+rank(?:ed)?\s+higher\s+than\s+(.+?)\??$",
        query or "",
        flags=re.IGNORECASE,
    )
    if ranking_match:
        return [
            ranking_match.group(1).strip(" ?.,"),
            ranking_match.group(2).strip(" ?.,"),
        ]
    clean = re.sub(r"\bwhy\b|\bdid\b|\brank(?:ed)?\b|\bhigher\b|\bthan\b|\bcompare\b", " ", query or "", flags=re.IGNORECASE)
    candidates = [part.strip(" ?.,") for part in re.split(r"\band\b|,| vs | versus ", clean, flags=re.IGNORECASE)]
    return [candidate for candidate in candidates if len(candidate.split()) >= 2]


def _ranking_changes(previous: list[dict[str, Any]], current: list[dict[str, Any]]) -> list[str]:
    if not previous:
        return []
    old_ranks = {candidate["candidate_name"]: candidate.get("rank", index) for index, candidate in enumerate(previous, start=1)}
    changes = []
    for candidate in current:
        name = candidate["candidate_name"]
        if name not in old_ranks:
            continue
        old_rank = old_ranks[name]
        new_rank = candidate["rank"]
        if old_rank == new_rank:
            continue
        direction = "moved up" if new_rank < old_rank else "moved down"
        reason = _movement_reason(candidate)
        changes.append(f"{name} {direction} from #{old_rank} to #{new_rank} because {reason}.")
    return changes


def _movement_reason(candidate: dict[str, Any]) -> str:
    if candidate.get("missing_must_haves"):
        return "missing must-have evidence for " + _join(candidate["missing_must_haves"])
    if candidate.get("matched_must_haves"):
        return "the updated must-have evidence includes " + _join(candidate["matched_must_haves"])
    return "the deterministic score and eligibility changed relative to the updated requirements"


def _experience_from_failures(candidate: dict[str, Any]) -> int | None:
    text = " ".join(candidate.get("failed_requirements", []) + candidate.get("passed_requirements", []))
    match = re.search(r"candidate metadata: (\d+) years", text)
    if match:
        return int(match.group(1))
    return None


def _experience_from_reasoning(reasoning: str) -> int | None:
    match = re.search(r"Candidate has (\d+) years", reasoning or "")
    return int(match.group(1)) if match else None


def _recommendation(candidate: dict[str, Any]) -> str:
    score = candidate.get("match_score", 0)
    if not candidate.get("eligible"):
        return "Borderline" if score >= 70 else "Do Not Progress"
    if score >= 85:
        return "Strong Interview"
    if score >= 70:
        return "Interview"
    return "Borderline"


def _hire_recommendation(candidate: dict[str, Any]) -> str:
    recommendation = candidate.get("recommendation") or _recommendation(candidate)
    if recommendation in {"Strong Interview", "Interview"}:
        return "hire"
    if recommendation == "Borderline":
        return "review"
    return "no_hire"


def _strengths(candidate: dict[str, Any]) -> list[str]:
    strengths = []
    if candidate.get("matched_must_haves"):
        strengths.append("Must-have evidence: " + _join(candidate["matched_must_haves"]))
    if candidate.get("matched_nice_to_haves"):
        strengths.append("Nice-to-have evidence: " + _join(candidate["matched_nice_to_haves"]))
    if candidate.get("eligible"):
        strengths.append("Passes deterministic eligibility checks")
    return strengths


def _gaps(candidate: dict[str, Any], requirements: dict[str, Any]) -> list[str]:
    gaps = []
    if candidate.get("missing_must_haves"):
        gaps.append("Missing must-have evidence: " + _join(candidate["missing_must_haves"]))
    years = requirements.get("min_experience_years")
    exp = candidate.get("experience_years")
    if years and (exp is None or exp < years):
        gaps.append(f"Experience evidence below {years}+ years")
    if candidate.get("missing_nice_to_haves"):
        gaps.append("Missing nice-to-have evidence: " + _join(candidate["missing_nice_to_haves"]))
    return gaps


def _risk_level(candidate: dict[str, Any]) -> str:
    if candidate.get("missing_must_haves"):
        return "high"
    if candidate.get("match_score", 0) < 70 or candidate.get("missing_nice_to_haves"):
        return "medium"
    return "low"


def _experience_summary(candidate: dict[str, Any]) -> str:
    years = candidate.get("experience_years")
    return f"{years} years" if years is not None else "No explicit experience metadata found"


def _screening_suggestions(candidate: dict[str, Any]) -> list[str]:
    suggestions = []
    for skill in candidate.get("missing_must_haves", [])[:2]:
        suggestions.append(f"Verify {skill} depth during screening.")
    if candidate.get("experience_years") is None:
        suggestions.append("Confirm exact professional experience duration.")
    return suggestions


def _join(values: list[Any]) -> str:
    return ", ".join(str(value) for value in values if value)


def _dedupe(values: list[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        key = value.lower()
        if key not in seen:
            seen.add(key)
            result.append(value)
    return result


def run_cli() -> None:
    print("AI Resume Matching Agent")
    print("Type 'exit' to quit.")
    print()
    agent = MatchingAgent()
    state = agent.initial_state()
    while True:
        user_input = input("You > ").strip()
        if not user_input:
            print("Agent > Please enter a search, refinement, comparison, or question.")
            continue
        state = agent.invoke(user_input, state)
        print()
        print("Agent >")
        print(state.get("report", ""))
        print()
        if state.get("current_intent") == "EXIT":
            break


def main() -> None:
    parser = argparse.ArgumentParser(description="Conversational resume matching agent.")
    parser.add_argument("query", nargs="*", help="Optional one-shot query.")
    args = parser.parse_args()
    if args.query:
        agent = MatchingAgent()
        state = agent.invoke(" ".join(args.query), agent.initial_state())
        print(state.get("report", ""))
        return
    run_cli()


if __name__ == "__main__":
    main()
