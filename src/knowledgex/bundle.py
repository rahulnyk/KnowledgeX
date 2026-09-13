"""Core operations on a KnowledgeX bundle: a flat OKF v0.2 folder of markdown notes."""
from __future__ import annotations

import calendar
import os
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import quote, unquote

import yaml

OKF_VERSION = "0.2"
RESERVED = {"index.md", "log.md"}
STATUSES = ("draft", "stable", "deprecated")
RELATIONS = ("supersedes", "contradicts")
# The KnowledgeX type vocabulary, mapped to months until a note of that type goes stale (None: never).
TYPES = {
    "Decision": None,
    "Preference": 24,
    "Principle": None,
    "Lesson": None,
    "Concept": None,
    "Entity": 12,
    "Person": 12,
    "Playbook": 6,
    "Plan": 6,
    "Idea": 6,
    "Source": None,
    "Timeline": None,
}
KNOWN_KEYS = {
    # OKF v0.2 (timestamp is the v0.1 form of generated.at)
    "type", "title", "description", "resource", "tags", "sources", "generated", "verified",
    "status", "stale_after", "timestamp", "runtime", "parameters", "computation", "executor", "attester",
    # KnowledgeX extensions
    "created", "aliases", "supersedes", "contradicts",
}


def _without_timestamps(base):
    """YAML loader/dumper that keeps ISO 8601 dates as plain strings, the way OKF writes them."""

    class Cls(base):
        pass

    Cls.yaml_implicit_resolvers = {
        first: [(tag, rx) for tag, rx in rules if tag != "tag:yaml.org,2002:timestamp"]
        for first, rules in base.yaml_implicit_resolvers.items()
    }
    return Cls


Loader = _without_timestamps(yaml.SafeLoader)


class Dumper(_without_timestamps(yaml.SafeDumper)):
    def increase_indent(self, flow=False, indentless=False):  # indent list items under their key
        return super().increase_indent(flow, False)


FRONTMATTER = re.compile(r"\A---[ \t]*\r?\n(.*?)^---[ \t]*(?:\r?\n|\Z)", re.S | re.M)


@dataclass
class Note:
    path: Path
    meta: dict
    body: str
    error: str = ""

    @property
    def title(self) -> str:
        return str(self.meta.get("title") or self.path.stem)


def read_note(path: Path) -> Note:
    text = path.read_text(encoding="utf-8")
    match = FRONTMATTER.match(text)
    if not match:
        return Note(path, {}, text, "no YAML frontmatter")
    body = text[match.end():]
    try:
        meta = yaml.load(match.group(1), Loader=Loader)
    except yaml.YAMLError:
        return Note(path, {}, body, "frontmatter is not valid YAML")
    if meta is None:
        meta = {}
    if not isinstance(meta, dict):
        return Note(path, {}, body, "frontmatter is not a key/value mapping")
    return Note(path, meta, body)


def write_note(note: Note) -> None:
    front = yaml.dump(note.meta, Dumper=Dumper, sort_keys=False, allow_unicode=True, width=10**6)
    note.path.write_text(f"---\n{front}---\n{note.body}", encoding="utf-8")


def load_notes(root: Path) -> list[Note]:
    notes = []
    for path in sorted(root.rglob("*.md")):
        parts = path.relative_to(root).parts
        if path.name in RESERVED or any(part.startswith(".") for part in parts):
            continue
        notes.append(read_note(path))
    return notes


def rel(path: Path, root: Path) -> str:
    return Path(os.path.relpath(os.path.normpath(path), root)).as_posix()


# --- time ---------------------------------------------------------------------------------------

def now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(value) -> datetime | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def add_months(day: date, months: int) -> date:
    years, month_index = divmod(day.month - 1 + months, 12)
    year, month = day.year + years, month_index + 1
    return day.replace(year=year, month=month, day=min(day.day, calendar.monthrange(year, month)[1]))


# --- trust and freshness ------------------------------------------------------------------------

def as_list(value) -> list:
    """OKF allows a single mapping where a list is expected."""
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def changed_at(meta: dict) -> datetime | None:
    generated = meta.get("generated")
    return parse_time(generated.get("at")) if isinstance(generated, dict) else None


