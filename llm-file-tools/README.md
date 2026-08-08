# LLM File Tools: RAG-Based Resume Matching

This project started as a Milestone 1 LLM File Assistant: a set of structured
file-system tools for listing, reading, writing, and searching resume files.
Milestone 2 extends that work into a RAG-based profile matching system that can
index resumes and return top candidate matches for a job description.

The high-level flow is:

```text
Resumes
  -> section-aware parsing
  -> resume sections and chunks
  -> all-MiniLM-L6-v2 embeddings
  -> ChromaDB persistent vector store
  -> job description query
  -> semantic retrieval + exact skill matching
  -> candidate aggregation
  -> must-have validation
  -> explainable 0-100 ranking
  -> top candidate matches
```

No OpenAI API key is required for the Milestone 2 RAG pipeline. It uses a local
open-source Sentence Transformers embedding model.

---

## Assignment Mapping

### Part A: Resume Ingestion and Indexing

Implemented in `resume_parser.py` and `resume_rag.py`.

- Loads resume files using the existing Milestone 1 `fs_tools.list_files()`.
- Reads resume text using the existing Milestone 1 `fs_tools.read_file()`.
- Parses deterministic resume metadata:
  - candidate name
  - skills
  - estimated experience years
  - education
  - logical sections
- Uses section-aware chunking instead of blindly splitting the full resume.
- Splits only large sections with LangChain `RecursiveCharacterTextSplitter`.
- Generates embeddings with `sentence-transformers/all-MiniLM-L6-v2`.
- Persists vectors and metadata in local ChromaDB under `chroma_db/`.
- Excludes known generated artifacts such as `*_summary.txt` during indexing.

### Part B: Job Matching

Implemented in `job_matcher.py`.

- Accepts a job description from Python code or CLI.
- Uses the full job description as the semantic query.
- Retrieves more chunks than the final candidate count because multiple chunks
  may belong to the same resume.
- Groups retrieved chunks by candidate/resume.
- Performs exact keyword matching for known technical skills.
- Treats identified job description technologies as required skills.
- Uses extracted `experience_years` metadata for minimum experience checks.
- Returns top-K candidates, not raw chunks.
- Includes matched skills, relevant excerpts, eligibility, passed/failed
  requirements, and deterministic reasoning.
- Produces an explainable 0-100 match score.

### Deliverables

- 36 valid synthetic resumes in `resumes/`.
- 6 job descriptions in `job_descriptions/`.
- Manual golden dataset in `evaluation_data/golden_dataset.json`.
- Evaluation script in `evaluation.py`.
- Jupyter notebook in `notebooks/rag_experiments.ipynb`.
- Retrieval accuracy and latency metrics calculated from actual matcher output.

---

## Architecture

```text
                Milestone 1 tools
            +----------------------+
            | fs_tools.list_files  |
            | fs_tools.read_file   |
            +----------+-----------+
                       |
                       v
              +-----------------+
              | resume_parser.py|
              | sections + meta |
              +--------+--------+
                       |
                       v
              +-----------------+
              | resume_rag.py   |
              | section chunks  |
              +--------+--------+
                       |
                       v
        +-----------------------------+
        | HuggingFace embeddings       |
        | all-MiniLM-L6-v2             |
        +--------------+--------------+
                       |
                       v
              +-----------------+
              | ChromaDB        |
              | text + metadata |
              +--------+--------+
                       |
Job description        v
      +--------> job_matcher.py
                semantic retrieval
                skill matching
                candidate grouping
                must-have checks
                0-100 ranking
```

---

## Important Design Decisions

**Section-aware chunking**

Resumes already contain meaningful structure: summary, skills, experience,
education, projects, and certifications. Keeping those sections together makes
retrieved excerpts easier to interpret. A skills section should usually remain
one chunk; an experience section can be split if it is too large.

**Recursive splitting only inside large sections**

Large sections are still split with `RecursiveCharacterTextSplitter` so chunks
remain small enough for retrieval. The splitter is applied after section
detection, not before.

**Metadata travels with every chunk**

Each chunk stores metadata such as candidate name, resume path, section,
experience years, chunk index, and skills. This is necessary because Chroma
retrieves chunks, but the assignment asks us to rank resumes/candidates.

