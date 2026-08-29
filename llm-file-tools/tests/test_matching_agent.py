from __future__ import annotations

import ast
import os
import tempfile
import unittest
from pathlib import Path
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
        self.addCleanup(matching_agent.close_filesystem_mcp_client)
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

    def test_matching_agent_does_not_import_fs_tools(self):
        source = Path(matching_agent.__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)
        imported_modules = {
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        }
        imported_from_modules = {
            node.module
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.module
        }

        self.assertNotIn("fs_tools", imported_modules)
        self.assertNotIn("fs_tools", imported_from_modules)
        self.assertFalse(hasattr(matching_agent, "fs_tools"))

    def test_filesystem_tool_dispatch_uses_mcp_client(self):
        fake_client = FakeSyncFilesystemMCPClient()
        with patch.object(
            matching_agent,
            "SyncFilesystemMCPClient",
            lambda: fake_client,
        ):
            matching_agent.close_filesystem_mcp_client()

            result = matching_agent.call_filesystem_tool(
                "list_files", directory="resumes"
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["tool"], "list_files")
        self.assertEqual(result["arguments"], {"directory": "resumes"})
        self.assertEqual(fake_client.calls, [("list_files", {"directory": "resumes"})])

    def test_filesystem_tool_read_and_search_use_mcp_client(self):
        fake_client = FakeSyncFilesystemMCPClient()
        with patch.object(
            matching_agent,
            "SyncFilesystemMCPClient",
            lambda: fake_client,
        ):
            matching_agent.close_filesystem_mcp_client()

            read = matching_agent.call_filesystem_tool(
                "read_file", filepath="resumes/jane.txt"
            )
            search = matching_agent.call_filesystem_tool(
                "search_in_file", filepath="resumes/jane.txt", keyword="React"
            )

        self.assertEqual(read["tool"], "read_file")
        self.assertEqual(search["tool"], "search_in_file")
        self.assertEqual(len(fake_client.calls), 2)

    def test_filesystem_mcp_client_is_reused_for_multiple_calls(self):
        created_clients = []

        def make_client():
            client = FakeSyncFilesystemMCPClient()
            created_clients.append(client)
            return client

        with patch.object(matching_agent, "SyncFilesystemMCPClient", make_client):
            matching_agent.close_filesystem_mcp_client()

            matching_agent.call_filesystem_tool("list_files", directory=".")
            matching_agent.call_filesystem_tool("read_file", filepath="resume.txt")

        self.assertEqual(len(created_clients), 1)
        self.assertEqual(len(created_clients[0].calls), 2)

    def test_filesystem_mcp_client_can_be_closed(self):
        fake_client = FakeSyncFilesystemMCPClient()
        with patch.object(
            matching_agent,
            "SyncFilesystemMCPClient",
            lambda: fake_client,
        ):
            matching_agent.close_filesystem_mcp_client()
            matching_agent.call_filesystem_tool("list_files", directory=".")
            matching_agent.close_filesystem_mcp_client()

        self.assertTrue(fake_client.closed)
        self.assertIsNone(matching_agent._filesystem_mcp_client)

    def test_filesystem_tool_unavailable_from_mcp_returns_error(self):
        fake_client = FakeSyncFilesystemMCPClient(tools=["read_file"])
        with patch.object(
            matching_agent,
            "SyncFilesystemMCPClient",
            lambda: fake_client,
        ):
            matching_agent.close_filesystem_mcp_client()

            result = matching_agent.call_filesystem_tool("list_files", directory=".")

        self.assertFalse(result["success"])
        self.assertIn("Filesystem MCP tool unavailable", result["error"])

    def test_filesystem_tool_connection_error_returns_structured_failure(self):
        fake_client = FailingSyncFilesystemMCPClient()
        with patch.object(
            matching_agent,
            "SyncFilesystemMCPClient",
            lambda: fake_client,
        ):
            matching_agent.close_filesystem_mcp_client()

            result = matching_agent.call_filesystem_tool("read_file", filepath="a.txt")

        self.assertFalse(result["success"])
        self.assertIn("MCP filesystem error", result["error"])

    def test_filesystem_tool_real_mcp_integration_uses_temp_root(self):
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            (root / "resume.txt").write_text("Jane React", encoding="utf-8")
            old_root = os.environ.get("FILESYSTEM_MCP_ROOT")
            old_write = os.environ.get("FILESYSTEM_MCP_ALLOW_WRITE")
            os.environ["FILESYSTEM_MCP_ROOT"] = str(root)
            os.environ["FILESYSTEM_MCP_ALLOW_WRITE"] = "false"
            self.addCleanup(_restore_env, "FILESYSTEM_MCP_ROOT", old_root)
            self.addCleanup(_restore_env, "FILESYSTEM_MCP_ALLOW_WRITE", old_write)
            matching_agent.close_filesystem_mcp_client()
            self.addCleanup(matching_agent.close_filesystem_mcp_client)

            result = matching_agent.call_filesystem_tool(
                "read_file", filepath="resume.txt"
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["content"], "Jane React")


class FakeSyncFilesystemMCPClient:
    def __init__(self, tools=None):
        self.tools = tools or [
            "read_file",
            "list_files",
            "write_file",
            "search_in_file",
            "watch_directory",
            "batch_process",
        ]
        self.calls = []
        self.closed = False

    def list_tools(self):
        return self.tools

    def call_tool(self, tool_name, arguments):
        self.calls.append((tool_name, arguments))
        return {"success": True, "tool": tool_name, "arguments": arguments}

    def close(self):
        self.closed = True


class FailingSyncFilesystemMCPClient(FakeSyncFilesystemMCPClient):
    def list_tools(self):
        from filesystem_mcp_client import FilesystemMCPClientError

        raise FilesystemMCPClientError("connection failed")


def _restore_env(name, value):
    if value is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = value


if __name__ == "__main__":
    unittest.main()