def valid_verifications(meta: dict) -> list[dict]:
    """Verifications made at or after the last content change; older ones no longer vouch for it."""
    changed = changed_at(meta)
    valid = []
    for entry in as_list(meta.get("verified")):
        if not isinstance(entry, dict):
            continue
        at = parse_time(entry.get("at"))
        if changed is None or (at is not None and at >= changed):
            valid.append(entry)
    return valid


def trust(meta: dict) -> str:
    """OKF trust tier: unverified, machine-confirmed, or human-reviewed."""
    valid = valid_verifications(meta)
    if any(str(entry.get("by", "")).startswith("human:") for entry in valid):
        return "human-reviewed"
    return "machine-confirmed" if valid else "unverified"


def freshness(meta: dict, moment: datetime | None = None) -> str:
    stale_after = parse_time(meta.get("stale_after"))
    if stale_after is None:
        return "no expiry"
    day = stale_after.date().isoformat()
    return f"stale since {day}" if (moment or now()) >= stale_after else f"fresh until {day}"


# --- links --------------------------------------------------------------------------------------

CODE = re.compile(r"```.*?```|~~~.*?~~~|`[^`\n]*`", re.S)
MD_LINK = re.compile(r"\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))[^)]*\)")
WIKILINK = re.compile(r"\[\[[^\]\n]+\]\]")
FOOTNOTE_REF = re.compile(r"\[\^([^\]\s]+)\](?!:)")
FOOTNOTE_DEF = re.compile(r"^\[\^([^\]\s]+)\]:", re.M)
SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")


def prose(body: str) -> str:
    """The body without code, so examples inside code are not read as links."""
    return CODE.sub("", body)


def local_links(note: Note, root: Path) -> list[str]:
    """Bundle-relative paths that the note's markdown links point at."""
    links = []
    for angled, plain in MD_LINK.findall(prose(note.body)):
        target = unquote((angled or plain).split("#", 1)[0])
        if not target or SCHEME.match(target):
            continue
        base = root if target.startswith("/") else note.path.parent
        links.append(rel(base / target.lstrip("/"), root))
    return links


def link_to(note: Note, other: Note) -> str:
    return quote(Path(os.path.relpath(other.path, note.path.parent)).as_posix())


def relation_targets(note: Note, root: Path, key: str) -> list[str]:
    """Bundle-relative paths listed under `supersedes` or `contradicts`."""
    return [rel(root / str(target).lstrip("/"), root) for target in as_list(note.meta.get(key))]


def superseded_by(notes: list[Note], root: Path) -> dict[str, list[str]]:
    successors: dict[str, list[str]] = {}
    for note in notes:
        for target in relation_targets(note, root, "supersedes"):
            successors.setdefault(target, []).append(rel(note.path, root))
    return successors


def slugify(title: str, limit: int = 60) -> str:
    ascii_title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_title.lower()).strip("-")
    if len(slug) > limit:
        slug = slug[:limit].rsplit("-", 1)[0]
    return slug or "note"


# --- reserved files -----------------------------------------------------------------------------

def render_index(root: Path, notes: list[Note]) -> str:
    groups: dict[str, list[Note]] = {}
    for note in notes:
        if note.error or not note.meta.get("type"):
            continue
        section = "Deprecated" if note.meta.get("status") == "deprecated" else str(note.meta["type"])
        groups.setdefault(section, []).append(note)
    order = [t for t in TYPES if t in groups]
    order += sorted(s for s in groups if s not in TYPES and s != "Deprecated")
    order += ["Deprecated"] if "Deprecated" in groups else []

    lines = ["---", f'okf_version: "{OKF_VERSION}"', "---", ""]
    for section in order:
        lines += [f"# {section}", ""]
        for note in sorted(groups[section], key=lambda n: n.title.lower()):
            entry = f"* [{note.title}]({quote(rel(note.path, root))})"
            description = str(note.meta.get("description") or "").strip()
            lines.append(f"{entry} - {description}" if description else entry)
        lines.append("")
    if not order:
        lines += ["_No notes yet._", ""]
    return "\n".join(lines)


def write_index(root: Path, notes: list[Note]) -> None:
    (root / "index.md").write_text(render_index(root, notes), encoding="utf-8")


