# /// script
# requires-python = ">=3.9"
# dependencies = ["pyyaml>=6"]
# ///
"""Judgment evals for KnowledgeX: given a finished conversation, does an agent keep the right things?

  uv run evals/run.py check                              validate the cases
  uv run evals/run.py run --agent "claude -p"            run every case through an agent, then score
  uv run evals/run.py prompts evals/prompts              write prompts to paste into a chat app by hand
  uv run evals/run.py score evals/results/<run>          score saved responses
"""
from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))

from knowledgex import __version__  # noqa: E402
from knowledgex.bundle import TYPES  # noqa: E402
from knowledgex.cli import guide_text  # noqa: E402

ACTIONS = ("new", "update", "supersede", "contradict", "timeline")
NEEDS_TARGET = ("update", "supersede", "contradict", "timeline")
FIELDS = ("type", "title", "description", "content")
# Distinctive phrases from the guide's own examples. A proposal that repeats one copied the guide instead of judging.
GUIDE_EXAMPLES = (
    "postgresql as the job queue",
    "production-like machines",
    "contracts longer than 12 months",
    "fewer moving parts",
)

PROMPT = """You are an AI agent that uses KnowledgeX. Follow the guide below.

=== GUIDE ===
<<GUIDE>>
=== END GUIDE ===

Notes already in the bundle:
<<NOTES>>

A conversation between a user and an AI assistant has just reached its natural end:

=== CONVERSATION ===
<<CONVERSATION>>
=== END CONVERSATION ===

Apply the guide to this conversation and decide what, if anything, is worth keeping.
Do not write files or run commands. Reply with only a JSON object and no other text, in this shape:

{"proposals": [{"action": "<action>", "type": "<note type>", "title": "<short name>", "description": "<one sentence saying what the note is>", "target": null, "content": "<the key points the note would contain>"}], "skipped": ["<what you chose not to keep>"]}

- action: "new", "update", "supersede", "contradict", or "timeline" (add an entry to an existing Timeline note)
- target: the file name of the existing note for update, supersede, contradict, or timeline; otherwise null
- type: one of the KnowledgeX note types
- Use an empty "proposals" list when nothing is worth keeping.
"""


# --- cases --------------------------------------------------------------------------------------

def load_cases(ids: list[str] | None = None) -> list[dict]:
    cases = []
    for path in sorted((HERE / "cases").glob("*.yaml")):
        case = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        case["_file"] = path.name
        if not ids or case.get("id") in ids:
            cases.append(case)
    missing = set(ids or []) - {c.get("id") for c in cases}
    if missing:
        raise SystemExit(f"Unknown case(s): {', '.join(sorted(missing))}")
    return cases


def transcript(case: dict) -> str:
    return "\n\n".join(f"{role.upper()}: {str(text).strip()}" for turn in case["conversation"] for role, text in turn.items())


def prompt_for(case: dict) -> str:
    notes = "\n".join(
        f"- {n['file']} ({n['type']}): {n['title']}. {n['description']}" for n in case.get("bundle") or []
    ) or "(The bundle is empty.)"
    guide = guide_text("overview") + "\n\n" + guide_text("what")
    return PROMPT.replace("<<GUIDE>>", guide).replace("<<NOTES>>", notes).replace("<<CONVERSATION>>", transcript(case))


# --- scoring ------------------------------------------------------------------------------------

def hits(spec, text: str) -> bool:
    """`spec` is a list of groups; every group needs one of its terms in the text (case-insensitive substrings)."""
    # ponytail: keyword matching is reproducible and free but misses paraphrases; add an LLM judge if that bites.
    groups = [[g] if isinstance(g, str) else list(g) for g in spec or []]
    text = text.lower()
    return bool(groups) and all(any(str(term).lower() in text for term in group) for group in groups)


def text_of(proposal: dict, fields=FIELDS) -> str:
    return " ".join(str(proposal.get(field) or "") for field in fields)


def action_of(proposal: dict) -> str:
    return str(proposal.get("action") or "new").strip().lower()


def parse_response(text: str) -> list[dict]:
    if text.startswith("AGENT ERROR"):
        raise ValueError(": ".join([line.strip() for line in text.splitlines() if line.strip()][:2]))
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("no JSON object in the response")
    data = json.loads(text[start:end + 1])
    proposals = data.get("proposals") if isinstance(data, dict) else None
    if not isinstance(proposals, list):
        raise ValueError("the response has no `proposals` list")
    return [p for p in proposals if isinstance(p, dict)]


