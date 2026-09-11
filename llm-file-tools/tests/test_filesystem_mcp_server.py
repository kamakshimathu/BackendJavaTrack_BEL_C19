from __future__ import annotations

import json
import os
import tempfile
import unittest
import asyncio
import threading
import time
from pathlib import Path

import fs_tools
import filesystem_mcp_server as mcp_server


class EnvMixin:
    def set_env(self, **values: str) -> None:
        original = {name: os.environ.get(name) for name in values}
        for name, value in values.items():
            os.environ[name] = value

        def restore() -> None:
            for name, value in original.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value

        self.addCleanup(restore)


class FilesystemMCPServerTests(EnvMixin, unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.root = Path(self.tempdir.name)
        self.resume = self.root / "resume.txt"
        self.resume.write_text(
            "Jane React\n\nSKILLS\nReact, AWS\n\nEXPERIENCE\nBuilt React apps.",
            encoding="utf-8",
        )
        (self.root / "notes.bin").write_bytes(b"\x00\x01")
        self.set_env(
            FILESYSTEM_MCP_ROOT=str(self.root),
            FILESYSTEM_MCP_ALLOW_WRITE="false",
            FILESYSTEM_MCP_MAX_FILE_BYTES="5000000",
            FILESYSTEM_MCP_TRANSPORT="stdio",
        )

    def test_tool_discovery_exposes_milestone_1_tools(self) -> None:
        tools = asyncio.run(mcp_server.server.list_tools())
        names = {tool.name for tool in tools}

        self.assertIn("read_file", names)
        self.assertIn("list_files", names)
        self.assertIn("write_file", names)
        self.assertIn("search_in_file", names)
        self.assertIn("watch_directory", names)
        self.assertIn("batch_process", names)

    def test_resource_discovery_exposes_filesystem_resources(self) -> None:
        resources = asyncio.run(mcp_server.server.list_resources())
        uris = {str(resource.uri) for resource in resources}

        self.assertIn("filesystem://root", uris)
        self.assertIn("filesystem://files", uris)

    def test_read_valid_file_through_wrapper(self) -> None:
        result = mcp_server.read_file_tool("resume.txt")

        self.assertTrue(result["success"])
        self.assertIn("Jane React", result["content"])
        self.assertEqual(result["metadata"]["extension"], ".txt")

    def test_read_valid_file_through_mcp_tool(self) -> None:
        result = _tool_payload(
            asyncio.run(
                mcp_server.server.call_tool("read_file", {"filepath": "resume.txt"})
            )
        )

        self.assertTrue(result["success"])
        self.assertIn("Jane React", result["content"])

    def test_list_files(self) -> None:
        result = mcp_server.list_files_tool(".", extension=".txt")

        self.assertTrue(result["success"])
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["files"][0]["name"], "resume.txt")

    def test_search_file(self) -> None:
        result = mcp_server.search_in_file_tool("resume.txt", "React")

        self.assertTrue(result["success"])
        self.assertGreaterEqual(result["match_count"], 1)

    def test_write_when_enabled(self) -> None:
        self.set_env(FILESYSTEM_MCP_ALLOW_WRITE="true")

        result = mcp_server.write_file_tool("out/summary.txt", "shortlist")

        self.assertTrue(result["success"])
        self.assertEqual((self.root / "out" / "summary.txt").read_text(encoding="utf-8"), "shortlist")

    def test_write_when_disabled(self) -> None:
        result = mcp_server.write_file_tool("out/summary.txt", "shortlist")

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "write_disabled")
        self.assertFalse((self.root / "out" / "summary.txt").exists())

    def test_path_traversal_is_rejected(self) -> None:
        result = mcp_server.read_file_tool("../resume.txt")

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "path_outside_root")

    def test_absolute_path_outside_root_is_rejected(self) -> None:
        outside = self.root.parent / "outside.txt"

        result = mcp_server.read_file_tool(str(outside))

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "path_outside_root")

    def test_unsupported_extension_is_rejected_before_fs_tools(self) -> None:
        result = mcp_server.read_file_tool("notes.bin")

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "unsupported_extension")

    def test_invalid_input_returns_structured_error(self) -> None:
        result = mcp_server.read_file_tool("")

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "invalid_arguments")

    def test_symlink_escape_is_rejected_when_supported(self) -> None:
        outside = self.root.parent / "outside-symlink-target.txt"
        outside.write_text("outside", encoding="utf-8")
        link = self.root / "escape.txt"
        try:
            link.symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("Symlinks are not available for this test environment.")

        result = mcp_server.read_file_tool("escape.txt")

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "path_outside_root")

    def test_watch_directory_detects_created_file(self) -> None:
        def create_file() -> None:
            time.sleep(0.03)
            (self.root / "created.txt").write_text("new", encoding="utf-8")

        thread = _start_thread(create_file)
        result = mcp_server.watch_directory_tool(
            ".", duration_seconds=0.12, interval_seconds=0.02
        )
        thread.join()

        self.assertTrue(result["success"])
        self.assertIn("created.txt", result["created"])

    def test_watch_directory_detects_modified_file(self) -> None:
        def modify_file() -> None:
            time.sleep(0.03)
            self.resume.write_text("Jane React updated", encoding="utf-8")

        thread = _start_thread(modify_file)
        result = mcp_server.watch_directory_tool(
            ".", duration_seconds=0.12, interval_seconds=0.02
        )
        thread.join()

        self.assertTrue(result["success"])
        self.assertIn("resume.txt", result["modified"])

    def test_watch_directory_detects_deleted_file(self) -> None:
        doomed = self.root / "delete-me.txt"
        doomed.write_text("temporary", encoding="utf-8")

        def delete_file() -> None:
            time.sleep(0.03)
            doomed.unlink()

        thread = _start_thread(delete_file)
        result = mcp_server.watch_directory_tool(
            ".", duration_seconds=0.12, interval_seconds=0.02
        )
        thread.join()

        self.assertTrue(result["success"])
        self.assertIn("delete-me.txt", result["deleted"])

    def test_watch_directory_extension_filter(self) -> None:
        def create_files() -> None:
            time.sleep(0.03)
            (self.root / "included.txt").write_text("yes", encoding="utf-8")
            (self.root / "ignored.md").write_text("no", encoding="utf-8")

        thread = _start_thread(create_files)
        result = mcp_server.watch_directory_tool(
            ".", duration_seconds=0.12, interval_seconds=0.02, extension=".txt"
        )
        thread.join()

        self.assertTrue(result["success"])
        self.assertIn("included.txt", result["created"])
        self.assertNotIn("ignored.md", result["created"])

    def test_watch_directory_invalid_directory(self) -> None:
        result = mcp_server.watch_directory_tool("missing")

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "not_found")

    def test_watch_directory_rejects_outside_root(self) -> None:
        result = mcp_server.watch_directory_tool(str(self.root.parent))

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "path_outside_root")

    def test_watch_directory_caps_duration(self) -> None:
        self.set_env(FILESYSTEM_MCP_WATCH_MAX_SECONDS="1")

        result = mcp_server.watch_directory_tool(
            ".", duration_seconds=2, interval_seconds=0.05
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["duration_seconds"], 1.0)
        self.assertEqual(result["requested_duration_seconds"], 2.0)

    def test_watch_directory_rejects_invalid_polling_interval(self) -> None:
        result = mcp_server.watch_directory_tool(".", interval_seconds=0)

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "invalid_arguments")

    def test_batch_read_explicit_filepaths(self) -> None:
        second = self.root / "second.txt"
        second.write_text("Second resume", encoding="utf-8")

        result = mcp_server.batch_process_tool(
            "read", filepaths=["resume.txt", "second.txt"]
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["succeeded"], 2)
        self.assertTrue(all(item["success"] for item in result["results"]))

    def test_batch_search(self) -> None:
        second = self.root / "second.txt"
        second.write_text("No keyword here", encoding="utf-8")

        result = mcp_server.batch_process_tool(
            "search", filepaths=["resume.txt", "second.txt"], keyword="React"
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 2)
        self.assertGreaterEqual(result["results"][0]["match_count"], 1)
        self.assertEqual(result["results"][1]["match_count"], 0)

    def test_batch_directory_extension_discovery(self) -> None:
        (self.root / "second.txt").write_text("Second resume", encoding="utf-8")
        (self.root / "ignored.md").write_text("Markdown", encoding="utf-8")

        result = mcp_server.batch_process_tool(
            "metadata", directory=".", extension=".txt"
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["succeeded"], 2)

    def test_batch_partial_failure_continue_on_error(self) -> None:
        result = mcp_server.batch_process_tool(
            "read", filepaths=["resume.txt", "missing.txt"], continue_on_error=True
        )

        self.assertFalse(result["success"])
        self.assertTrue(result["partial_success"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(result["failed"], 1)

    def test_batch_stops_on_first_failure_when_configured(self) -> None:
        result = mcp_server.batch_process_tool(
            "read",
            filepaths=["missing.txt", "resume.txt"],
            continue_on_error=False,
        )

        self.assertFalse(result["success"])
        self.assertFalse(result["partial_success"])
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["failed"], 1)

    def test_batch_max_limit(self) -> None:
        self.set_env(FILESYSTEM_MCP_MAX_BATCH_FILES="1")

        result = mcp_server.batch_process_tool(
            "read", filepaths=["resume.txt", "notes.bin"], max_files=10
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "invalid_arguments")

    def test_batch_search_requires_keyword(self) -> None:
        result = mcp_server.batch_process_tool("search", filepaths=["resume.txt"])

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "invalid_arguments")

    def test_batch_rejects_outside_root_file(self) -> None:
        outside = self.root.parent / "outside-batch.txt"
        outside.write_text("outside", encoding="utf-8")

        result = mcp_server.batch_process_tool(
            "read", filepaths=["resume.txt", str(outside)]
        )

        self.assertFalse(result["success"])
        self.assertTrue(result["partial_success"])
        self.assertEqual(result["results"][1]["error"]["code"], "path_outside_root")

    def test_batch_rejects_empty_input(self) -> None:
        result = mcp_server.batch_process_tool("read")

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "invalid_arguments")

    def test_batch_rejects_invalid_operation(self) -> None:
        result = mcp_server.batch_process_tool("write", filepaths=["resume.txt"])

        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "invalid_arguments")


class Milestone1RegressionTests(unittest.TestCase):
    def test_existing_fs_tools_read_write_search_list_behavior(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            path = root / "resume.txt"

            write_result = fs_tools.write_file(str(path), "Python engineer\nPython")
            read_result = fs_tools.read_file(str(path))
            search_result = fs_tools.search_in_file(str(path), "python")
            files = fs_tools.list_files(str(root), extension="txt")

        self.assertTrue(write_result["success"])
        self.assertTrue(read_result["success"])
        self.assertEqual(search_result["match_count"], 2)
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0]["name"], "resume.txt")


def _tool_payload(call_result) -> dict:
    content = call_result.content[0]
    if hasattr(content, "text"):
        return json.loads(content.text)
    return content.data


def _start_thread(target) -> threading.Thread:
    thread = threading.Thread(target=target)
    thread.start()
    return thread


if __name__ == "__main__":
    unittest.main()
