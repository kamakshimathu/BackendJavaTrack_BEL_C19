"""fs_tools.py — Core file-system tools for an LLM file assistant.

This module exposes four tools with clean, structured (JSON-serialisable)
return values so they can be wired directly into an LLM's tool-calling loop:

    read_file(filepath)                 -> dict
    list_files(directory, extension)    -> list[dict]
    write_file(filepath, content)       -> dict
    search_in_file(filepath, keyword)   -> dict

Design principles
-----------------
* Every function returns data, never raises for *expected* failures
  (missing file, bad extension, permission error). Failures come back as a
  structured payload with ``"success": False`` and an ``"error"`` string, so
  the LLM can read the error and decide what to do next.
* ``read_file`` understands ``.txt`` / ``.md``, ``.pdf`` (via ``pypdf``) and
  ``.docx`` (via ``python-docx``). PDF/DOCX support degrades gracefully with a
  helpful message if the optional dependency is missing.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Optional parsers. Imported lazily-ish here so a missing dependency only
# affects the format that needs it, not the whole module.
# ---------------------------------------------------------------------------
try:
    from pypdf import PdfReader  # type: ignore
except ImportError:  # pragma: no cover - exercised only without the dep
    PdfReader = None

try:
    import docx  # type: ignore  (python-docx)
except ImportError:  # pragma: no cover
    docx = None


# Extensions we treat as plain UTF-8 text.
_TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".text", ".rtf", ".log", ".csv"}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
def _iso(ts: float) -> str:
    """Convert an epoch timestamp to a readable UTC ISO-8601 string."""
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _file_metadata(filepath: str) -> dict:
    """Return name/size/modified metadata for an existing file."""
    stat = os.stat(filepath)
    return {
        "name": os.path.basename(filepath),
        "path": os.path.abspath(filepath),
        "extension": os.path.splitext(filepath)[1].lower(),
        "size_bytes": stat.st_size,
        "modified": _iso(stat.st_mtime),
    }


def _read_pdf(filepath: str) -> str:
    if PdfReader is None:
        raise RuntimeError(
            "Reading PDF files requires the 'pypdf' package. "
            "Install it with: pip install pypdf"
        )
    reader = PdfReader(filepath)
    pages = [(page.extract_text() or "") for page in reader.pages]
    return "\n".join(pages).strip()


def _read_docx(filepath: str) -> str:
    if docx is None:
        raise RuntimeError(
            "Reading DOCX files requires the 'python-docx' package. "
            "Install it with: pip install python-docx"
        )
    document = docx.Document(filepath)
    return "\n".join(p.text for p in document.paragraphs).strip()


def _read_text(filepath: str) -> str:
    # errors="replace" keeps us robust against the odd non-UTF-8 byte.
    with open(filepath, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


# ---------------------------------------------------------------------------
# Public tools
# ---------------------------------------------------------------------------
def read_file(filepath: str) -> dict:
    """Read a resume file and extract its text content.

    Supports ``.txt``/``.md``, ``.pdf`` and ``.docx``.

    Returns a dict::

        {
            "success": bool,
            "filepath": str,
            "content": str,          # extracted text ("" on failure)
            "metadata": dict,        # name, size_bytes, modified, extension...
            "error": str | None,
        }
    """
    result = {
        "success": False,
        "filepath": filepath,
        "content": "",
        "metadata": {},
        "error": None,
    }

    if not os.path.exists(filepath):
        result["error"] = f"File not found: {filepath}"
        return result
    if not os.path.isfile(filepath):
        result["error"] = f"Not a file (is it a directory?): {filepath}"
        return result

    extension = os.path.splitext(filepath)[1].lower()
    try:
        if extension == ".pdf":
            content = _read_pdf(filepath)
        elif extension == ".docx":
            content = _read_docx(filepath)
        elif extension in _TEXT_EXTENSIONS or extension == "":
            content = _read_text(filepath)
        else:
            result["error"] = (
                f"Unsupported file type '{extension}'. "
                "Supported: .txt, .md, .pdf, .docx"
            )
            return result

        result["content"] = content
        result["metadata"] = _file_metadata(filepath)
        result["metadata"]["char_count"] = len(content)
        result["metadata"]["word_count"] = len(content.split())
        result["success"] = True
    except Exception as exc:  # pragma: no cover - defensive
        result["error"] = f"Failed to read '{filepath}': {exc}"

    return result


def list_files(directory: str, extension: str | None = None) -> list:
    """List files in ``directory``, optionally filtered by ``extension``.

    ``extension`` may be given with or without the leading dot
    (e.g. ``".pdf"`` or ``"pdf"``). The comparison is case-insensitive.

    Returns a list of metadata dicts (one per file). On error a single-item
    list containing an error payload is returned so callers/LLMs always get a
    list back and can detect the problem.
    """
    if not os.path.exists(directory):
        return [{"success": False, "error": f"Directory not found: {directory}"}]
    if not os.path.isdir(directory):
        return [{"success": False, "error": f"Not a directory: {directory}"}]

    normalized_ext = None
    if extension:
        normalized_ext = extension.lower()
        if not normalized_ext.startswith("."):
            normalized_ext = "." + normalized_ext

    files = []
    for entry in sorted(os.listdir(directory)):
        full_path = os.path.join(directory, entry)
        if not os.path.isfile(full_path):
            continue
        if normalized_ext and os.path.splitext(entry)[1].lower() != normalized_ext:
            continue
        try:
            files.append(_file_metadata(full_path))
        except OSError:
            # Skip files we can't stat (e.g. removed mid-listing).
            continue

    return files


def write_file(filepath: str, content: str) -> dict:
    """Write ``content`` to ``filepath``, creating parent directories if needed.

    Returns::

        {
            "success": bool,
            "filepath": str,
            "bytes_written": int,
            "created_directories": bool,
            "error": str | None,
        }
    """
    result = {
        "success": False,
        "filepath": os.path.abspath(filepath),
        "bytes_written": 0,
        "created_directories": False,
        "error": None,
    }

    try:
        parent = os.path.dirname(os.path.abspath(filepath))
        if parent and not os.path.isdir(parent):
            os.makedirs(parent, exist_ok=True)
            result["created_directories"] = True

        with open(filepath, "w", encoding="utf-8") as fh:
            fh.write(content)

        result["bytes_written"] = len(content.encode("utf-8"))
        result["success"] = True
    except Exception as exc:  # pragma: no cover - defensive
        result["error"] = f"Failed to write '{filepath}': {exc}"

    return result


def search_in_file(filepath: str, keyword: str, context_chars: int = 60) -> dict:
    """Case-insensitive search for ``keyword`` within a file's text content.

    Each match is returned with the surrounding text so the caller can see
    where the term appears.

    Returns::

        {
            "success": bool,
            "filepath": str,
            "keyword": str,
            "match_count": int,
            "matches": [
                {"line": int, "position": int, "context": str},
                ...
            ],
            "error": str | None,
        }
    """
    result = {
        "success": False,
        "filepath": filepath,
        "keyword": keyword,
        "match_count": 0,
        "matches": [],
        "error": None,
    }

    if not keyword:
        result["error"] = "Search keyword must not be empty."
        return result

    read = read_file(filepath)
    if not read["success"]:
        result["error"] = read["error"]
        return result

    content = read["content"]
    haystack = content.lower()
    needle = keyword.lower()

    matches = []
    start = 0
    while True:
        idx = haystack.find(needle, start)
        if idx == -1:
            break

        # Human-friendly 1-based line number for this match.
        line_number = content.count("\n", 0, idx) + 1

        ctx_start = max(0, idx - context_chars)
        ctx_end = min(len(content), idx + len(keyword) + context_chars)
        snippet = content[ctx_start:ctx_end].replace("\n", " ").strip()
        if ctx_start > 0:
            snippet = "…" + snippet
        if ctx_end < len(content):
            snippet = snippet + "…"

        matches.append(
            {"line": line_number, "position": idx, "context": snippet}
        )
        start = idx + len(needle)

    result["matches"] = matches
    result["match_count"] = len(matches)
    result["success"] = True
    return result


# Convenience mapping used by the LLM assistant to dispatch tool calls.
TOOLS = {
    "read_file": read_file,
    "list_files": list_files,
    "write_file": write_file,
    "search_in_file": search_in_file,
}


if __name__ == "__main__":
    # Tiny smoke test / demo when run directly.
    import json

    here = os.path.dirname(os.path.abspath(__file__))
    resumes = os.path.join(here, "resumes")
    print("Files in resumes/:")
    print(json.dumps(list_files(resumes), indent=2))
