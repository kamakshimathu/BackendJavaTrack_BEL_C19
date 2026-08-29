"""Reusable MCP client for filesystem_mcp_server.py.

This module talks to the server over the MCP stdio transport. It intentionally
does not import filesystem_mcp_server.py so callers exercise the protocol
boundary instead of direct Python function calls.
"""

from __future__ import annotations

import asyncio
import json
import os
import queue
import sys
import threading
from contextlib import AsyncExitStack
from concurrent.futures import Future
from pathlib import Path
from typing import Any

from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client


PROJECT_DIR = Path(__file__).resolve().parent
SERVER_PATH = PROJECT_DIR / "filesystem_mcp_server.py"


class FilesystemMCPClientError(RuntimeError):
    """Raised when the MCP client cannot connect or decode a response."""


class FilesystemMCPClient:
    """Small async wrapper around the MCP stdio client/session APIs."""

    def __init__(
        self,
        server_path: str | Path | None = None,
        *,
        python_executable: str | None = None,
        cwd: str | Path | None = None,
        env: dict[str, str] | None = None,
    ) -> None:
        self.server_path = Path(server_path or SERVER_PATH).resolve()
        self.python_executable = python_executable or sys.executable
        self.cwd = Path(cwd or self.server_path.parent).resolve()
        self.env = dict(os.environ) if env is None else dict(env)
        self._stack: AsyncExitStack | None = None
        self._session: ClientSession | None = None
        self.initialize_result = None

    async def __aenter__(self) -> "FilesystemMCPClient":
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        await self.close()

    async def connect(self) -> "FilesystemMCPClient":
        """Start the MCP server process and initialize a client session."""
        if self._session is not None:
            return self
        if not self.server_path.is_file():
            raise FilesystemMCPClientError(f"MCP server not found: {self.server_path}")

        self._stack = AsyncExitStack()
        server_params = StdioServerParameters(
            command=self.python_executable,
            args=[str(self.server_path)],
            cwd=str(self.cwd),
            env=self.env,
        )
        read_stream, write_stream = await self._stack.enter_async_context(
            stdio_client(server_params)
        )
        self._session = await self._stack.enter_async_context(
            ClientSession(read_stream, write_stream)
        )
        self.initialize_result = await self._session.initialize()
        return self

    async def close(self) -> None:
        """Close the MCP session and terminate the stdio server process."""
        if self._stack is not None:
            await self._stack.aclose()
        self._stack = None
        self._session = None
        self.initialize_result = None

    async def list_tools(self) -> list[str]:
        session = self._require_session()
        result = await session.list_tools()
        return [tool.name for tool in result.tools]

    async def list_resources(self) -> list[str]:
        session = self._require_session()
        result = await session.list_resources()
        return [str(resource.uri) for resource in result.resources]

    async def call_tool(self, tool_name: str, arguments: dict[str, Any] | None = None) -> Any:
        session = self._require_session()
        try:
            result = await session.call_tool(tool_name, arguments or {})
        except Exception as exc:
            raise FilesystemMCPClientError(f"MCP tool call failed for {tool_name}: {exc}") from exc
        return _normalize_tool_result(result)

    async def read_resource(self, uri: str) -> Any:
        session = self._require_session()
        try:
            result = await session.read_resource(uri)
        except Exception as exc:
            raise FilesystemMCPClientError(f"MCP resource read failed for {uri}: {exc}") from exc
        return _normalize_resource_result(result)

    def _require_session(self) -> ClientSession:
        if self._session is None:
            raise FilesystemMCPClientError("MCP client is not connected.")
        return self._session


class SyncFilesystemMCPClient:
    """Synchronous compatibility wrapper for call sites that cannot await yet.

    The wrapper owns one long-lived async client on a background event loop so
    Phase 4 can preserve matching_agent.call_filesystem_tool() as a sync API
    without spawning a server process for every tool call.
    """

    def __init__(self, **client_kwargs: Any) -> None:
        self._client_kwargs = client_kwargs
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._requests: queue.Queue[tuple[str | None, tuple[Any, ...], Future]] = queue.Queue()
        self._ready: Future = Future()

    def connect(self) -> "SyncFilesystemMCPClient":
        if self._thread is not None:
            return self
        self._loop = asyncio.new_event_loop()
        self._ready = Future()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        self._ready.result()
        return self

    def close(self) -> None:
        if self._thread is None:
            return
        future: Future = Future()
        self._requests.put((None, (), future))
        future.result()
        self._thread.join()
        self._loop = None
        self._thread = None

    def list_tools(self) -> list[str]:
        return self._run("list_tools")

    def list_resources(self) -> list[str]:
        return self._run("list_resources")

    def call_tool(self, tool_name: str, arguments: dict[str, Any] | None = None) -> Any:
        return self._run("call_tool", tool_name, arguments)

    def read_resource(self, uri: str) -> Any:
        return self._run("read_resource", uri)

    def _run(self, method_name: str, *args: Any) -> Any:
        self.connect()
        future: Future = Future()
        self._requests.put((method_name, args, future))
        return future.result()

    def _run_loop(self) -> None:
        assert self._loop is not None
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._serve())
        finally:
            self._loop.close()

    async def _serve(self) -> None:
        try:
            async with FilesystemMCPClient(**self._client_kwargs) as client:
                self._ready.set_result(True)
                while True:
                    method_name, args, future = await asyncio.to_thread(self._requests.get)
                    if method_name is None:
                        future.set_result(None)
                        return
                    try:
                        method = getattr(client, method_name)
                        future.set_result(await method(*args))
                    except Exception as exc:
                        future.set_exception(exc)
        except Exception as exc:
            if not self._ready.done():
                self._ready.set_exception(exc)
            raise


def _normalize_tool_result(result: Any) -> Any:
    if getattr(result, "is_error", False) or getattr(result, "isError", False):
        payload = _content_blocks_to_value(result.content)
        raise FilesystemMCPClientError(f"MCP tool returned an error: {payload}")
    return _content_blocks_to_value(result.content)


def _normalize_resource_result(result: Any) -> Any:
    contents = getattr(result, "contents", result)
    return _content_blocks_to_value(contents)


def _content_blocks_to_value(blocks: Any) -> Any:
    if blocks is None:
        return None
    if not isinstance(blocks, list):
        blocks = list(blocks)
    values = [_block_to_value(block) for block in blocks]
    if len(values) == 1:
        return values[0]
    return values


def _block_to_value(block: Any) -> Any:
    if hasattr(block, "text"):
        return _decode_text(block.text)
    if hasattr(block, "data"):
        return block.data
    if hasattr(block, "blob"):
        return block.blob
    if isinstance(block, dict):
        return block
    return block


def _decode_text(text: str) -> Any:
    try:
        return json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return text
