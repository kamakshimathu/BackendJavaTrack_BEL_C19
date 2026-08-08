"""Evaluate resume matching against a small manually curated golden dataset.

The metrics are intentionally simple:
- Top-1 hit rate: fraction of jobs where the highest-ranked candidate is expected.
- Top-3 hit rate: fraction of jobs where any expected candidate appears in the top 3.
- Top-5 recall: average fraction of expected candidates retrieved in the top 5.
- Top-10 recall: average fraction of expected candidates retrieved in the top 10.
- Average matching latency: mean wall-clock time per job_matcher call.

Metric values are calculated from actual matcher output; they are not hardcoded.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

from job_matcher import match_job_description


HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN_DATASET_PATH = os.path.join(HERE, "evaluation_data", "golden_dataset.json")


def load_golden_dataset(path: str = GOLDEN_DATASET_PATH) -> list[dict]:
    """Load manually selected expected candidates for each job description."""
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def load_job_description(relative_path: str) -> str:
    """Read a job description file relative to the project directory."""
    full_path = os.path.join(HERE, relative_path)
    with open(full_path, "r", encoding="utf-8") as handle:
        return handle.read().strip()


def evaluate(top_k_candidates: int = 10) -> dict:
    """Run the matcher for every golden dataset item and compute metrics."""
    golden_items = load_golden_dataset()
    per_job_results = []

    for item in golden_items:
        job_description = load_job_description(item["job_description_file"])
        expected = item["expected_candidates"]

        started = time.perf_counter()
        result = match_job_description(
            job_description,
            top_k_candidates=top_k_candidates,
            retrieval_k=50,
        )
        latency_seconds = time.perf_counter() - started

        retrieved = [
            match["candidate_name"] for match in result.get("top_matches", [])
        ]
        expected_set = set(expected)

        per_job_results.append(
            {
                "job_id": item["job_id"],
                "success": result.get("success", False),
                "expected_candidates": expected,
                "retrieved_candidates": retrieved,
                "top_1_hit": bool(retrieved[:1] and retrieved[0] in expected_set),
                "top_3_hit": bool(expected_set.intersection(retrieved[:3])),
                "top_5_recall": _recall_at_k(expected, retrieved, 5),
                "top_10_recall": _recall_at_k(expected, retrieved, 10),
                "latency_seconds": latency_seconds,
                "error": result.get("error"),
            }
        )

    return {
        "job_count": len(per_job_results),
        "top_1_hit_rate": _mean([job["top_1_hit"] for job in per_job_results]),
        "top_3_hit_rate": _mean([job["top_3_hit"] for job in per_job_results]),
        "top_5_recall": _mean([job["top_5_recall"] for job in per_job_results]),
        "top_10_recall": _mean([job["top_10_recall"] for job in per_job_results]),
        "average_latency_seconds": _mean(
            [job["latency_seconds"] for job in per_job_results]
        ),
        "per_job_results": per_job_results,
    }


def print_evaluation_summary(metrics: dict) -> None:
    """Print a concise, readable evaluation report."""
    print("Resume matcher evaluation")
    print(f"- Jobs evaluated: {metrics['job_count']}")
    print(f"- Top-1 hit rate: {metrics['top_1_hit_rate']:.3f}")
    print(f"- Top-3 hit rate: {metrics['top_3_hit_rate']:.3f}")
    print(f"- Top-5 recall: {metrics['top_5_recall']:.3f}")
    print(f"- Top-10 recall: {metrics['top_10_recall']:.3f}")
    print(f"- Average matching latency: {metrics['average_latency_seconds']:.3f}s")
    print()
    print("Per-job results")
    for job in metrics["per_job_results"]:
        status = "ok" if job["success"] else "error"
        print(f"- {job['job_id']} ({status}, {job['latency_seconds']:.3f}s)")
        print(f"  expected: {', '.join(job['expected_candidates'])}")
        print(f"  retrieved top 5: {', '.join(job['retrieved_candidates'][:5])}")
        print(
            "  metrics: "
            f"top1={job['top_1_hit']} "
            f"top3={job['top_3_hit']} "
            f"top5_recall={job['top_5_recall']:.3f} "
            f"top10_recall={job['top_10_recall']:.3f}"
        )
        if job["error"]:
            print(f"  error: {job['error']}")


def _recall_at_k(expected: list[str], retrieved: list[str], k: int) -> float:
    if not expected:
        return 0.0
    return len(set(expected).intersection(retrieved[:k])) / len(set(expected))


def _mean(values: list[Any]) -> float:
    if not values:
        return 0.0
    return sum(float(value) for value in values) / len(values)


def main() -> None:
    metrics = evaluate()
    print_evaluation_summary(metrics)


if __name__ == "__main__":
    main()
