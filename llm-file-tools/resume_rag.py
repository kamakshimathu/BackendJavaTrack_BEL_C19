"""Build a ChromaDB resume index from files discovered with fs_tools.

This module implements only Milestone 2 ingestion/indexing. It does not perform
job matching, scoring, BM25, RRF, UI work, or evaluation.
"""

from __future__ import annotations

import fnmatch
import os
import shutil
from typing import Any

import fs_tools
from resume_parser import parse_resume


HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_RESUMES_DIR = os.path.join(HERE, "resumes")
DEFAULT_PERSIST_DIR = os.path.join(HERE, "chroma_db")
SUPPORTED_EXTENSIONS = {
    ".txt",
    ".md",
    ".markdown",
    ".text",
    ".rtf",
    ".log",
    ".csv",
    ".pdf",
    ".docx",
}
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
COLLECTION_NAME = "resume_sections"
GENERATED_ARTIFACT_PATTERNS = ("*_summary.txt",)


def discover_resume_files(resumes_dir: str = DEFAULT_RESUMES_DIR) -> dict:
    """Discover candidate resume files using the existing fs_tools.list_files."""
    files = fs_tools.list_files(resumes_dir)
    if files and len(files) == 1 and files[0].get("success") is False:
        return {"success": False, "files": [], "error": files[0].get("error")}

    resume_files = [
        file_info
        for file_info in files
        if file_info.get("extension", "").lower() in SUPPORTED_EXTENSIONS
        and not _is_generated_artifact(file_info.get("name", ""))
    ]
    return {"success": True, "files": resume_files, "error": None}


def _is_generated_artifact(filename: str) -> bool:
    """Exclude known generated files without classifying every text document."""
    return any(
        fnmatch.fnmatch(filename.lower(), pattern)
        for pattern in GENERATED_ARTIFACT_PATTERNS
    )


def create_resume_chunks(
    parsed_resume: dict,
    resume_path: str,
    chunk_size: int = 800,
    chunk_overlap: int = 100,
) -> list[dict]:
    """Create section-aware chunks with source metadata for ChromaDB."""
    RecursiveCharacterTextSplitter = _get_text_splitter_class()
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    candidate_name = parsed_resume.get("name") or "Unknown Candidate"
    experience_years = parsed_resume.get("experience_years")
    skills = parsed_resume.get("skills") or []
    sections = parsed_resume.get("sections") or {}

    chunks = []
    for section_name, section_text in sections.items():
        section_text = (section_text or "").strip()
        if not section_text:
            continue

        section_chunks = [section_text]
        if len(section_text) > chunk_size:
            section_chunks = splitter.split_text(section_text)

        for index, chunk_text in enumerate(section_chunks):
            metadata = {
                "candidate_name": candidate_name,
                "resume_path": resume_path,
                "section": section_name,
                "experience_years": (
                    experience_years if experience_years is not None else 0
                ),
                "chunk_index": index,
                "skills": ", ".join(skills),
            }
            chunks.append({"text": chunk_text, "metadata": metadata})

    return chunks


