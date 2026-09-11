from __future__ import annotations

import asyncio
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import matching_agent
from filesystem_mcp_client import FilesystemMCPClient, SyncFilesystemMCPClient


EXPECTED_TOOLS = [
    "read_file",
    "list_files",
    "write_file",
    "search_in_file",
    "watch_directory",
    "batch_process",
]


class MCPAgentIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.root = Path(self.tempdir.name)
        (self.root / "resume_a.txt").write_text(
            "Aisha Backend\n\nSKILLS\nPython, FastAPI, AWS", encoding="utf-8"
        )
        (self.root / "resume_b.txt").write_text(
            "Ben Platform\n\nSKILLS\nKubernetes, AWS", encoding="utf-8"
        )
        self.env = dict(os.environ)
        self.env.update(
            {
                "FILESYSTEM_MCP_ROOT": str(self.root),
                "FILESYSTEM_MCP_ALLOW_WRITE": "false",
                "FILESYSTEM_MCP_MAX_BATCH_FILES": "10",
                "FILESYSTEM_MCP_WATCH_MAX_SECONDS": "2",
                "FILESYSTEM_MCP_TRANSPORT": "stdio",
            }
        )
        self._old_env = {name: os.environ.get(name) for name in self.env if name.startswith("FILESYSTEM_MCP_")}
        os.environ.update({name: value for name, value in self.env.items() if name.startswith("FILESYSTEM_MCP_")})
        matching_agent.close_filesystem_mcp_client()
        self.addCleanup(matching_agent.close_filesystem_mcp_client)
        self.addCleanup(self._restore_mcp_env)

    def test_matching_agent_filesystem_calls_use_real_mcp_path(self) -> None:
        listed = matching_agent.call_filesystem_tool("list_files", directory=".")
        read = matching_agent.call_filesystem_tool("read_file", filepath="resume_a.txt")
        searched = matching_agent.call_filesystem_tool(
            "search_in_file", filepath="resume_a.txt", keyword="FastAPI"
        )

        self.assertTrue(listed["success"])
        self.assertEqual(listed["count"], 2)
        self.assertTrue(read["success"])
        self.assertIn("Aisha Backend", read["content"])
        self.assertTrue(searched["success"])
        self.assertGreaterEqual(searched["match_count"], 1)

    def test_real_client_discovers_tools_and_resources(self) -> None:
        async def run() -> tuple[list[str], list[str]]:
            async with FilesystemMCPClient(env=self.env) as client:
                return await client.list_tools(), await client.list_resources()

        tools, resources = asyncio.run(run())

        self.assertEqual(tools, EXPECTED_TOOLS)
        self.assertIn("filesystem://root", resources)
        self.assertIn("filesystem://files", resources)

    def test_watch_directory_detects_created_file_through_protocol(self) -> None:
        def create_file() -> None:
            time.sleep(0.05)
            (self.root / "resume_c.txt").write_text("Created", encoding="utf-8")

        async def run() -> dict:
            async with FilesystemMCPClient(env=self.env) as client:
                thread = threading.Thread(target=create_file)
                thread.start()
                try:
                    return await client.call_tool(
                        "watch_directory",
                        {
                            "directory": ".",
                            "duration_seconds": 0.25,
                            "interval_seconds": 0.03,
                            "extension": ".txt",
                        },
                    )
                finally:
                    thread.join()

        result = asyncio.run(run())

        self.assertTrue(result["success"])
        self.assertIn("resume_c.txt", result["created"])

    def test_batch_process_success_and_partial_failure_through_protocol(self) -> None:
        async def run() -> tuple[dict, dict]:
            async with FilesystemMCPClient(env=self.env) as client:
                success = await client.call_tool(
                    "batch_process",
                    {
                        "operation": "read",
                        "filepaths": ["resume_a.txt", "resume_b.txt"],
                    },
                )
                partial = await client.call_tool(
                    "batch_process",
                    {
                        "operation": "read",
                        "filepaths": ["resume_a.txt", "missing.txt"],
                        "continue_on_error": True,
                    },
                )
                return success, partial

        success, partial = asyncio.run(run())

        self.assertTrue(success["success"])
        self.assertEqual(success["succeeded"], 2)
        self.assertFalse(partial["success"])
        self.assertTrue(partial["partial_success"])
        self.assertEqual(partial["succeeded"], 1)
        self.assertEqual(partial["failed"], 1)

    def test_security_rejection_through_mcp_path(self) -> None:
        result = matching_agent.call_filesystem_tool(
            "read_file", filepath="../outside.txt"
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "path_outside_root")

    def test_matching_agent_reuses_one_sync_mcp_client(self) -> None:
        created_clients = []
        env = self.env

        class CountingSyncFilesystemMCPClient(SyncFilesystemMCPClient):
            def __init__(self):
                super().__init__(env=env)
                created_clients.append(self)

        with patch.object(
            matching_agent,
            "SyncFilesystemMCPClient",
            CountingSyncFilesystemMCPClient,
        ):
            matching_agent.close_filesystem_mcp_client()
            matching_agent.call_filesystem_tool("list_files", directory=".")
            matching_agent.call_filesystem_tool("read_file", filepath="resume_a.txt")
            matching_agent.call_filesystem_tool(
                "search_in_file", filepath="resume_b.txt", keyword="AWS"
            )

        self.assertEqual(len(created_clients), 1)

    def _restore_mcp_env(self) -> None:
        for name in list(os.environ):
            if name.startswith("FILESYSTEM_MCP_"):
                if name in self._old_env and self._old_env[name] is not None:
                    os.environ[name] = self._old_env[name]
                else:
                    os.environ.pop(name, None)


if __name__ == "__main__":
    unittest.main()