**Local embedding model**

The project uses `sentence-transformers/all-MiniLM-L6-v2` because it is small,
fast enough for a learning project, open-source, and does not require an OpenAI
API key.

**ChromaDB**

ChromaDB provides local vector storage plus metadata persistence. The generated
database lives in `chroma_db/`, which is git-ignored because it can be rebuilt
from the resume dataset.

**Hybrid matching**

Semantic search is good at finding generally relevant resume sections, but exact
technologies matter in hiring. A candidate who is semantically similar to a
backend role may still be missing a required skill such as Python, AWS, FastAPI,
Java, Spring Boot, or PostgreSQL. The matcher combines semantic retrieval with
deterministic skill checks.

**Candidate aggregation**

Vector search returns chunks. The final answer ranks candidates. Therefore,
`job_matcher.py` groups retrieved chunks by `resume_path` before scoring.

**Explainable heuristic score**

The 0-100 score is heuristic and readable. It is not trained from hiring data,
and it should be tuned with more realistic evaluation data before any real use.

---

## Scoring

The current scoring formula in `job_matcher.py` uses named constants:

```python
SEMANTIC_WEIGHT = 0.50
SKILL_WEIGHT = 0.35
EXPERIENCE_WEIGHT = 0.15
```

The final score is:

```text
match_score =
  0.50 * semantic_score
+ 0.35 * skill_score
+ 0.15 * experience_score
```

Then the result is rounded and clamped to `0-100`.

Semantic similarity is not simply multiplied by 100. The matcher first retrieves
Chroma chunks with similarity/distance information. It converts distance to a
bounded relevance proxy when needed, then combines:

```text
semantic_score = (0.7 * top_chunk_relevance + 0.3 * average_top_excerpt_relevance) * 100
```

Skill score is based on exact overlap between known skills found in the job
description and known skills found in candidate metadata/retrieved chunks:

```text
skill_score = matched_skill_count / job_skill_count * 100
```

If no known skills are extracted from the job description, the matcher uses a
neutral skill score of `50`.

Experience score uses the detected minimum years requirement:

- no minimum years found: `100`
- candidate years meet/exceed requirement: `100`
- candidate years are below requirement: proportional partial credit
- missing/zero candidate experience for a required minimum: `0`

Eligibility is separate from the numeric score. Identified job description
technologies are treated as required skills for this assignment. Candidates must
pass all required skills and the minimum experience requirement, if one is
detected. Ineligible candidates are not silently discarded, but eligible
candidates rank ahead of ineligible candidates.

---

## Dataset

The dataset contains 36 valid synthetic resumes. Profiles are intentionally
overlapping instead of trivially distinct. For example:

- several candidates know Python
- some Python candidates do not know AWS
- some AWS candidates are Java engineers rather than Python engineers
- experience ranges from junior/mid-level profiles to 10+ years
- several candidates match most, but not all, skills for a job description

The 6 job descriptions cover:

1. Senior Python Backend Engineer
2. Senior Java Backend Engineer
3. Full Stack Engineer
4. Machine Learning Engineer
5. DevOps / Platform Engineer
6. Data Engineer

The manual golden dataset is stored in
`evaluation_data/golden_dataset.json`.

---

## Evaluation

Run:

```powershell
python evaluation.py
```

Actual measured results on the current controlled synthetic dataset:

```text
Jobs evaluated: 6
Top-1 hit rate: 1.000
Top-3 hit rate: 1.000
Top-5 recall: 1.000
Top-10 recall: 1.000
Average matching latency: 1.986s
```

Metric meanings:

- **Top-1 hit rate**: fraction of jobs where the highest-ranked candidate is in
  the expected candidate list.
- **Top-3 hit rate**: fraction of jobs where at least one expected candidate is
  in the top 3.
- **Top-5 recall**: average fraction of expected candidates retrieved in the
  top 5.
- **Top-10 recall**: average fraction of expected candidates retrieved in the
  top 10.
- **Average matching latency**: mean wall-clock time per job matching call,
  measured with `time.perf_counter()`.