def score_case(case: dict, proposals: list[dict] | None, error: str = "") -> dict:
    proposals = proposals or []
    remaining = list(range(len(proposals)))

    def fit(kernel: dict, proposal: dict) -> tuple[bool, bool]:
        action_ok = action_of(proposal) == kernel.get("action", "new")
        target_ok = not kernel.get("target") or Path(str(proposal.get("target") or "")).name == kernel["target"]
        type_ok = not kernel.get("types") or proposal.get("type") in kernel["types"]
        return action_ok and target_ok, type_ok

    def take(kernel: dict) -> int | None:
        candidates = [i for i in remaining if hits(kernel["match"], text_of(proposals[i]))]
        if not candidates:
            return None
        best = max(candidates, key=lambda i: fit(kernel, proposals[i]))
        remaining.remove(best)
        return best

    required = []
    for kernel in case.get("expect") or []:
        index = take(kernel)
        entry = {"id": kernel["id"], "matched": index is not None, "action_ok": False, "type_ok": False,
                 "completeness": 0.0, "missing_details": []}
        if index is not None:
            proposal = proposals[index]
            entry["action_ok"], entry["type_ok"] = fit(kernel, proposal)
            capture = kernel.get("capture") or {}
            entry["missing_details"] = [name for name, spec in capture.items() if not hits(spec, text_of(proposal))]
            entry["completeness"] = 1 - len(entry["missing_details"]) / len(capture) if capture else 1.0
        required.append(entry)
    optional = [kernel["id"] for kernel in case.get("optional") or [] if take(kernel) is not None]
    extras = [str(proposals[i].get("title") or "(untitled)") for i in remaining]
    violations = [
        rule["id"]
        for rule in case.get("avoid") or []
        if any(
            hits(rule["match"], text_of(p, rule.get("fields") or FIELDS))
            and ("action" not in rule or action_of(p) == rule["action"])
            for p in proposals
        )
    ]
    if any(phrase in text_of(p).lower() for p in proposals for phrase in GUIDE_EXAMPLES):
        violations.append("copied-guide-example")
    passed = not error and not extras and not violations and all(
        e["matched"] and e["action_ok"] and e["type_ok"] for e in required
    )
    return {"id": case["id"], "passed": passed, "error": error, "proposals": len(proposals), "required": required,
            "optional": optional, "extras": extras, "violations": violations}


def pct(part: float, whole: float) -> str:
    return f"{100 * part / whole:.0f}%" if whole else "n/a"


def report(results: list[dict], meta: dict) -> str:
    required = [e for r in results for e in r["required"]]
    found = [e for e in required if e["matched"]]
    proposals = sum(r["proposals"] for r in results)
    useful = len(found) + sum(len(r["optional"]) for r in results)
    quiet = [r for r in results if not r["required"]]
    quiet_ok = sum(1 for r in quiet if not r["error"] and not r["extras"] and not r["violations"])
    leaks = sum(len(r["violations"]) for r in results)
    leaky_cases = sum(1 for r in results if r["violations"])
    right = sum(1 for e in found if e["action_ok"] and e["type_ok"])
    completeness = sum(e["completeness"] for e in found)
    passed = sum(1 for r in results if r["passed"])

    lines = [
        "# KnowledgeX judgment eval",
        "",
        f"- Agent: `{meta.get('agent', 'unknown')}`",
        f"- Date: {meta.get('date', 'unknown')}",
        f"- KnowledgeX guide version: {meta.get('knowledgex', __version__)}",
        "",
        "| Metric | Result | Meaning |",
        "|---|---|---|",
        f"| Cases passed | {passed}/{len(results)} ({pct(passed, len(results))}) | Everything right: the expected notes, correct action and type, nothing extra, nothing transient |",
        f"| Recall | {len(found)}/{len(required)} ({pct(len(found), len(required))}) | Expected notes the agent proposed |",
        f"| Precision | {useful}/{proposals} ({pct(useful, proposals)}) | Proposals that were expected or acceptable |",
        f"| Stayed quiet | {quiet_ok}/{len(quiet)} ({pct(quiet_ok, len(quiet))}) | Cases with nothing required, where the agent proposed nothing unwanted |",
        f"| Transient leaks | {leaks} in {leaky_cases} case(s) | Proposals containing things the guide says never to keep |",
        f"| Right action and type | {right}/{len(found)} ({pct(right, len(found))}) | Among expected notes found |",
        f"| Detail completeness | {pct(completeness, len(found))} | Key details (reasons, reversal conditions, …) present in found notes |",
        "",
        "| Case | Result | Notes |",
        "|---|---|---|",
    ]
    for r in results:
        notes = []
        if r["error"]:
            notes.append(f"error: {r['error']}")
        for e in r["required"]:
            if not e["matched"]:
                notes.append(f"missed `{e['id']}`")
            else:
                if not e["action_ok"]:
                    notes.append(f"`{e['id']}`: wrong action or target")
                if not e["type_ok"]:
                    notes.append(f"`{e['id']}`: wrong type")
                if e["missing_details"]:
                    notes.append(f"`{e['id']}` lacks {', '.join(e['missing_details'])}")
        if r["extras"]:
            notes.append("extra: " + "; ".join(r["extras"]))
        if r["violations"]:
            notes.append("kept transient: " + ", ".join(r["violations"]))
        lines.append(f"| {r['id']} | {'pass' if r['passed'] else 'FAIL'} | {'; '.join(notes).replace('|', '/')} |")
    return "\n".join(lines) + "\n"