def append_log(root: Path, kind: str, message: str) -> None:
    """Add an entry under today's heading in log.md, newest first."""
    path = root / "log.md"
    heading = f"## {now().date().isoformat()}"
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else ["# Log", ""]
    first = next((i for i, line in enumerate(lines) if line.startswith("## ")), None)
    entry = f"* **{kind}**: {message}"
    if first is not None and lines[first].strip() == heading:
        lines.insert(first + 1, entry)
    else:
        at = len(lines) if first is None else first
        lines[at:at] = [heading, entry, ""]
    path.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")


# --- search, check, review ----------------------------------------------------------------------

def search(root: Path, query: str = "", type_: str | None = None, include_deprecated: bool = False):
    """Notes matching every query word, best first, plus the map of superseded notes."""
    notes = [n for n in load_notes(root) if not n.error]
    terms = query.lower().split()
    hits = []
    for note in notes:
        meta = note.meta
        if type_ and str(meta.get("type", "")).lower() != type_.lower():
            continue
        if meta.get("status") == "deprecated" and not include_deprecated:
            continue
        weighted = (
            (3, " ".join([note.path.stem.replace("-", " "), note.title, *map(str, as_list(meta.get("aliases")))]).lower()),
            (2, " ".join([str(meta.get("description", "")), *map(str, as_list(meta.get("tags")))]).lower()),
            (1, note.body.lower()),
        )
        score = 0
        for term in terms:
            gained = sum(weight for weight, text in weighted if term in text)
            if not gained:
                break
            score += gained
        else:
            hits.append((score, note))
    hits.sort(key=lambda hit: (-hit[0], hit[1].title.lower()))
    return [note for _, note in hits], superseded_by(notes, root)


KEBAB = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*\.md$")
SMELLS = re.compile(
    r"\b(?:we discussed|as (?:discussed|mentioned)|earlier in (?:this|our) (?:chat|conversation)"
    r"|in this (?:chat|conversation)|today|yesterday|tomorrow|last week|next week|this morning)\b",
    re.I,
)
HINT = "<!-- kx:"


def check(root: Path) -> list[tuple[str, str, str]]:
    """Validate the bundle. Returns (level, file, message) with level 'error' or 'warning'."""
    notes = load_notes(root)
    findings: list[tuple[str, str, str]] = []

    def add(level: str, where: str, message: str) -> None:
        findings.append((level, where, message))

    index = root / "index.md"
    if not index.exists():
        add("warning", "index.md", "missing; run `kx index`")
    elif set(read_note(index).meta) - {"okf_version"}:
        add("error", "index.md", "the root index.md may only have `okf_version` in its frontmatter")
    elif index.read_text(encoding="utf-8") != render_index(root, notes):
        add("warning", "index.md", "out of date; run `kx index`")
    for path in root.rglob("index.md"):
        hidden = any(part.startswith(".") for part in path.relative_to(root).parts)
        if path.parent != root and not hidden and FRONTMATTER.match(path.read_text(encoding="utf-8")):
            add("error", rel(path, root), "only the root index.md may have frontmatter")

    paths = {rel(note.path, root) for note in notes}
    for note in notes:
        where, meta = rel(note.path, root), note.meta
        if note.error:
            add("error", where, note.error)
            continue

        if not str(meta.get("type") or "").strip():
            add("error", where, "missing `type` (required by OKF)")
        elif meta["type"] not in TYPES:
            add("warning", where, f"type `{meta['type']}` is not in the KnowledgeX vocabulary")
        for key in ("title", "description"):
            if not str(meta.get(key) or "").strip():
                add("error", where, f"missing `{key}`")
        if meta.get("status") not in STATUSES:
            add("error", where, f"`status` must be one of: {', '.join(STATUSES)}")
        generated = meta.get("generated")
        if not (isinstance(generated, dict) and generated.get("by") and parse_time(generated.get("at"))):
            add("error", where, "`generated` needs `by` and an ISO 8601 `at`")
        if "stale_after" in meta and not parse_time(meta["stale_after"]):
            add("error", where, "`stale_after` is not an ISO 8601 date or time")
        for entry in as_list(meta.get("verified")):
            if not (isinstance(entry, dict) and entry.get("by") and parse_time(entry.get("at"))):
                add("error", where, "each `verified` entry needs `by` and an ISO 8601 `at`")
        unknown = sorted(set(meta) - KNOWN_KEYS)
        if unknown:
            add("warning", where, f"keys outside OKF and the KnowledgeX profile: {', '.join(unknown)}")

        links = set(local_links(note, root))
        for key in RELATIONS:
            for target in relation_targets(note, root, key):
                if target == where:
                    add("error", where, f"`{key}` points at the note itself")
                elif target not in paths:
                    add("error", where, f"`{key}` target not found: {target}")
                elif target not in links:
                    add("error", where, f"`{key}` target also needs a link in the body: {target}")
        for target in sorted(links - paths):
            if not (root / target).exists():
                add("warning", where, f"broken link: {target}")

        text = prose(note.body)
        if WIKILINK.search(text):
            add("warning", where, "uses [[wikilinks]]; use markdown links like [Title](file.md)")
        sources = as_list(meta.get("sources"))
        if any(not (isinstance(s, dict) and s.get("resource")) for s in sources):
            add("warning", where, "each `sources` entry should have a `resource`")
        known_ids = {str(s.get("id")) for s in sources if isinstance(s, dict) and s.get("id")}
        orphans = sorted(set(FOOTNOTE_REF.findall(text)) - known_ids - set(FOOTNOTE_DEF.findall(text)))
        if orphans:
            add("warning", where, f"footnotes without a matching source id: {', '.join(orphans)}")
        if "/" in where:
            add("warning", where, "keep notes in the bundle root; KnowledgeX bundles are flat")
        elif not KEBAB.match(note.path.name):
            add("warning", where, "use a kebab-case file name, like my-note.md")
        smells = sorted({match.lower() for match in SMELLS.findall(text)})
        if smells:
            add("warning", where, f"reads like a chat transcript ({', '.join(smells)}); write for a reader with no context")
        if HINT in note.body:
            add("warning", where, "template hints (<!-- kx: ... -->) are still in the note")
    return findings


