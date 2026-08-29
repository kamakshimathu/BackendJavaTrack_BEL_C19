"""Small offline demo for the Milestone 4 filesystem MCP implementation."""

from __future__ import annotations

import asyncio
import os
import tempfile
import threading
import time
from pathlib import Path

from filesystem_mcp_client import FilesystemMCPClient


async def main() -> None:
    with tempfile.TemporaryDirectory() as tempdir:
        root = Path(tempdir)
        (root / "resume_a.txt").write_text(
            "Aisha Backend\n\nSKILLS\nPython, FastAPI, AWS", encoding="utf-8"
        )
        (root / "resume_b.txt").write_text(
            "Ben Platform\n\nSKILLS\nKubernetes, AWS", encoding="utf-8"
        )

        env = dict(os.environ)
        env.update(
            {
                "FILESYSTEM_MCP_ROOT": str(root),
                "FILESYSTEM_MCP_ALLOW_WRITE": "false",
                "FILESYSTEM_MCP_WATCH_MAX_SECONDS": "2",
            }
        )

        async with FilesystemMCPClient(env=env) as client:
            print("MCP tools")
            print(await client.list_tools())
            print()

            print("MCP resources")
            print(await client.list_resources())
            print()

            print("list_files")
            print(await client.call_tool("list_files", {"directory": "."}))
            print()

            print("batch_process")
            print(
                await client.call_tool(
                    "batch_process",
                    {
                        "operation": "search",
                        "filepaths": ["resume_a.txt", "resume_b.txt"],
                        "keyword": "AWS",
                    },
                )
            )
            print()

            def create_file() -> None:
                time.sleep(0.05)
                (root / "resume_c.txt").write_text("Created during watch", encoding="utf-8")

            thread = threading.Thread(target=create_file)
            thread.start()
            try:
                print("watch_directory")
                print(
                    await client.call_tool(
                        "watch_directory",
                        {
                            "directory": ".",
                            "duration_seconds": 0.25,
                            "interval_seconds": 0.03,
                            "extension": ".txt",
                        },
                    )
                )
            finally:
                thread.join()


if __name__ == "__main__":
    asyncio.run(main())
