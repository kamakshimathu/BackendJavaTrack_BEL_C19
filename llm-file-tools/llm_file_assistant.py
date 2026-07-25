"""llm_file_assistant.py — an LLM that answers questions by calling file tools.

This wires the four tools from ``fs_tools.py`` into an OpenAI model using
**function calling**. The script runs the agentic loop itself: the model
decides which tool to call, we execute the matching Python function, feed the
result back, and repeat until the model produces a final answer.

Example queries
---------------
* "Read all resumes in the resumes folder"
* "Find resumes mentioning Python experience"
* "Create a summary file for resume_john_doe.txt"

Usage
-----
    # one-shot query
    python llm_file_assistant.py "Find resumes mentioning Python experience"

    # interactive chat
    python llm_file_assistant.py

Requires the OPENAI_API_KEY environment variable. See README.md for setup.
"""

from __future__ import annotations

import json
import os
import sys

try:
    # Optional: load OPENAI_API_KEY (and OPENAI_MODEL) from a local .env file.
    # The OpenAI SDK does not read .env itself, so we load it here if present.
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass  # python-dotenv not installed — fall back to real env vars.

from openai import (
    APIConnectionError,
    AuthenticationError,
    OpenAI,
    OpenAIError,
    RateLimitError,
)

import fs_tools

MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

# Resolve the resumes folder relative to this file so the assistant works no
# matter what directory it's launched from.
HERE = os.path.dirname(os.path.abspath(__file__))
RESUMES_DIR = os.path.join(HERE, "resumes")

SYSTEM_PROMPT = f"""\
You are a helpful file-system assistant for a recruiting team. You help the
user read, search, summarise, and organise resume files using the tools
provided.

Guidance:
- The default resume folder is: {RESUMES_DIR}
  When the user refers to "the resumes folder" or gives a bare filename,
  assume it lives there.
- Prefer list_files to discover what exists before reading everything.
- When asked to "find resumes mentioning X", list the resume files, search
  each one, and report which files matched with a short supporting snippet.
- When asked to create or write a file, use write_file and confirm the path.
- Be concise. Summarise what you found; don't dump entire file contents unless
  the user explicitly asks for the full text.
"""

# ---------------------------------------------------------------------------
# Tool schemas (OpenAI function-calling format). Each maps 1:1 to a function
# in fs_tools.py; dispatch happens through fs_tools.TOOLS.
# ---------------------------------------------------------------------------
TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a resume file (.txt, .md, .pdf, or .docx) and "
            "extract its text content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {
                        "type": "string",
                        "description": "Path to the file to read (absolute or "
                        "relative to the current working directory).",
                    }
                },
                "required": ["filepath"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files in a directory with name, size and "
            "last-modified date, optionally filtered by extension.",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Path to the directory to list.",
                    },
                    "extension": {
                        "type": "string",
                        "description": "Optional extension filter such as "
                        "'.pdf' or 'pdf'. Omit to list every file.",
                    },
                },
                "required": ["directory"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write text content to a file, creating parent "
            "directories if needed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {
                        "type": "string",
                        "description": "Destination path for the file.",
                    },
                    "content": {
                        "type": "string",
                        "description": "The text content to write.",
                    },
                },
                "required": ["filepath", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_in_file",
            "description": "Case-insensitively search a file for a keyword, "
            "returning matches with surrounding context.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {
                        "type": "string",
                        "description": "Path to the file to search.",
                    },
                    "keyword": {
                        "type": "string",
                        "description": "The term to look for (case-insensitive).",
                    },
                },
                "required": ["filepath", "keyword"],
            },
        },
    },
]


def _dispatch(name: str, arguments: dict):
    """Execute a tool by name and return its structured result."""
    func = fs_tools.TOOLS.get(name)
    if func is None:
        return {"success": False, "error": f"Unknown tool: {name}"}
    try:
        return func(**arguments)
    except TypeError as exc:
        return {"success": False, "error": f"Bad arguments for {name}: {exc}"}


def ask(client: OpenAI, query: str, max_turns: int = 10) -> None:
    """Run one query through the function-calling loop and print the result."""
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": query},
    ]

    for _ in range(max_turns):
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=messages,
                tools=TOOL_SCHEMAS,
            )
        except RateLimitError:
            print(
                "\nOpenAI rejected the request: quota/rate limit exceeded "
                "(insufficient_quota).\n"
                "Your API key is valid, but the account/project has no "
                "available credit. Add billing/credit at "
                "platform.openai.com → Settings → Billing, then retry.\n"
            )
            return
        except AuthenticationError:
            print(
                "\nOpenAI rejected the API key (authentication failed).\n"
                "Check that OPENAI_API_KEY is correct and active.\n"
            )
            return
        except APIConnectionError:
            print("\nCould not reach OpenAI — check your network connection.\n")
            return
        except OpenAIError as exc:
            print(f"\nOpenAI request failed: {exc}\n")
            return

        message = response.choices[0].message
        messages.append(message)

        tool_calls = message.tool_calls or []
        if not tool_calls:
            # No more tools requested — this is the final answer.
            if message.content:
                print(f"\n{message.content.strip()}\n")
            return

        # Execute every requested tool and feed the results back.
        for call in tool_calls:
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            arg_str = ", ".join(f"{k}={v!r}" for k, v in args.items())
            print(f"  \033[36m[tool] {call.function.name}({arg_str})\033[0m")

            result = _dispatch(call.function.name, args)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": json.dumps(result),
                }
            )

    print("\n(Reached the tool-call limit before a final answer.)\n")


def main() -> None:
    if not os.environ.get("OPENAI_API_KEY"):
        print(
            "OPENAI_API_KEY is not set. Set it before running Part B — "
            "see README.md."
        )
        sys.exit(1)

    client = OpenAI()  # reads OPENAI_API_KEY from the environment

    # One-shot mode: everything after the script name is the query.
    if len(sys.argv) > 1:
        ask(client, " ".join(sys.argv[1:]))
        return

    # Interactive mode.
    print("LLM File Assistant — type a request, or 'quit' to exit.")
    print(f"(Model: {MODEL} | Resume folder: {RESUMES_DIR})\n")
    while True:
        try:
            query = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not query:
            continue
        if query.lower() in {"quit", "exit", "q"}:
            break
        ask(client, query)


if __name__ == "__main__":
    main()
