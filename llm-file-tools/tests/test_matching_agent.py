from __future__ import annotations

import unittest
from unittest.mock import patch

import matching_agent


def fake_match_job_description(job_description, top_k_candidates=10, retrieval_k=40):
    return {
        "success": True,
        "message": "ok",
        "top_matches": [
            {
                "candidate_name": "Jane React",
                "resume_path": "resumes/jane.txt",
                "match_score": 88,
                "matched_skills": ["React", "AWS", "PostgreSQL"],
                "relevant_excerpts": ["Built React apps on AWS with PostgreSQL."],
                "reasoning": "Candidate has 5 years of experience against the 3+ year requirement. Meets explicit must-have checks.",
                "eligible": True,
                "passed_requirements": ["Skill: React", "Minimum experience: 3+ years"],
                "failed_requirements": [],
            },
            {
                "candidate_name": "Alex Frontend",
                "resume_path": "resumes/alex.txt",
                "match_score": 82,
                "matched_skills": ["React"],
                "relevant_excerpts": ["React frontend engineer."],
                "reasoning": "Candidate has 4 years of experience against the 3+ year requirement. Meets explicit must-have checks.",
                "eligible": True,
                "passed_requirements": ["Skill: React", "Minimum experience: 3+ years"],
                "failed_requirements": [],
            },
            {
                "candidate_name": "Sam Backend",
                "resume_path": "resumes/sam.txt",
                "match_score": 76,
                "matched_skills": ["AWS", "PostgreSQL"],
                "relevant_excerpts": ["AWS and PostgreSQL backend work."],
                "reasoning": "Candidate has 6 years of experience against the 3+ year requirement. Failed explicit must-have checks: Skill: React.",
                "eligible": False,
                "passed_requirements": ["Minimum experience: 3+ years"],
                "failed_requirements": ["Skill: React"],
            },
        ],
    }


class MatchingAgentTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(
            matching_agent, "match_job_description", fake_match_job_description
        )
        self.addCleanup(patcher.stop)
        patcher.start()
        self.agent = matching_agent.MatchingAgent()

    def test_search_extracts_requirements_and_returns_candidates(self):
        state = self.agent.invoke("Find me candidates with React and 3+ years experience")

        self.assertEqual(state["requirements"]["must_have_skills"], ["React"])
        self.assertEqual(state["requirements"]["min_experience_years"], 3)
        self.assertEqual(len(state["candidate_shortlist"]), 3)
        self.assertIn("Top candidates", state["report"])

    def test_refinement_preserves_prior_requirements_and_reranks(self):
        state = self.agent.invoke("Find React candidates with 3+ years experience")

        refined = self.agent.invoke("Make AWS mandatory", state)

        self.assertEqual(refined["requirements"]["must_have_skills"], ["React", "AWS"])
        self.assertEqual(refined["candidate_shortlist"][0]["candidate_name"], "Jane React")
        self.assertTrue(refined["previous_candidate_shortlist"])
        self.assertIn("AWS", refined["report"])

    def test_compare_top_three(self):
        state = self.agent.invoke("Find React candidates with 3+ years experience")

        compared = self.agent.invoke("Compare the top 3", state)

        self.assertTrue(compared["comparison"]["success"])
        self.assertEqual(len(compared["comparison"]["candidates"]), 3)
        self.assertIn("Candidate comparison", compared["report"])

    def test_explain_ranking(self):
        state = self.agent.invoke("Find React candidates with 3+ years experience")

        explained = self.agent.invoke(
            "Why did Jane React rank higher than Alex Frontend?", state
        )

        self.assertIn("Jane React ranks higher", explained["report"])
        self.assertIn("Score", explained["report"])

    def test_interview_questions_are_candidate_specific(self):
        state = self.agent.invoke("Find React candidates with 3+ years experience")

        questions = self.agent.invoke(
            "Generate interview questions for the top candidate", state
        )

        self.assertGreaterEqual(len(questions["interview_questions"]), 5)
        self.assertTrue(
            any("React" in question for question in questions["interview_questions"])
        )
        self.assertEqual(
            len(questions["interview_questions"]),
            len(set(questions["interview_questions"])),
        )

    def test_exit_sets_goodbye_report(self):
        state = self.agent.invoke("Find React candidates with 3+ years experience")

        exited = self.agent.invoke("exit", state)

        self.assertEqual(exited["report"], "Goodbye.")

    def test_optional_refinement_moves_skill_to_nice_to_have(self):
        state = self.agent.invoke("Find React and AWS candidates with 3+ years experience")

        refined = self.agent.invoke(
            "AWS is optional now, but PostgreSQL is mandatory", state
        )

        self.assertIn("PostgreSQL", refined["requirements"]["must_have_skills"])
        self.assertIn("AWS", refined["requirements"]["nice_to_have_skills"])

    def test_filesystem_tools_are_exposed(self):
        tools = matching_agent.available_agent_tools()

        self.assertIn("list_files", tools)
        self.assertIn("read_file", tools)
        self.assertIn("search_in_file", tools)
        self.assertIn("write_file", tools)

    def test_filesystem_tool_dispatcher_handles_unknown_tool(self):
        result = matching_agent.call_filesystem_tool("missing_tool")

        self.assertFalse(result["success"])
        self.assertIn("Unknown filesystem tool", result["error"])


if __name__ == "__main__":
    unittest.main()
