"""generate_sample_docs.py — produce .docx and .pdf sample resumes.

The repository ships most resumes as plain .txt so they stay diff-friendly. Run
this script once to also create a .docx and a .pdf resume, giving the sample set
all three formats that ``fs_tools.read_file`` supports.

    python generate_sample_docs.py

Requires: python-docx (DOCX) and reportlab (PDF). Both are in requirements.txt.
"""

from __future__ import annotations

import os

HERE = os.path.dirname(os.path.abspath(__file__))
RESUMES = os.path.join(HERE, "resumes")

PRIYA = """\
Priya Patel
QA Automation Engineer
Email: priya.patel@example.com | Phone: (555) 789-0123
Location: Bangalore, India

SUMMARY
QA engineer who builds automated test frameworks and treats testing as code.

SKILLS
- Languages: Python, Java
- Automation: Selenium, Playwright, pytest, Appium
- CI/CD: Jenkins, GitHub Actions
- API testing: Postman, REST Assured

EXPERIENCE
Senior QA Engineer, Finlytics (2020 - Present)
- Built a Python + Playwright regression suite cutting manual QA by 70%.
- Introduced contract testing across 12 microservices.

QA Analyst, Testbridge (2017 - 2020)
- Automated smoke tests that caught 90% of release-blocking bugs early.

EDUCATION
B.Tech Information Technology, VIT Vellore, 2017
"""

NOAH = """\
Noah Smith
Cybersecurity Analyst
Email: noah.smith@example.com | Phone: (555) 890-1234
Location: Denver, CO

SUMMARY
Security analyst focused on threat detection, incident response, and scripting
tooling to automate investigations.

SKILLS
- Languages: Python, PowerShell
- Security: SIEM, Splunk, Wireshark, Burp Suite
- Cloud: AWS security, IAM, GuardDuty
- Frameworks: MITRE ATT&CK, NIST CSF

EXPERIENCE
Security Analyst, Sentinel Defense (2021 - Present)
- Wrote Python scripts to enrich alerts, cutting triage time in half.
- Led response to three major incidents with zero data loss.

SOC Analyst, ByteGuard (2018 - 2021)
- Tuned detection rules, reducing false positives by 60%.

EDUCATION
B.S. Cybersecurity, University of Colorado Boulder, 2018
"""


def make_docx(text: str, out_name: str) -> None:
    import docx  # python-docx

    document = docx.Document()
    for line in text.splitlines():
        document.add_paragraph(line)
    out_path = os.path.join(RESUMES, out_name)
    document.save(out_path)
    print(f"Wrote {out_path}")


def make_pdf(text: str, out_name: str) -> None:
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    out_path = os.path.join(RESUMES, out_name)
    c = canvas.Canvas(out_path, pagesize=letter)
    width, height = letter
    y = height - 72
    c.setFont("Helvetica", 11)
    for line in text.splitlines():
        if y < 72:  # start a new page
            c.showPage()
            c.setFont("Helvetica", 11)
            y = height - 72
        c.drawString(72, y, line[:100])
        y -= 15
    c.save()
    print(f"Wrote {out_path}")


def main() -> None:
    make_docx(PRIYA, "resume_priya_patel.docx")
    make_pdf(NOAH, "resume_noah_smith.pdf")


if __name__ == "__main__":
    main()
