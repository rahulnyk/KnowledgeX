"""kx: the KnowledgeX command line."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from importlib import resources
from pathlib import Path

from . import __version__
from . import bundle as kb

GUIDES = {
    "overview": "overview.md",
    "what": "what-to-write.md",
    "write": "how-to-write.md",
    "retrieve": "how-to-retrieve.md",
    "maintain": "maintain.md",
}
ACTOR = re.compile(r"^(?:human:|process:)\S+$|^[^\s/:]+/\S+$")

CONTEXT_HINT = "<!-- kx: Start with one italic line telling a reader with no context what this is and why it matters. -->\n"
TEMPLATES = {
    "Decision": "\n## Decision\n\n## Why\n\n## Alternatives considered\n\n## Reversal conditions\n"
                "<!-- kx: The specific signals that should reopen this decision. -->\n\n## Consequences\n",
    "Preference": "\n## Preference\n\n## Why\n\n## Scope\n",
    "Principle": "\n## Principle\n\n## Why\n\n## Origin\n",
    "Lesson": "\n## When this applies\n\n## Rule\n\n## Why\n\n## Origin\n<!-- kx: One dated line. No story. -->\n",
    "Concept": "\n## Definition\n\n## Why it matters here\n",
    "Entity": "\n## About\n\n## Key facts (as of {today})\n"
              "<!-- kx: Facts that change over time. Give each a footnote marker whose id matches an entry in `sources`. -->\n\n## Notes\n",
    "Person": "\n## Who\n\n## Context\n\n## Notes\n",
    "Playbook": "\n## When to use\n\n## Steps\n\n## Pitfalls\n",
    "Plan": "\n## Goal\n\n## Approach\n\n## Milestones\n\n## Review points\n",
    "Idea": "\n## The idea\n\n## Why it is interesting\n\n## Open questions\n\n## Next step\n",
    "Source": "\n## About\n\n## Takeaways\n\n## Highlights\n",
    "Timeline": "\n## Entries\n<!-- kx: Newest first, one line each: date, what happened, why it matters. -->\n",
}
SKILL_HEADER = """---
name: knowledgex
description: Long-term memory with judgment. Use when the user wants to save, remember, or note something; when recalling earlier decisions, preferences, lessons, people, or plans; before answering questions that depend on what was decided or learned before; and at the end of substantial conversations to propose what is worth keeping. Notes live in an Open Knowledge Format (OKF) bundle managed with the `kx` command.
---