# --- validation ---------------------------------------------------------------------------------

def check_cases(cases: list[dict]) -> list[str]:
    problems: list[str] = []
    seen: set[str] = set()
    guide = (guide_text("overview") + guide_text("what")).lower()
    problems += [f"GUIDE_EXAMPLES phrase no longer in the guide: {p!r}" for p in GUIDE_EXAMPLES if p not in guide]
    for case in cases:
        where = case["_file"]

        def problem(message: str) -> None:
            problems.append(f"{where}: {message}")

        case_id = case.get("id")
        if not case_id or case_id in seen:
            problem("missing or duplicate `id`")
            continue
        seen.add(case_id)
        if where != f"{case_id}.yaml":
            problem("file name must be <id>.yaml")
        absent = [key for key in ("category", "summary", "conversation", "avoid", "reference") if key not in case]
        if absent:
            problem(f"missing {', '.join(absent)}")
            continue
        for turn in case["conversation"]:
            if not (isinstance(turn, dict) and len(turn) == 1 and set(turn) <= {"user", "assistant"}):
                problem("each conversation turn must be `user: ...` or `assistant: ...`")
        files = set()
        for note in case.get("bundle") or []:
            if not all(note.get(k) for k in ("file", "type", "title", "description")):
                problem("bundle notes need file, type, title, and description")
            files.add(note.get("file"))

        kernel_ids: set[str] = set()
        for section in ("expect", "optional", "avoid"):
            for kernel in case.get(section) or []:
                label = f"{section} `{kernel.get('id')}`"
                if not kernel.get("id") or kernel["id"] in kernel_ids:
                    problem(f"{label}: missing or duplicate id")
                kernel_ids.add(kernel.get("id"))
                if not kernel.get("match"):
                    problem(f"{label}: needs `match`")
                action = kernel.get("action", "new")
                if action not in ACTIONS:
                    problem(f"{label}: unknown action `{action}`")
                if section != "avoid" and action in NEEDS_TARGET and kernel.get("target") not in files:
                    problem(f"{label}: `{action}` needs a `target` from the case's bundle")
                unknown = set(kernel.get("types") or []) - set(TYPES)
                if unknown:
                    problem(f"{label}: unknown types {sorted(unknown)}")

        text = transcript(case)
        for phrase in GUIDE_EXAMPLES:
            if phrase in text.lower():
                problem(f"reuses the guide's own example ({phrase!r}); write a fresh scenario")
        for rule in case.get("avoid") or []:
            if "action" not in rule and not hits(rule.get("match"), text):
                problem(f"avoid `{rule.get('id')}` never appears in the conversation, so it tests nothing")
        if not any("action" not in rule for rule in case.get("avoid") or []):
            problem("add at least one avoid rule for transient content in the conversation")

        reference = score_case(case, case.get("reference") or [])
        if not reference["passed"]:
            problem("the reference answer fails:\n" + report([reference], {}).splitlines()[-1])
        for entry in reference["required"]:
            if entry["missing_details"]:
                problem(f"the reference answer lacks details for `{entry['id']}`: {entry['missing_details']}")
        dump = [{"action": "new", "type": "Note", "title": "Conversation notes", "description": "", "content": text}]
        if score_case(case, dump)["passed"]:
            problem("saving the whole transcript passes this case; tighten it")
    return problems


