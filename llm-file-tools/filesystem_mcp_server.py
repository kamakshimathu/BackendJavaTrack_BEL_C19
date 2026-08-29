"""MCP server exposing the Milestone 1 filesystem tools safely.

The server is intentionally thin: it validates paths and configuration, then
delegates the actual file operations to fs_tools.py so Milestone 1 behavior
stays intact.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fs_tools
from mcp.server import MCPServer


SERVER_NAME = "llm-file-tools-filesystem"
DEFAULT_ROOT = Path(__file__).resolve().parent
SUPPORTED_READ_EXTENSIONS = {
    ".txt",
    ".md",
    ".markdown",
    ".text",
    ".rtf",
    ".log",
    ".csv",
    ".pdf",
    ".docx",
    "",
}


@dataclass(frozen=True)
class FilesystemMCPConfig:
    root: Path
    allow_write: bool
    max_file_bytes: int
    max_batch_files: int
    watch_max_seconds: int
    transport: str


def load_config() -> FilesystemMCPConfig:
    """Load MCP filesystem configuration from environment variables."""
    root_value = os.environ.get("FILESYSTEM_MCP_ROOT")
    root = Path(root_value).expanduser() if root_value else DEFAULT_ROOT
    if not root.is_absolute():
        root = Path.cwd() / root

    return FilesystemMCPConfig(
        root=root.resolve(strict=False),
        allow_write=_env_bool("FILESYSTEM_MCP_ALLOW_WRITE", default=False),
        max_file_bytes=_env_int("FILESYSTEM_MCP_MAX_FILE_BYTES", 5_000_000),
        max_batch_files=_env_int("FILESYSTEM_MCP_MAX_BATCH_FILES", 50),
        watch_max_seconds=_env_int("FILESYSTEM_MCP_WATCH_MAX_SECONDS", 30),
        transport=os.environ.get("FILESYSTEM_MCP_TRANSPORT", "stdio").lower(),
    )


def read_file_tool(filepath: str) -> dict[str, Any]:
    resolved = _resolve_existing_file(filepath)
    if _is_error(resolved):
        return resolved

    size_error = _check_file_size(resolved["path"])
    if size_error:
        return size_error

    return _normalize_fs_result(fs_tools.read_file(str(resolved["path"])))


def list_files_tool(directory: str = ".", extension: str | None = None) -> dict[str, Any]:
    resolved = _resolve_existing_directory(directory)
    if _is_error(resolved):
        return resolved

    files = fs_tools.list_files(str(resolved["path"]), extension)
    if files and len(files) == 1 and files[0].get("success") is False:
        return _error("invalid_arguments", files[0].get("error", "Failed to list files."))

    return {
        "success": True,
        "directory": _relative_path(resolved["path"]),
        "extension": extension,
        "files": files,
        "count": len(files),
        "error": None,
    }


def write_file_tool(filepath: str, content: str) -> dict[str, Any]:
    config = load_config()
    if not config.allow_write:
        return _error("write_disabled", "Filesystem MCP writes are disabled.")
    if not isinstance(content, str):
        return _error("invalid_arguments", "content must be a string.")

    resolved = _resolve_write_target(filepath)
    if _is_error(resolved):
        return resolved

    return _normalize_fs_result(fs_tools.write_file(str(resolved["path"]), content))


def search_in_file_tool(
    filepath: str, keyword: str, context_chars: int = 60
) -> dict[str, Any]:
    if not isinstance(keyword, str) or not keyword:
        return _error("invalid_arguments", "keyword must be a non-empty string.")
    if not isinstance(context_chars, int) or context_chars < 0:
        return _error("invalid_arguments", "context_chars must be a non-negative integer.")

    resolved = _resolve_existing_file(filepath)
    if _is_error(resolved):
        return resolved

    size_error = _check_file_size(resolved["path"])
    if size_error:
        return size_error

    return _normalize_fs_result(
        fs_tools.search_in_file(str(resolved["path"]), keyword, context_chars)
    )


def watch_directory_tool(
    directory: str = ".",
    duration_seconds: float = 5.0,
    interval_seconds: float = 0.5,
    extension: str | None = None,
    recursive: bool = False,
) -> dict[str, Any]:
    resolved = _resolve_existing_directory(directory)
    if _is_error(resolved):
        return resolved

    interval_error = _validate_poll_interval(interval_seconds)
    if interval_error:
        return interval_error

    config = load_config()
    try:
        requested_duration = float(duration_seconds)
    except (TypeError, ValueError):
        return _error("invalid_arguments", "duration_seconds must be a number.")
    if requested_duration <= 0:
        return _error("invalid_arguments", "duration_seconds must be greater than zero.")

    effective_duration = min(requested_duration, float(config.watch_max_seconds))
    normalized_ext = _normalize_extension(extension)
    if _is_error(normalized_ext):
        return normalized_ext

    directory_path = resolved["path"]
    initial = _directory_snapshot(directory_path, normalized_ext["extension"], recursive)
    deadline = time.monotonic() + effective_duration
    latest = initial
    while time.monotonic() < deadline:
        time.sleep(min(float(interval_seconds), max(0.0, deadline - time.monotonic())))
        latest = _directory_snapshot(directory_path, normalized_ext["extension"], recursive)

    created = sorted(path for path in latest if path not in initial)
    deleted = sorted(path for path in initial if path not in latest)
    modified = sorted(
        path
        for path in latest
        if path in initial and latest[path] != initial[path]
    )

    return {
        "success": True,
        "directory": _relative_path(directory_path),
        "duration_seconds": effective_duration,
        "requested_duration_seconds": requested_duration,
        "interval_seconds": float(interval_seconds),
        "extension": normalized_ext["extension"],
        "recursive": recursive,
        "created": created,
        "modified": modified,
        "deleted": deleted,
        "error": None,
    }


def batch_process_tool(
    operation: str,
    directory: str | None = None,
    filepaths: list[str] | None = None,
    extension: str | None = None,
    keyword: str | None = None,
    max_files: int | None = None,
    continue_on_error: bool = True,
) -> dict[str, Any]:
    if not isinstance(operation, str) or not operation.strip():
        return _error("invalid_arguments", "operation must be a non-empty string.")
    operation = operation.strip().lower()
    if operation not in {"read", "search", "metadata", "list"}:
        return _error(
            "invalid_arguments",
            "operation must be one of: read, search, metadata, list.",
        )
    if operation == "search" and (not isinstance(keyword, str) or not keyword):
        return _error("invalid_arguments", "keyword is required for search.")

    selected_limit = _batch_limit(max_files)
    if _is_error(selected_limit):
        return selected_limit

    targets = _batch_targets(directory, filepaths, extension)
    if _is_error(targets):
        return targets
    if not targets["filepaths"]:
        return _error("invalid_arguments", "No input files were provided or discovered.")
    if len(targets["filepaths"]) > selected_limit["limit"]:
        return _error(
            "invalid_arguments",
            f"Batch input exceeds maximum file limit ({selected_limit['limit']}).",
        )

    results = []
    for filepath in targets["filepaths"]:
        if operation == "read":
            result = read_file_tool(filepath)
        elif operation == "search":
            result = search_in_file_tool(filepath, keyword or "")
        else:
            result = _metadata_for_file(filepath)

        results.append(result)
        if result.get("success") is False and not continue_on_error:
            break

    succeeded = sum(1 for result in results if result.get("success"))
    failed = len(results) - succeeded
    return {
        "success": failed == 0,
        "partial_success": succeeded > 0 and failed > 0,
        "operation": operation,
        "total": len(results),
        "succeeded": succeeded,
        "failed": failed,
        "results": results,
        "error": None if failed == 0 else {"code": "partial_failure", "message": "One or more batch items failed."},
    }


server = MCPServer(SERVER_NAME)


@server.tool(name="read_file")
def read_file(filepath: str) -> dict[str, Any]:
    """Read a file under the configured filesystem MCP root."""
    return read_file_tool(filepath)


@server.tool(name="list_files")
def list_files(directory: str = ".", extension: str | None = None) -> dict[str, Any]:
    """List files under the configured filesystem MCP root."""
    return list_files_tool(directory, extension)


@server.tool(name="write_file")
def write_file(filepath: str, content: str) -> dict[str, Any]:
    """Write a file under the configured filesystem MCP root when enabled."""
    return write_file_tool(filepath, content)


@server.tool(name="search_in_file")
def search_in_file(
    filepath: str, keyword: str, context_chars: int = 60
) -> dict[str, Any]:
    """Search for a keyword inside a file under the configured MCP root."""
    return search_in_file_tool(filepath, keyword, context_chars)


@server.tool(name="watch_directory")
def watch_directory(
    directory: str = ".",
    duration_seconds: float = 5.0,
    interval_seconds: float = 0.5,
    extension: str | None = None,
    recursive: bool = False,
) -> dict[str, Any]:
    """Watch a directory briefly and report created, modified, and deleted files."""
    return watch_directory_tool(
        directory, duration_seconds, interval_seconds, extension, recursive
    )


@server.tool(name="batch_process")
def batch_process(
    operation: str,
    directory: str | None = None,
    filepaths: list[str] | None = None,
    extension: str | None = None,
    keyword: str | None = None,
    max_files: int | None = None,
    continue_on_error: bool = True,
) -> dict[str, Any]:
    """Process several files through the secured MCP filesystem wrappers."""
    return batch_process_tool(
        operation,
        directory,
        filepaths,
        extension,
        keyword,
        max_files,
        continue_on_error,
    )


@server.resource("filesystem://root")
def filesystem_root() -> dict[str, Any]:
    """Return the configured filesystem root and active limits."""
    config = load_config()
    return {
        "success": True,
        "root": str(config.root),
        "allow_write": config.allow_write,
        "max_file_bytes": config.max_file_bytes,
        "max_batch_files": config.max_batch_files,
        "watch_max_seconds": config.watch_max_seconds,
        "transport": config.transport,
        "error": None,
    }


@server.resource("filesystem://files")
def filesystem_files() -> dict[str, Any]:
    """List files at the configured filesystem MCP root."""
    return list_files_tool(".")


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _validate_poll_interval(interval_seconds: float) -> dict[str, Any] | None:
    try:
        interval = float(interval_seconds)
    except (TypeError, ValueError):
        return _error("invalid_arguments", "interval_seconds must be a number.")
    if interval < 0.01:
        return _error("invalid_arguments", "interval_seconds must be at least 0.01.")
    if interval > 60:
        return _error("invalid_arguments", "interval_seconds is unreasonably large.")
    return None


def _normalize_extension(extension: str | None) -> dict[str, Any]:
    if extension is None or extension == "":
        return {"success": True, "extension": None}
    if not isinstance(extension, str):
        return _error("invalid_arguments", "extension must be a string.")
    normalized = extension.lower().strip()
    if not normalized:
        return {"success": True, "extension": None}
    if not normalized.startswith("."):
        normalized = "." + normalized
    return {"success": True, "extension": normalized}


def _directory_snapshot(
    directory: Path, extension: str | None, recursive: bool
) -> dict[str, tuple[int, int]]:
    paths = directory.rglob("*") if recursive else directory.iterdir()
    snapshot = {}
    for path in paths:
        try:
            resolved = path.resolve(strict=True)
        except OSError:
            continue
        if not resolved.is_file():
            continue
        if not _is_within_root(resolved, load_config().root):
            continue
        if extension and resolved.suffix.lower() != extension:
            continue
        try:
            stat = resolved.stat()
        except OSError:
            continue
        snapshot[_relative_path(resolved)] = (stat.st_size, stat.st_mtime_ns)
    return snapshot


def _batch_limit(max_files: int | None) -> dict[str, Any]:
    configured_limit = load_config().max_batch_files
    if max_files is None:
        return {"success": True, "limit": configured_limit}
    if not isinstance(max_files, int) or max_files <= 0:
        return _error("invalid_arguments", "max_files must be a positive integer.")
    return {"success": True, "limit": min(max_files, configured_limit)}


def _batch_targets(
    directory: str | None, filepaths: list[str] | None, extension: str | None
) -> dict[str, Any]:
    if filepaths is not None:
        if not isinstance(filepaths, list):
            return _error("invalid_arguments", "filepaths must be a list of strings.")
        if not all(isinstance(filepath, str) for filepath in filepaths):
            return _error("invalid_arguments", "filepaths must be a list of strings.")
        return {"success": True, "filepaths": list(filepaths)}

    if directory is None:
        return _error("invalid_arguments", "Provide either filepaths or directory.")

    listing = list_files_tool(directory, extension)
    if _is_error(listing):
        return listing
    return {
        "success": True,
        "filepaths": [file_info["path"] for file_info in listing["files"]],
    }


def _metadata_for_file(filepath: str) -> dict[str, Any]:
    resolved = _resolve_existing_file(filepath)
    if _is_error(resolved):
        return resolved
    size_error = _check_file_size(resolved["path"])
    if size_error:
        return size_error
    try:
        metadata = fs_tools._file_metadata(str(resolved["path"]))
    except OSError as exc:
        return _error("invalid_arguments", f"Unable to read metadata: {exc}")
    return {"success": True, "filepath": _relative_path(resolved["path"]), "metadata": metadata, "error": None}


def _resolve_existing_file(path_value: str) -> dict[str, Any]:
    resolved = _resolve_path(path_value)
    if _is_error(resolved):
        return resolved

    path = resolved["path"]
    if not path.exists():
        return _error("not_found", f"File not found: {_display_path(path)}")
    if not path.is_file():
        return _error("not_file", f"Not a file: {_display_path(path)}")

    extension = path.suffix.lower()
    if extension not in SUPPORTED_READ_EXTENSIONS:
        return _error(
            "unsupported_extension",
            f"Unsupported file type '{extension}'. Supported: .txt, .md, .pdf, .docx",
        )

    return {"success": True, "path": path}


def _resolve_existing_directory(path_value: str) -> dict[str, Any]:
    resolved = _resolve_path(path_value)
    if _is_error(resolved):
        return resolved

    path = resolved["path"]
    if not path.exists():
        return _error("not_found", f"Directory not found: {_display_path(path)}")
    if not path.is_dir():
        return _error("not_directory", f"Not a directory: {_display_path(path)}")

    return {"success": True, "path": path}


def _resolve_write_target(path_value: str) -> dict[str, Any]:
    resolved = _resolve_path(path_value)
    if _is_error(resolved):
        return resolved

    path = resolved["path"]
    if path.exists() and path.is_dir():
        return _error("not_file", f"Not a file: {_display_path(path)}")

    extension = path.suffix.lower()
    if extension not in SUPPORTED_READ_EXTENSIONS:
        return _error(
            "unsupported_extension",
            f"Unsupported file type '{extension}'. Supported: .txt, .md, .pdf, .docx",
        )

    parent = path.parent
    existing_parent = parent
    while not existing_parent.exists() and existing_parent != existing_parent.parent:
        existing_parent = existing_parent.parent
    try:
        existing_parent = existing_parent.resolve(strict=True)
    except OSError as exc:
        return _error("invalid_arguments", f"Invalid write target: {exc}")

    if not existing_parent.is_dir():
        return _error("not_directory", f"Parent is not a directory: {_display_path(parent)}")
    if not _is_within_root(existing_parent, load_config().root):
        return _error("path_outside_root", "Path resolves outside the configured MCP root.")

    return {"success": True, "path": path}


def _resolve_path(path_value: str) -> dict[str, Any]:
    if not isinstance(path_value, str) or not path_value.strip():
        return _error("invalid_arguments", "path must be a non-empty string.")
    if _has_parent_traversal(path_value):
        return _error("path_outside_root", "Parent directory traversal is not allowed.")

    config = load_config()
    root = config.root
    if not root.exists():
        return _error("not_found", f"MCP root not found: {root}")
    try:
        root = root.resolve(strict=True)
    except OSError as exc:
        return _error("invalid_arguments", f"Invalid MCP root: {exc}")
    if not root.is_dir():
        return _error("not_directory", f"MCP root is not a directory: {root}")

    raw = Path(path_value).expanduser()
    target = raw if raw.is_absolute() else root / raw
    try:
        resolved = target.resolve(strict=target.exists())
    except OSError as exc:
        return _error("invalid_arguments", f"Invalid path: {exc}")

    if not _is_within_root(resolved, root):
        return _error("path_outside_root", "Path resolves outside the configured MCP root.")

    return {"success": True, "path": resolved}


def _has_parent_traversal(path_value: str) -> bool:
    return ".." in Path(path_value).parts


def _is_within_root(path: Path, root: Path) -> bool:
    try:
        path_text = os.path.normcase(os.path.abspath(str(path)))
        root_text = os.path.normcase(os.path.abspath(str(root)))
        return os.path.commonpath([path_text, root_text]) == root_text
    except ValueError:
        return False


def _check_file_size(path: Path) -> dict[str, Any] | None:
    max_bytes = load_config().max_file_bytes
    try:
        size = path.stat().st_size
    except OSError as exc:
        return _error("invalid_arguments", f"Unable to stat file: {exc}")
    if size > max_bytes:
        return _error(
            "invalid_arguments",
            f"File exceeds FILESYSTEM_MCP_MAX_FILE_BYTES ({max_bytes}).",
        )
    return None


def _normalize_fs_result(result: dict[str, Any]) -> dict[str, Any]:
    if result.get("success"):
        return result
    message = result.get("error") or "Filesystem operation failed."
    return _error("invalid_arguments", message)


def _error(code: str, message: str) -> dict[str, Any]:
    return {
        "success": False,
        "error": {"code": code, "message": message},
        "message": message,
    }


def _is_error(result: dict[str, Any]) -> bool:
    return result.get("success") is False


def _relative_path(path: Path) -> str:
    root = load_config().root.resolve(strict=False)
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _display_path(path: Path) -> str:
    try:
        return _relative_path(path)
    except OSError:
        return str(path)


def main() -> None:
    config = load_config()
    server.run(transport=config.transport)


if __name__ == "__main__":
    main()
