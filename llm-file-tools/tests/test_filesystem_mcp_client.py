from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from filesystem_mcp_client import FilesystemMCPClient, FilesystemMCPClientError


class FilesystemMCPClientTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.root = Path(self.tempdir.name)
        self.resume = self.root / "resume.txt"
        self.resume.write_text(
            "Jane React\n\nSKILLS\nReact, AWS\n\nEXPERIENCE\nBuilt React apps.",
            encoding="utf-8",
        )
        (self.root / "second.txt").write_text("Python engineer", encoding="utf-8")
        self.env = dict(os.environ)
        self.env.update(
            {
                "FILESYSTEM_MCP_ROOT": str(self.root),
                "FILESYSTEM_MCP_ALLOW_WRITE": "false",
                "FILESYSTEM_MCP_MAX_FILE_BYTES": "5000000",
                "FILESYSTEM_MCP_MAX_BATCH_FILES": "10",
                "FILESYSTEM_MCP_TRANSPORT": "stdio",
            }
        )

    async def test_client_connects_and_initializes_session(self) -> None:
        async with self._client() as client:
            self.assertIsNotNone(client.initialize_result)

    async def test_tools_list_returns_all_six_tools(self) -> None:
        async with self._client() as client:
            tools = await client.list_tools()

        self.assertEqual(
            tools,
            [
                "read_file",
                "list_files",
                "write_file",
                "search_in_file",
                "watch_directory",
                "batch_process",
            ],
        )

    async def test_resources_list_returns_expected_resources(self) -> None:
        async with self._client() as client:
            resources = await client.list_resources()

        self.assertIn("filesystem://root", resources)
        self.assertIn("filesystem://files", resources)

    async def test_call_list_files(self) -> None:
        async with self._client() as client:
            result = await client.call_tool("list_files", {"directory": "."})

        self.assertTrue(result["success"])
        self.assertEqual(result["count"], 2)

    async def test_call_read_file(self) -> None:
        async with self._client() as client:
            result = await client.call_tool("read_file", {"filepath": "resume.txt"})

        self.assertTrue(result["success"])
        self.assertIn("Jane React", result["content"])

    async def test_call_search_in_file(self) -> None:
        async with self._client() as client:
            result = await client.call_tool(
                "search_in_file", {"filepath": "resume.txt", "keyword": "React"}
            )

        self.assertTrue(result["success"])
        self.assertGreaterEqual(result["match_count"], 1)

    async def test_call_batch_process(self) -> None:
        async with self._client() as client:
            result = await client.call_tool(
                "batch_process",
                {"operation": "read", "filepaths": ["resume.txt", "second.txt"]},
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["succeeded"], 2)

    async def test_write_with_temp_root_when_enabled(self) -> None:
        env = dict(self.env)
        env["FILESYSTEM_MCP_ALLOW_WRITE"] = "true"

        async with FilesystemMCPClient(env=env) as client:
            result = await client.call_tool(
                "write_file", {"filepath": "out/summary.txt", "content": "shortlist"}
            )

        self.assertTrue(result["success"])
        self.assertEqual(
            (self.root / "out" / "summary.txt").read_text(encoding="utf-8"),
            "shortlist",
        )

    async def test_unknown_tool_raises_client_error(self) -> None:
        async with self._client() as client:
            with self.assertRaises(FilesystemMCPClientError):
                await client.call_tool("missing_tool", {})

    async def test_server_structured_error_is_surfaced(self) -> None:
        async with self._client() as client:
            result = await client.call_tool(
                "read_file", {"filepath": "../outside.txt"}
            )

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "path_outside_root")

    async def test_read_resource_root(self) -> None:
        async with self._client() as client:
            result = await client.read_resource("filesystem://root")

        self.assertTrue(result["success"])
        self.assertEqual(Path(result["root"]), self.root)
        self.assertFalse(result["allow_write"])

    async def test_read_resource_files(self) -> None:
        async with self._client() as client:
            result = await client.read_resource("filesystem://files")

        self.assertTrue(result["success"])
        self.assertEqual(result["count"], 2)

    async def test_client_closes_cleanly(self) -> None:
        client = self._client()
        await client.connect()
        await client.close()

        with self.assertRaises(FilesystemMCPClientError):
            await client.list_tools()

    def _client(self, env: dict[str, str] | None = None) -> FilesystemMCPClient:
        return FilesystemMCPClient(env=env or self.env)


if __name__ == "__main__":
    unittest.main()