The golden dataset was manually defined from the synthetic resume contents. The
100% metrics are useful for checking that the implementation works on this
controlled dataset, but they should not be interpreted as real-world production
accuracy. Broader and noisier real-world resumes would be needed for stronger
validation.

Latency note: the first request includes local HuggingFace model cold-start
loading and was observed around 10.7 seconds. Warm matcher calls were typically
around 0.2-0.3 seconds.

---

## Setup and Usage

These commands are written for Windows PowerShell from the `llm-file-tools`
directory.

1. Install dependencies:

   ```powershell
   python -m pip install -r requirements.txt
   ```

2. Build or rebuild the resume index:

   ```powershell
   python resume_rag.py
   ```

   Run this again after changing files in `resumes/`, because ChromaDB must be
   rebuilt to include the latest dataset.

3. Run a job matching query:

   ```powershell
   python job_matcher.py "Senior backend engineer with 5+ years experience in Python, FastAPI, AWS, PostgreSQL and Kubernetes"
   ```

4. Run evaluation:

   ```powershell
   python evaluation.py
   ```

If the embedding model is already cached and the environment has no network
access, this can reduce HuggingFace network retries:

```powershell
$env:HF_HUB_OFFLINE = "1"
```

---

## Project Structure

```text
llm-file-tools/
  fs_tools.py                         Milestone 1 structured file tools
  llm_file_assistant.py               Milestone 1 LLM tool-calling demo
  resume_parser.py                    Deterministic resume metadata/section parser
  resume_rag.py                       Resume ingestion, chunking, embeddings, Chroma persistence
  job_matcher.py                      Candidate-level semantic + keyword matcher
  evaluation.py                       Golden dataset evaluation and latency metrics
  requirements.txt                    Python dependencies
  resumes/                            Synthetic resumes plus sample PDF/DOCX resumes
  job_descriptions/                   Six evaluation job descriptions
  evaluation_data/golden_dataset.json Manual expected strong matches
  notebooks/rag_experiments.ipynb     Experimentation and analysis notebook
  chroma_db/                          Generated local Chroma database, git-ignored
```

---

## Milestone 1 File Tools

`fs_tools.py` remains the foundation for file access. The RAG ingestion pipeline
reuses these functions instead of replacing them.

### `read_file(filepath: str) -> dict`

Reads `.txt`, `.md`, `.pdf`, and `.docx` files and returns structured data:

```python
{
  "success": True,
  "filepath": "resumes/resume_john_doe.txt",
  "content": "John Doe\nSenior Backend Engineer\n...",
  "metadata": {
    "name": "resume_john_doe.txt",
    "extension": ".txt",
    "size_bytes": 812,
    "char_count": 812,
    "word_count": 120
  },
  "error": None
}
```

### `list_files(directory: str, extension: str | None = None) -> list`

Lists files and metadata, optionally filtered by extension.

### `write_file(filepath: str, content: str) -> dict`

Writes content to a file and creates parent directories when needed.

### `search_in_file(filepath: str, keyword: str) -> dict`

Performs case-insensitive keyword search and returns line/context matches.

All normal failures are returned as structured data rather than expected
unhandled exceptions.

---

## Error Handling

- One bad resume does not stop ingestion. `resume_rag.py` records per-file
  failures and continues processing other resumes.
- Public-facing failures return predictable `success`, `error`, and `message`
  information where appropriate.
- `job_matcher.py` handles normal cases such as missing Chroma index, empty job
  description, retrieval failure, and no matching candidates without expected
  unhandled crashes.

---

## Notebook Demo

See `notebooks/rag_experiments.ipynb`.

It demonstrates:

- dataset overview
- resume parsing
- section-aware chunking
- embedding model and Chroma settings
- retrieval
- full job matching
- evaluation and analysis

---

## Limitations and Future Improvements

- The dataset is synthetic and controlled.
- Section parsing is deterministic and depends on recognizable resume headings.
- Skill extraction and must-have parsing use a fixed known-skill alias list.
- The current matcher treats identified job description technologies as required
  skills.
- Experience extraction is approximate.
- There is no OCR for image-only PDFs.
- There is no BM25, RRF, or cross-encoder reranking yet.
- There is no production-scale ANN tuning.
- Local embedding model cold-start can add noticeable latency.