def build_resume_index(
    resumes_dir: str = DEFAULT_RESUMES_DIR,
    persist_dir: str = DEFAULT_PERSIST_DIR,
    rebuild: bool = True,
) -> dict:
    """Read, parse, chunk, embed, and persist resumes in a local ChromaDB."""
    summary: dict[str, Any] = {
        "success": False,
        "resumes_discovered": 0,
        "processed": 0,
        "failed": 0,
        "failures": [],
        "chunks_created": 0,
        "persist_dir": os.path.abspath(persist_dir),
        "message": "",
    }

    discovery = discover_resume_files(resumes_dir)
    if not discovery["success"]:
        summary["message"] = discovery["error"] or "Failed to discover resumes."
        return summary

    resume_files = discovery["files"]
    summary["resumes_discovered"] = len(resume_files)

    all_chunks: list[dict] = []
    for file_info in resume_files:
        resume_path = file_info.get("path")
        if not resume_path:
            _record_failure(
                summary, "<unknown>", "Missing file path from list_files metadata."
            )
            continue

        read_result = fs_tools.read_file(resume_path)
        if not read_result.get("success"):
            _record_failure(
                summary,
                resume_path,
                read_result.get("error") or "Failed to read resume.",
            )
            continue

        try:
            parsed_resume = parse_resume(read_result.get("content", ""))
            chunks = create_resume_chunks(parsed_resume, resume_path)
        except Exception as exc:  # pragma: no cover - defensive boundary
            _record_failure(
                summary, resume_path, f"Failed to parse/chunk resume: {exc}"
            )
            continue

        if not chunks:
            _record_failure(
                summary, resume_path, "No indexable text chunks were created."
            )
            continue

        all_chunks.extend(chunks)
        summary["processed"] += 1

    summary["chunks_created"] = len(all_chunks)
    if not all_chunks:
        summary["message"] = "No chunks were created; Chroma index was not written."
        return summary

    try:
        if rebuild and os.path.isdir(persist_dir):
            shutil.rmtree(persist_dir)

        HuggingFaceEmbeddings = _get_embedding_class()
        Chroma = _get_chroma_class()

        embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
        vector_store = Chroma(
            collection_name=COLLECTION_NAME,
            embedding_function=embeddings,
            persist_directory=persist_dir,
        )
        vector_store.add_texts(
            texts=[chunk["text"] for chunk in all_chunks],
            metadatas=[chunk["metadata"] for chunk in all_chunks],
        )

        # Newer langchain-chroma persists automatically; older wrappers expose
        # persist(). Calling it conditionally keeps the script version-tolerant.
        if hasattr(vector_store, "persist"):
            vector_store.persist()
    except Exception as exc:  # pragma: no cover - dependency/runtime boundary
        summary["message"] = f"Failed to build Chroma index: {exc}"
        return summary

    summary["failed"] = len(summary["failures"])
    summary["success"] = True
    summary["message"] = "Resume index built successfully."
    return summary


def _record_failure(summary: dict, resume_path: str, message: str) -> None:
    summary["failures"].append(
        {"success": False, "resume_path": resume_path, "message": message}
    )
    summary["failed"] = len(summary["failures"])


def _get_text_splitter_class():
    try:
        from langchain_text_splitters import RecursiveCharacterTextSplitter

        return RecursiveCharacterTextSplitter
    except ImportError:
        try:
            from langchain.text_splitter import RecursiveCharacterTextSplitter

            return RecursiveCharacterTextSplitter
        except ImportError as exc:
            raise RuntimeError(
                "LangChain text splitting dependency is missing. "
                "Install requirements.txt and retry."
            ) from exc


def _get_embedding_class():
    try:
        from langchain_huggingface import HuggingFaceEmbeddings

        return HuggingFaceEmbeddings
    except ImportError:
        try:
            from langchain_community.embeddings import HuggingFaceEmbeddings

            return HuggingFaceEmbeddings
        except ImportError as exc:
            raise RuntimeError(
                "HuggingFace embeddings dependency is missing. "
                "Install requirements.txt and retry."
            ) from exc


def _get_chroma_class():
    try:
        from langchain_chroma import Chroma

        return Chroma
    except ImportError:
        try:
            from langchain_community.vectorstores import Chroma

            return Chroma
        except ImportError as exc:
            raise RuntimeError(
                "Chroma/LangChain vector store dependency is missing. "
                "Install requirements.txt and retry."
            ) from exc


def print_summary(summary: dict) -> None:
    """Print a concise CLI summary for assignment verification."""
    print("Resume ingestion summary")
    print(f"- Resume files discovered: {summary['resumes_discovered']}")
    print(f"- Successfully processed: {summary['processed']}")
    print(f"- Failures: {summary['failed']}")
    for failure in summary.get("failures", []):
        print(f"  - {failure['resume_path']}: {failure['message']}")
    print(f"- Total chunks created: {summary['chunks_created']}")
    print(f"- Chroma persistence location: {summary['persist_dir']}")
    print(f"- Status: {summary['message']}")


def main() -> None:
    summary = build_resume_index()
    print_summary(summary)
    raise SystemExit(0 if summary["success"] else 1)


if __name__ == "__main__":
    main()
