# LLM File Assistant

A small project demonstrating **LLM function calling / tool use**: a set of
structured file-system tools that an LLM can call on demand to read, search,
summarise, and organise resume files.

Built with the official [OpenAI Python SDK](https://github.com/openai/openai-python)
using **function calling**. The script runs the call → execute → respond loop
itself, so you can see exactly which tool the model chose at each step.

---

## Contents

| File                      | Purpose                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `fs_tools.py`             | **Part A** — the four core file-system tools (pure Python, no LLM).                         |
| `llm_file_assistant.py`   | **Part B** — wires the tools into Claude so it can call them from natural-language queries. |
| `generate_sample_docs.py` | Creates `.docx` and `.pdf` sample resumes (the repo ships `.txt` by default).               |
| `resumes/`                | 6–8 dummy resume files across `.txt`, `.docx`, and `.pdf`.                                  |
| `requirements.txt`        | Dependencies.                                                                               |

---

## Part A — Core file-system tools (`fs_tools.py`)

Every tool returns a **structured, JSON-serialisable** value and never raises on
expected failures (missing file, unsupported type, permission error) — errors
come back as data so the LLM can react to them.

### `read_file(filepath: str) -> dict`

Reads a resume file and extracts its text. Supports `.txt`/`.md`, `.pdf`
(via `pypdf`), and `.docx` (via `python-docx`).

```python
{
  "success": True,
  "filepath": "resumes/resume_john_doe.txt",
  "content": "John Doe\nSenior Backend Engineer\n...",
  "metadata": {"name": "...", "extension": ".txt", "size_bytes": 812,
               "modified": "2026-07-25T...", "char_count": 812, "word_count": 120},
  "error": None
}
```

### `list_files(directory: str, extension: str = None) -> list`

Lists files in a directory with metadata (name, size, modified date), optionally
filtered by extension (`".pdf"` or `"pdf"`, case-insensitive).

### `write_file(filepath: str, content: str) -> dict`

Writes content to a file, **creating parent directories if needed**. Returns
success status and bytes written.

### `search_in_file(filepath: str, keyword: str) -> dict`

**Case-insensitive** keyword search. Returns each match with its line number and
a surrounding-text snippet for context.

Run the module directly for a quick smoke test:

```bash
python fs_tools.py
```

---

## Part B — LLM integration (`llm_file_assistant.py`)

The four tools are described to the model as OpenAI function schemas
(`TOOL_SCHEMAS`). The `ask()` function runs the agentic loop: the model picks a
tool, we execute the matching `fs_tools` function, the JSON result is fed back
as a `tool` message, and the loop repeats until the model produces a final
answer.

### Example queries

```bash
python llm_file_assistant.py "Read all resumes in the resumes folder"
python llm_file_assistant.py "Find resumes mentioning Python experience"
python llm_file_assistant.py "Create a summary file for resume_john_doe.txt"
```

Or start an interactive chat:

```bash
python llm_file_assistant.py
```

Tool calls are printed inline (e.g. `[tool] search_in_file(filepath=..., keyword='Python')`)
so you can see exactly what the model decided to do.

---

## Setup

1. **Install dependencies**

   ```bash
   pip install -r requirements.txt
   ```

2. **Generate the `.docx` / `.pdf` sample resumes** (optional but recommended,
   so `read_file` is exercised on all three formats):

   ```bash
   python generate_sample_docs.py
   ```

3. **Provide an OpenAI API key** for Part B. Two options:

   **a) `.env` file (recommended)** — copy the template and fill in your key.
   It's git-ignored, so the key is never committed and you don't re-export it
   every session:

   ```bash
   cp .env.example .env          # macOS / Linux
   Copy-Item .env.example .env   # Windows PowerShell
   # then edit .env and set OPENAI_API_KEY=sk-...
   ```

   **b) Environment variable** — export it directly:

   ```bash
   export OPENAI_API_KEY="sk-..."      # macOS / Linux
   $env:OPENAI_API_KEY = "sk-..."      # Windows PowerShell
   ```

   The model defaults to `gpt-4o-mini`; override with `OPENAI_MODEL`
   (in `.env` or the environment, e.g. `OPENAI_MODEL=gpt-4o`).

   Part A (`fs_tools.py`) needs **no** API key — it is pure Python.

---

## Sample data (`resumes/`)

Six text resumes ship in the repo, plus two more created by
`generate_sample_docs.py`:

| File                      | Format | Focus             | Mentions Python? |
| ------------------------- | ------ | ----------------- | :--------------: |
| `resume_john_doe.txt`     | txt    | Backend engineer  |        ✅        |
| `resume_maria_garcia.txt` | txt    | Data scientist    |        ✅        |
| `resume_liam_chen.txt`    | txt    | Frontend engineer |        ❌        |
| `resume_aisha_khan.txt`   | txt    | DevOps engineer   |        ✅        |
| `resume_sofia_rossi.txt`  | txt    | Product manager   |        ❌        |
| `resume_david_okafor.txt` | txt    | ML engineer       |        ✅        |
| `resume_priya_patel.docx` | docx   | QA automation     |        ✅        |
| `resume_noah_smith.pdf`   | pdf    | Security analyst  |        ✅        |

The mix of "mentions Python / doesn't" makes queries like _"find resumes
mentioning Python"_ produce meaningful, verifiable results.

---

## How it maps to the assignment

- **Part A (Core File System Tools):** `read_file`, `list_files`, `write_file`,
  `search_in_file` in `fs_tools.py` — structured responses, metadata, graceful
  error handling, multi-format parsing.
- **Part B (LLM Integration):** `llm_file_assistant.py` — Claude calls the tools
  based on natural-language queries via the Anthropic tool runner.

---