# --- commands -----------------------------------------------------------------------------------

def run_agent(case: dict, command: str, out: Path, timeout: int) -> None:
    prompt_path = out / f"{case['id']}.prompt.md"
    prompt_path.write_text(prompt_for(case), encoding="utf-8")
    try:
        if "{prompt_file}" in command:
            done = subprocess.run(command.replace("{prompt_file}", shlex.quote(str(prompt_path))), shell=True,
                                  stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout)
        else:
            done = subprocess.run(command, shell=True, input=prompt_path.read_text(encoding="utf-8"),
                                  capture_output=True, text=True, timeout=timeout)
        text = done.stdout if done.returncode == 0 else f"AGENT ERROR (exit {done.returncode})\n{done.stderr}\n{done.stdout}"
    except subprocess.TimeoutExpired:
        text = f"AGENT ERROR (timed out after {timeout}s)"
    (out / f"{case['id']}.response.txt").write_text(text, encoding="utf-8")
    print(f"  {case['id']}", file=sys.stderr)


def score_dir(out: Path, cases: list[dict]) -> str:
    results = []
    for case in cases:
        path = out / f"{case['id']}.response.txt"
        if not path.exists():
            results.append(score_case(case, None, "no response file"))
            continue
        try:
            results.append(score_case(case, parse_response(path.read_text(encoding="utf-8"))))
        except ValueError as exc:
            results.append(score_case(case, None, str(exc)))
    meta_path = out / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    text = report(results, meta)
    (out / "report.md").write_text(text, encoding="utf-8")
    return text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="KnowledgeX judgment evals")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check", help="validate the eval cases")

    p = sub.add_parser("prompts", help="write one prompt file per case")
    p.add_argument("out")
    p.add_argument("--case", action="append", help="only this case (repeatable)")

    p = sub.add_parser("run", help="run cases through an agent, then score them")
    p.add_argument("--agent", required=True,
                   help='a command that reads the prompt on stdin and prints the reply, e.g. "claude -p". '
                        "Put {prompt_file} in the command to pass a file path instead.")
    p.add_argument("--out", help="results folder (default: evals/results/<time>-<agent>)")
    p.add_argument("--case", action="append", help="only this case (repeatable)")
    p.add_argument("--jobs", type=int, default=4, help="cases to run at once")
    p.add_argument("--timeout", type=int, default=600, help="seconds per case")

    p = sub.add_parser("score", help="score saved responses in a results folder")
    p.add_argument("out")
    p.add_argument("--case", action="append", help="only this case (repeatable)")

    args = parser.parse_args(argv)
    cases = load_cases(getattr(args, "case", None))

    if args.command == "check":
        problems = check_cases(cases)
        print("\n".join(problems) or f"{len(cases)} cases OK")
        return 1 if problems else 0

    if args.command == "prompts":
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        for case in cases:
            (out / f"{case['id']}.prompt.md").write_text(prompt_for(case), encoding="utf-8")
        print(f"Wrote {len(cases)} prompts to {out}. Save each reply as <case>.response.txt, then run `score`.")
        return 0

    if args.command == "run":
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        out = Path(args.out or HERE / "results" / f"{stamp}-{re.sub(r'[^a-z0-9]+', '-', args.agent.lower()).strip('-')}")
        out.mkdir(parents=True, exist_ok=True)
        meta = {"agent": args.agent, "date": datetime.now().isoformat(timespec="minutes"), "knowledgex": __version__}
        (out / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        print(f"Running {len(cases)} case(s) with `{args.agent}`…", file=sys.stderr)
        with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
            list(pool.map(lambda case: run_agent(case, args.agent, out, args.timeout), cases))

    print(score_dir(Path(args.out) if args.command == "score" else out, cases))
    return 0


if __name__ == "__main__":
    sys.exit(main())