"""


# --- helpers ------------------------------------------------------------------------------------

def config_path() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config"
    return Path(base) / "knowledgex" / "config.json"


def bundle_root(args) -> Path:
    configured = args.bundle or os.environ.get("KX_BUNDLE")
    if not configured and config_path().exists():
        configured = json.loads(config_path().read_text(encoding="utf-8")).get("bundle")
    if not configured:
        raise SystemExit("No bundle yet. Create one with: kx init <folder>")
    root = Path(configured).expanduser().resolve()
    if not root.is_dir():
        raise SystemExit(f"Bundle folder not found: {root}")
    return root


def open_note(root: Path, value: str) -> kb.Note:
    given = Path(value).expanduser()
    for path in [given] if given.is_absolute() else [root / given, Path.cwd() / given]:
        if not path.is_file():
            continue
        path = path.resolve()
        if root not in path.parents:
            raise SystemExit(f"{path} is outside the bundle ({root}).")
        if path.name in kb.RESERVED:
            raise SystemExit(f"{path.name} is a reserved file, not a note.")
        note = kb.read_note(path)
        if note.error:
            raise SystemExit(f"{value}: {note.error}")
        return note
    raise SystemExit(f"Note not found in the bundle: {value}")


def actor(value: str) -> str:
    if not ACTOR.match(value):
        raise argparse.ArgumentTypeError(
            "use <agent>/<model> for agents (e.g. my-agent/1.0), human:<id> for people, process:<name> for jobs"
        )
    return value


def refresh_index(root: Path) -> None:
    kb.write_index(root, kb.load_notes(root))


def guide_text(topic: str) -> str:
    folder = resources.files("knowledgex") / "protocol"
    names = GUIDES.values() if topic == "all" else [GUIDES[topic]]
    return "\n\n---\n\n".join((folder / name).read_text(encoding="utf-8") for name in names)


def ensure_link(root: Path, note: kb.Note, other: kb.Note, label: str) -> None:
    if kb.rel(other.path, root) not in kb.local_links(note, root):
        note.body = note.body.rstrip("\n") + f"\n\n{label} [{other.title}]({kb.link_to(note, other)}).\n"


# --- commands -----------------------------------------------------------------------------------

def cmd_init(args) -> int:
    root = Path(args.path).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    notes = kb.load_notes(root)
    if not (root / "index.md").exists():
        kb.write_index(root, notes)
    if not (root / "log.md").exists():
        kb.append_log(root, "Creation", "Started the KnowledgeX bundle.")
    config_path().parent.mkdir(parents=True, exist_ok=True)
    config_path().write_text(json.dumps({"bundle": str(root)}, indent=2) + "\n", encoding="utf-8")
    print(f"Bundle ready: {root}")
    foreign = [n for n in notes if n.error or not n.meta.get("type")]
    if foreign:
        print(f"Heads-up: {len(foreign)} markdown file(s) here are not OKF notes, and `kx check` will flag them. "
              "An empty folder works best.")
    print("Next: connect your agent (see the README), or read the agent guide with `kx guide`.")
    return 0


def cmd_guide(args) -> int:
    print(guide_text(args.topic))
    return 0


def cmd_new(args) -> int:
    root = bundle_root(args)
    path = root / f"{kb.slugify(args.title)}.md"
    where = kb.rel(path, root)
    if path.exists():
        raise SystemExit(f"{where} already exists. Update that note, then run: kx touch {where} --by {args.by}")

    stamp = kb.now()
    meta = {"type": args.type, "title": args.title, "description": args.description}
    tags = [t.strip() for t in (args.tags or "").split(",") if t.strip()]
    if tags:
        meta["tags"] = tags
    meta["status"] = args.status
    meta["created"] = stamp.date().isoformat()
    meta["generated"] = {"by": args.by, "at": kb.iso(stamp)}
    months = kb.TYPES.get(args.type)
    if months:
        meta["stale_after"] = kb.add_months(stamp.date(), months).isoformat() + "T00:00:00Z"
    sources = []
    for item in args.source or []:
        source_id, _, url = item.partition("=")
        if not (source_id and url):
            raise SystemExit(f"--source must look like id=https://example.com, got: {item}")
        sources.append({"id": source_id, "resource": url})
    if sources:
        meta["sources"] = sources

    template = TEMPLATES.get(args.type, "\n## Notes\n").replace("{today}", stamp.date().isoformat())
    kb.write_note(kb.Note(path, meta, "\n" + CONTEXT_HINT + template))
    kb.append_log(root, "Creation", f"Added [{args.title}]({where}).")
    refresh_index(root)
    if args.type not in kb.TYPES:
        print(f"Note: `{args.type}` is not a KnowledgeX type ({', '.join(kb.TYPES)}).", file=sys.stderr)
    print(path)
    return 0


def cmd_touch(args) -> int:
    root = bundle_root(args)
    note = open_note(root, args.file)
    before = kb.trust(note.meta)
    note.meta["generated"] = {"by": args.by, "at": kb.iso(kb.now())}
    kb.write_note(note)
    where = kb.rel(note.path, root)
    message = f"Updated [{note.title}]({where})" + (f": {args.message}" if args.message else ".")
    kb.append_log(root, "Update", message)
    refresh_index(root)
    print(f"Recorded the change to {where}.")
    if before != "unverified":
        print(f"Its earlier verification ({before}) no longer covers the new content. Verify it again once checked.")
    return 0


def cmd_verify(args) -> int:
    root = bundle_root(args)
    note = open_note(root, args.file)
    stamp = kb.now()
    note.meta["verified"] = kb.as_list(note.meta.get("verified")) + [{"by": args.by, "at": kb.iso(stamp)}]
    months = kb.TYPES.get(note.meta.get("type"))
    if months and "stale_after" in note.meta:  # a checked note starts a fresh expiry window
        note.meta["stale_after"] = kb.add_months(stamp.date(), months).isoformat() + "T00:00:00Z"
    kb.write_note(note)
    where = kb.rel(note.path, root)
    kb.append_log(root, "Verification", f"[{note.title}]({where}) checked by {args.by}.")
    print(f"{where} is now {kb.trust(note.meta)}.")
    return 0


def cmd_relate(args) -> int:
    root = bundle_root(args)
    source, target = open_note(root, args.file), open_note(root, args.target)
    if source.path == target.path:
        raise SystemExit("A note cannot relate to itself.")
    source_where, target_where = kb.rel(source.path, root), kb.rel(target.path, root)

    if target_where not in kb.relation_targets(source, root, args.relation):
        source.meta[args.relation] = [str(t) for t in kb.as_list(source.meta.get(args.relation))] + [target_where]
    ensure_link(root, source, target, "Supersedes" if args.relation == "supersedes" else "Contradicts")
    kb.write_note(source)

    pair = f"[{source.title}]({source_where}) {args.relation} [{target.title}]({target_where})."
    if args.relation == "supersedes":
        target.meta["status"] = "deprecated"
        ensure_link(root, target, source, "Superseded by")
        kb.write_note(target)
        kb.append_log(root, "Supersession", pair)
    else:
        kb.append_log(root, "Contradiction", pair)
    refresh_index(root)
    print(f"{source_where} {args.relation} {target_where}.")
    return 0


def cmd_search(args) -> int:
    root = bundle_root(args)
    notes, successors = kb.search(root, " ".join(args.words), args.type, args.all)
    print(f"Bundle: {root}")
    if not notes:
        print("No matching notes.")
        return 0
    for note in notes:
        meta, where = note.meta, kb.rel(note.path, root)
        print(f"\n{where}: {note.title}")
        details = [str(meta.get("type", "?")), kb.trust(meta), kb.freshness(meta), str(meta.get("status", "?"))]
        print("    " + " · ".join(details))
        if meta.get("description"):
            print(f"    {meta['description']}")
        if where in successors:
            print(f"    superseded by: {', '.join(successors[where])}")
        contradicts = kb.relation_targets(note, root, "contradicts")
        if contradicts:
            print(f"    contradicts: {', '.join(contradicts)}")
    return 0


def cmd_check(args) -> int:
    root = bundle_root(args)
    findings = kb.check(root)
    for level, where, message in findings:
        print(f"{level:<7} {where}: {message}")
    errors = sum(1 for level, _, _ in findings if level == "error")
    print(f"{root}: {errors} error(s), {len(findings) - errors} warning(s)")
    return 1 if errors else 0


def cmd_review(args) -> int:
    root = bundle_root(args)
    groups = kb.review(root)
    print(f"# KnowledgeX review, {kb.now().date().isoformat()}\n\nBundle: {root}\n")
    if not groups:
        print("Nothing needs attention.")
    for kind, items in groups.items():
        print(f"## {kind}\n")
        print("\n".join(f"- [ ] {item}" for item in items) + "\n")
    return 0


def cmd_index(args) -> int:
    root = bundle_root(args)
    refresh_index(root)
    print(f"Rebuilt {root / 'index.md'}")
    return 0


def cmd_install_skill(args) -> int:
    target = Path(args.folder).expanduser() / "knowledgex"
    (target / "references").mkdir(parents=True, exist_ok=True)
    (target / "SKILL.md").write_text(SKILL_HEADER + guide_text("overview"), encoding="utf-8")
    for topic, name in GUIDES.items():
        if topic != "overview":
            (target / "references" / name).write_text(guide_text(topic), encoding="utf-8")
    print(f"Installed the KnowledgeX skill in {target}")
    return 0


# --- entry point --------------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kx", description="KnowledgeX: durable, trustworthy knowledge for any AI agent.")
    parser.add_argument("--version", action="version", version=f"kx {__version__}")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--bundle", help="bundle folder (default: $KX_BUNDLE, then the folder set by `kx init`)")
    by = argparse.ArgumentParser(add_help=False)
    by.add_argument("--by", required=True, type=actor, help="who is acting: <agent>/<model>, human:<id>, or process:<name>")
    sub = parser.add_subparsers(dest="command", required=True, metavar="COMMAND")

    p = sub.add_parser("init", help="create a bundle (or register an existing one) as the default")
    p.add_argument("path")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("guide", help="print the agent guide")
    p.add_argument("topic", nargs="?", default="overview", choices=[*GUIDES, "all"])
    p.set_defaults(func=cmd_guide)

    p = sub.add_parser("new", parents=[common, by], help="create a note from its type's template")
    p.add_argument("type", help=f"one of: {', '.join(kb.TYPES)}")
    p.add_argument("title")
    p.add_argument("--description", required=True, help="one sentence saying what the note is")
    p.add_argument("--tags", help="comma-separated tags")
    p.add_argument("--status", choices=kb.STATUSES[:2], default="stable")
    p.add_argument("--source", action="append", metavar="ID=URL", help="a source for the note's facts (repeatable)")
    p.set_defaults(func=cmd_new)

    p = sub.add_parser("touch", parents=[common, by], help="record that a note's content changed")
    p.add_argument("file")
    p.add_argument("--message", help="what changed, for log.md")
    p.set_defaults(func=cmd_touch)

    p = sub.add_parser("verify", parents=[common, by], help="record that a note's content was checked")
    p.add_argument("file")
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("relate", parents=[common, by], help="mark a note as superseding or contradicting another")
    p.add_argument("file")
    p.add_argument("relation", choices=kb.RELATIONS)
    p.add_argument("target")
    p.set_defaults(func=cmd_relate)

    p = sub.add_parser("search", parents=[common], help="find notes, with trust and freshness")
    p.add_argument("words", nargs="*")
    p.add_argument("--type", help="only notes of this type")
    p.add_argument("--all", action="store_true", help="include deprecated notes")
    p.set_defaults(func=cmd_search)

    for name, func, text in (
        ("check", cmd_check, "validate the bundle"),
        ("review", cmd_review, "list maintenance work"),
        ("index", cmd_index, "rebuild index.md"),
    ):
        sub.add_parser(name, parents=[common], help=text).set_defaults(func=func)

    p = sub.add_parser("install-skill", help="write KnowledgeX as an Agent Skill into a skills folder")
    p.add_argument("folder", help="your agent's skills folder")
    p.set_defaults(func=cmd_install_skill)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