def review(root: Path, moment: datetime | None = None) -> dict[str, list[str]]:
    """Maintenance work, grouped by kind. Only non-empty groups are returned."""
    moment = moment or now()
    notes = [n for n in load_notes(root) if not n.error]
    successors = superseded_by(notes, root)
    groups: dict[str, list[str]] = {
        "Stale": [],
        "Edited since last verified": [],
        "Sources changed since last verified": [],
        "Superseded but not deprecated": [],
        "Deprecated without a successor": [],
        "Open contradictions": [],
        "Drafts": [],
        "Never verified": [],
    }
    for note in notes:
        meta, where = note.meta, rel(note.path, root)
        item = f"{where} ({note.title})"
        active = meta.get("status") != "deprecated"
        valid = valid_verifications(meta)

        if active and freshness(meta, moment).startswith("stale"):
            groups["Stale"].append(f"{item}: {freshness(meta, moment)}")
        if active and as_list(meta.get("verified")) and not valid:
            groups["Edited since last verified"].append(item)
        if active and not as_list(meta.get("verified")):
            groups["Never verified"].append(item)

        checked = [t for t in (parse_time(v.get("at")) for v in valid) if t]
        baseline = max(checked) if checked else changed_at(meta)
        changed = [
            str(s.get("id") or s.get("resource"))
            for s in as_list(meta.get("sources"))
            if isinstance(s, dict) and baseline and (parse_time(s.get("last_modified")) or baseline) > baseline
        ]
        if active and changed:
            groups["Sources changed since last verified"].append(f"{item}: {', '.join(changed)}")

        if active and where in successors:
            groups["Superseded but not deprecated"].append(f"{item}: by {', '.join(successors[where])}")
        if not active and where not in successors:
            groups["Deprecated without a successor"].append(item)
        if active and as_list(meta.get("contradicts")):
            targets = ", ".join(relation_targets(note, root, "contradicts"))
            groups["Open contradictions"].append(f"{item}: with {targets}")
        if meta.get("status") == "draft":
            groups["Drafts"].append(item)
    return {kind: items for kind, items in groups.items() if items}
