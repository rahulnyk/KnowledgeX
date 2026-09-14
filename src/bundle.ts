// Core operations on a KnowledgeX library: a folder of notebooks, each a flat OKF v0.2 bundle of markdown notes.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

export const VERSION = "0.3.0";
export const OKF_VERSION = "0.2";
export const RESERVED = new Set(["index.md", "log.md"]);
export const STATUSES = ["draft", "stable", "deprecated"] as const;
export const RELATIONS = ["supersedes", "contradicts"] as const;
export type Relation = (typeof RELATIONS)[number];
// The KnowledgeX type vocabulary, mapped to months until a note of that type goes stale (null: never).
export const TYPES: Record<string, number | null> = {
  Decision: null,
  Preference: 24,
  Principle: null,
  Lesson: null,
  Concept: null,
  Entity: 12,
  Person: 12,
  Playbook: 6,
  Plan: 6,
  Idea: 6,
  Source: null,
  Timeline: null,
};
export const isType = (type: unknown): type is string => typeof type === "string" && Object.hasOwn(TYPES, type);
const expiryMonths = (type: unknown): number | null => (isType(type) ? TYPES[type] : null);
const KNOWN_KEYS = new Set([
  // OKF v0.2 (timestamp is the v0.1 form of generated.at)
  "type", "title", "description", "resource", "tags", "sources", "generated", "verified",
  "status", "stale_after", "timestamp", "runtime", "parameters", "computation", "executor", "attester",
  // KnowledgeX extensions
  "created", "aliases", "supersedes", "contradicts",
]);

export type Meta = Record<string, any>;
export interface Note {
  path: string;
  meta: Meta;
  body: string;
  error: string;
}

export const titleOf = (note: Note): string => String(note.meta.title || basename(note.path).replace(/\.md$/, ""));
const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

// --- reading and writing ------------------------------------------------------------------------

function splitFrontmatter(text: string): { yaml: string; body: string } | null {
  const open = /^---[ \t]*\r?\n/.exec(text);
  if (!open) return null;
  const close = /^---[ \t]*(?:\r?\n|$)/gm;
  close.lastIndex = open[0].length;
  const match = close.exec(text);
  if (!match) return null;
  return { yaml: text.slice(open[0].length, match.index), body: text.slice(match.index + match[0].length) };
}

export function readNote(path: string): Note {
  const text = readFileSync(path, "utf8");
  const parts = splitFrontmatter(text);
  if (!parts) return { path, meta: {}, body: text, error: "no YAML frontmatter" };
  let meta: unknown;
  try {
    meta = parse(parts.yaml); // YAML 1.2 core schema: ISO dates stay plain strings, as OKF writes them
  } catch {
    return { path, meta: {}, body: parts.body, error: "frontmatter is not valid YAML" };
  }
  if (meta === null || meta === undefined) meta = {};
  if (typeof meta !== "object" || Array.isArray(meta)) {
    return { path, meta: {}, body: parts.body, error: "frontmatter is not a key/value mapping" };
  }
  return { path, meta: meta as Meta, body: parts.body, error: "" };
}

export function writeNote(note: Note): void {
  const front = stringify(note.meta, { lineWidth: 0 });
  writeFileSync(note.path, `---\n${front}---\n${note.body}`, "utf8");
}

/** The notes in a bundle. Bundles are flat, so only the top level is read. */
export function loadNotes(root: string): Note[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".") && !RESERVED.has(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((name) => readNote(join(root, name)));
}

/** True if the folder already holds a KnowledgeX or OKF bundle. */
export function isBundle(dir: string): boolean {
  const index = join(dir, "index.md");
  return existsSync(index) && readNote(index).meta.okf_version !== undefined;
}

/** Bundle-relative path with forward slashes. */
export function rel(path: string, root: string): string {
  return relative(root, resolve(path)).split(sep).join("/");
}

// --- time ---------------------------------------------------------------------------------------

export const now = (): Date => new Date(Math.floor(Date.now() / 1000) * 1000);
export const iso = (moment: Date): string => moment.toISOString().replace(/\.\d{3}Z$/, "Z");
export const day = (moment: Date): string => moment.toISOString().slice(0, 10);

const ISO_TIME = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function parseTime(value: unknown): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  const match = ISO_TIME.exec(text);
  if (!match) return null;
  // A date-only value is UTC midnight; a time without a zone is treated as UTC too.
  const normal = text.length === 10 ? `${text}T00:00:00Z` : match[1] ? text.replace(" ", "T") : `${text.replace(" ", "T")}Z`;
  const moment = new Date(normal);
  return Number.isNaN(moment.getTime()) ? null : moment;
}

export function addMonths(dayText: string, months: number): string {
  const [year, month, date] = dayText.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, lastDay));
  return day(target);
}

// --- trust and freshness ------------------------------------------------------------------------

/** OKF allows a single mapping where a list is expected. */
export function asList(value: unknown): any[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const isMapping = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function changedAt(meta: Meta): Date | null {
  return isMapping(meta.generated) ? parseTime(meta.generated.at) : null;
}

export const checkKey = (entry: Record<string, any>): string => `${entry.by} ${entry.at}`;

/**
 * Verifications made at or after the last content change; older ones no longer vouch for it.
 * `local`, for a note in a library, holds the checks made in this library: only those count, so trust never travels with a copy.
 */
export function validVerifications(meta: Meta, local?: Set<string>): Record<string, any>[] {
  const changed = changedAt(meta);
  return asList(meta.verified).filter((entry) => {
    if (!isMapping(entry) || (local && !local.has(checkKey(entry)))) return false;
    const at = parseTime(entry.at);
    return changed === null || (at !== null && at >= changed);
  });
}

export type Trust = "unverified" | "machine-confirmed" | "human-reviewed";

/** OKF trust tier. */
export function trust(meta: Meta, local?: Set<string>): Trust {
  const valid = validVerifications(meta, local);
  if (valid.some((entry) => String(entry.by ?? "").startsWith("human:"))) return "human-reviewed";
  return valid.length ? "machine-confirmed" : "unverified";
}

export function freshness(meta: Meta, moment: Date = now()): string {
  const staleAfter = parseTime(meta.stale_after);
  if (!staleAfter) return "no expiry";
  return moment >= staleAfter ? `stale since ${day(staleAfter)}` : `fresh until ${day(staleAfter)}`;
}

// --- links --------------------------------------------------------------------------------------

const CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g;
const MD_LINK = /\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))[^)]*\)/g;
const WIKILINK = /\[\[[^\]\n]+\]\]/;
const FOOTNOTE_REF = /\[\^([^\]\s]+)\](?!:)/g;
const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:/gm;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** The body without code, so examples inside code are not read as links. */
export const prose = (body: string): string => body.replace(CODE, "");

const safeDecode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};
export const encodePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

/** Bundle-relative paths that the note's markdown links point at. */
export function localLinks(note: Note, root: string): string[] {
  const links: string[] = [];
  for (const match of prose(note.body).matchAll(MD_LINK)) {
    const target = safeDecode((match[1] ?? match[2] ?? "").split("#")[0]);
    if (!target || SCHEME.test(target)) continue;
    const base = target.startsWith("/") ? root : dirname(note.path);
    links.push(rel(join(base, target.replace(/^\/+/, "")), root));
  }
  return links;
}

export function linkTo(from: Note, to: Note): string {
  return encodePath(relative(dirname(from.path), to.path).split(sep).join("/"));
}

/** Bundle-relative paths listed under `supersedes` or `contradicts`. */
export function relationTargets(note: Note, root: string, key: Relation): string[] {
  return asList(note.meta[key]).map((target) => rel(join(root, String(target).replace(/^\/+/, "")), root));
}

export function supersededBy(notes: Note[], root: string): Map<string, string[]> {
  const successors = new Map<string, string[]>();
  for (const note of notes) {
    for (const target of relationTargets(note, root, "supersedes")) {
      successors.set(target, [...(successors.get(target) ?? []), rel(note.path, root)]);
    }
  }
  return successors;
}

/** A portable kebab-case file name. Titles in other scripts keep a short hash, so different titles never share a file. */
export function slugify(title: string, limit = 60): string {
  const stripped = title.normalize("NFKD").replace(/\p{M}/gu, "");
  let slug = stripped.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > limit) {
    slug = slug.slice(0, limit);
    if (slug.includes("-")) slug = slug.slice(0, slug.lastIndexOf("-"));
  }
  if (!/(?![\x00-\x7f])[\p{L}\p{N}]/u.test(stripped)) return slug || "note"; // only letters or digits outside ASCII need the hash
  const hash = createHash("sha256").update(title.normalize("NFC")).digest("hex").slice(0, 8);
  return slug ? `${slug}-${hash}` : `note-${hash}`;
}

// --- reserved files -----------------------------------------------------------------------------

export function renderIndex(root: string, notes: Note[]): string {
  const groups = new Map<string, Note[]>();
  for (const note of notes) {
    if (note.error || !note.meta.type) continue;
    const section = note.meta.status === "deprecated" ? "Deprecated" : String(note.meta.type);
    groups.set(section, [...(groups.get(section) ?? []), note]);
  }
  const order = [
    ...Object.keys(TYPES).filter((t) => groups.has(t)),
    ...[...groups.keys()].filter((s) => !isType(s) && s !== "Deprecated").sort(),
    ...(groups.has("Deprecated") ? ["Deprecated"] : []),
  ];
  const lines = ["---", `okf_version: "${OKF_VERSION}"`, "---", ""];
  for (const section of order) {
    lines.push(`# ${section}`, "");
    const sorted = [...groups.get(section)!].sort((a, b) => titleOf(a).toLowerCase().localeCompare(titleOf(b).toLowerCase()));
    for (const note of sorted) {
      const entry = `* [${titleOf(note)}](${encodePath(rel(note.path, root))})`;
      const description = String(note.meta.description ?? "").trim();
      lines.push(description ? `${entry} - ${description}` : entry);
    }
    lines.push("");
  }
  if (!order.length) lines.push("_No notes yet._", "");
  return lines.join("\n");
}

export function writeIndex(root: string, notes: Note[] = loadNotes(root)): void {
  writeFileSync(join(root, "index.md"), renderIndex(root, notes), "utf8");
  const library = dirname(resolve(root));
  if (existsSync(join(library, STATE_FILE))) writeLibraryIndex(library);
}

/** Add an entry under today's heading in log.md, newest first. */
export function appendLog(root: string, kind: string, message: string): void {
  const path = join(root, "log.md");
  const heading = `## ${day(now())}`;
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : ["# Log", ""];
  const first = lines.findIndex((line) => line.startsWith("## "));
  const entry = `* **${kind}**: ${message}`;
  if (first >= 0 && lines[first].trim() === heading) lines.splice(first + 1, 0, entry);
  else lines.splice(first >= 0 ? first : lines.length, 0, heading, entry, "");
  writeFileSync(path, lines.join("\n").replace(/\n+$/, "") + "\n", "utf8");
}

/** Create the bundle folder and its reserved files if they are missing. */
export function ensureBundle(root: string): void {
  mkdirSync(root, { recursive: true });
  if (!existsSync(join(root, "index.md"))) writeIndex(root);
  if (!existsSync(join(root, "log.md"))) appendLog(root, "Creation", "Started the notebook.");
}

// --- search, check, review ----------------------------------------------------------------------

export function search(root: string, query = "", type?: string, includeDeprecated = false) {
  const notes = loadNotes(root).filter((note) => !note.error);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: [number, Note][] = [];
  for (const note of notes) {
    const meta = note.meta;
    if (type && String(meta.type ?? "").toLowerCase() !== type.toLowerCase()) continue;
    if (meta.status === "deprecated" && !includeDeprecated) continue;
    const weighted: [number, string][] = [
      [3, [basename(note.path).replace(/\.md$/, "").replace(/-/g, " "), titleOf(note), ...asList(meta.aliases).map(String)].join(" ").toLowerCase()],
      [2, [String(meta.description ?? ""), ...asList(meta.tags).map(String)].join(" ").toLowerCase()],
      [1, note.body.toLowerCase()],
    ];
    let score = 0;
    let matchesAll = true;
    for (const term of terms) {
      const gained = weighted.reduce((sum, [weight, text]) => sum + (text.includes(term) ? weight : 0), 0);
      if (!gained) {
        matchesAll = false;
        break;
      }
      score += gained;
    }
    if (matchesAll) hits.push([score, note]);
  }
  hits.sort((a, b) => b[0] - a[0] || titleOf(a[1]).toLowerCase().localeCompare(titleOf(b[1]).toLowerCase()));
  return { notes: hits.map(([, note]) => note), successors: supersededBy(notes, root) };
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const SMELLS =
  /\b(?:we discussed|as (?:discussed|mentioned)|earlier in (?:this|our) (?:chat|conversation)|in this (?:chat|conversation)|today|yesterday|tomorrow|last week|next week|this morning)\b/gi;
export const HINT = "<!-- kx:";

export type Finding = { level: "error" | "warning"; file: string; message: string };

/** Validate the bundle. */
export function check(root: string): Finding[] {
  const notes = loadNotes(root);
  const findings: Finding[] = [];
  const add = (level: Finding["level"], file: string, message: string) => findings.push({ level, file, message });

  const index = join(root, "index.md");
  if (!existsSync(index)) add("warning", "index.md", "missing; run `kx index`");
  else if (Object.keys(readNote(index).meta).some((key) => key !== "okf_version"))
    add("error", "index.md", "the root index.md may only have `okf_version` in its frontmatter");
  else if (readFileSync(index, "utf8") !== renderIndex(root, notes)) add("warning", "index.md", "out of date; run `kx index`");

  const paths = new Set(notes.map((note) => rel(note.path, root)));
  for (const note of notes) {
    const file = rel(note.path, root);
    const meta = note.meta;
    if (note.error) {
      add("error", file, note.error);
      continue;
    }

    if (!String(meta.type ?? "").trim()) add("error", file, "missing `type` (required by OKF)");
    else if (!isType(meta.type)) add("warning", file, `type \`${meta.type}\` is not in the KnowledgeX vocabulary`);
    for (const key of ["title", "description"]) {
      if (!String(meta[key] ?? "").trim()) add("error", file, `missing \`${key}\``);
    }
    if (!STATUSES.includes(meta.status)) add("error", file, `\`status\` must be one of: ${STATUSES.join(", ")}`);
    if (!(isMapping(meta.generated) && meta.generated.by && parseTime(meta.generated.at)))
      add("error", file, "`generated` needs `by` and an ISO 8601 `at`");
    if ("stale_after" in meta && !parseTime(meta.stale_after)) add("error", file, "`stale_after` is not an ISO 8601 date or time");
    for (const entry of asList(meta.verified)) {
      if (!(isMapping(entry) && entry.by && parseTime(entry.at)))
        add("error", file, "each `verified` entry needs `by` and an ISO 8601 `at`");
    }
    const unknown = Object.keys(meta).filter((key) => !KNOWN_KEYS.has(key)).sort();
    if (unknown.length) add("warning", file, `keys outside OKF and the KnowledgeX profile: ${unknown.join(", ")}`);

    const links = new Set(localLinks(note, root));
    for (const key of RELATIONS) {
      for (const target of relationTargets(note, root, key)) {
        if (target === file) add("error", file, `\`${key}\` points at the note itself`);
        else if (!paths.has(target)) add("error", file, `\`${key}\` target not found: ${target}`);
        else if (!links.has(target)) add("error", file, `\`${key}\` target also needs a link in the body: ${target}`);
      }
    }
    for (const target of [...links].filter((link) => !paths.has(link)).sort()) {
      if (!existsSync(join(root, target))) add("warning", file, `broken link: ${target}`);
    }

    const text = prose(note.body);
    if (WIKILINK.test(text)) add("warning", file, "uses [[wikilinks]]; use markdown links like [Title](file.md)");
    const sources = asList(meta.sources);
    if (sources.some((source) => !(isMapping(source) && source.resource)))
      add("warning", file, "each `sources` entry should have a `resource`");
    const knownIds = new Set(sources.filter((s) => isMapping(s) && s.id).map((s) => String(s.id)));
    const definitions = new Set([...text.matchAll(FOOTNOTE_DEF)].map((m) => m[1]));
    const orphans = [...new Set([...text.matchAll(FOOTNOTE_REF)].map((m) => m[1]))]
      .filter((id) => !knownIds.has(id) && !definitions.has(id))
      .sort();
    if (orphans.length) add("warning", file, `footnotes without a matching source id: ${orphans.join(", ")}`);
    if (!KEBAB.test(basename(note.path))) add("warning", file, "use a kebab-case file name, like my-note.md");
    const smells = [...new Set([...text.matchAll(SMELLS)].map((m) => m[0].toLowerCase()))].sort();
    if (smells.length)
      add("warning", file, `reads like a chat transcript (${smells.join(", ")}); write for a reader with no context`);
    if (note.body.includes(HINT)) add("warning", file, "template hints (<!-- kx: ... -->) are still in the note");
  }
  return findings;
}

/** Maintenance work, grouped by kind. Only non-empty groups are returned. */
export function review(root: string, moment: Date = now()): Map<string, string[]> {
  const notes = loadNotes(root).filter((note) => !note.error);
  const successors = supersededBy(notes, root);
  const groups = new Map<string, string[]>(
    [
      "Stale",
      "Confirmed in another copy, not in this library",
      "Edited since last verified",
      "Sources changed since last verified",
      "Superseded but not deprecated",
      "Deprecated without a successor",
      "Open contradictions",
      "Drafts",
      "Never verified",
    ].map((kind) => [kind, []]),
  );
  const push = (kind: string, item: string) => groups.get(kind)!.push(item);

  for (const note of notes) {
    const meta = note.meta;
    const file = rel(note.path, root);
    const item = `${file} (${titleOf(note)})`;
    const active = meta.status !== "deprecated";
    const local = localChecks(root, note);
    const valid = validVerifications(meta, local);
    const verified = asList(meta.verified);

    if (active && freshness(meta, moment).startsWith("stale")) push("Stale", `${item}: ${freshness(meta, moment)}`);
    if (active && local && !valid.length && validVerifications(meta).length) push("Confirmed in another copy, not in this library", item);
    else if (active && verified.length && !valid.length) push("Edited since last verified", item);
    if (active && !verified.length) push("Never verified", item);

    const checked = valid.map((v) => parseTime(v.at)).filter((t): t is Date => t !== null);
    const baseline = checked.length ? new Date(Math.max(...checked.map((t) => t.getTime()))) : changedAt(meta);
    const changed = asList(meta.sources)
      .filter((s) => isMapping(s) && baseline && (parseTime(s.last_modified) ?? baseline) > baseline)
      .map((s) => String(s.id || s.resource));
    if (active && changed.length) push("Sources changed since last verified", `${item}: ${changed.join(", ")}`);

    if (active && successors.has(file)) push("Superseded but not deprecated", `${item}: by ${successors.get(file)!.join(", ")}`);
    if (!active && !successors.has(file)) push("Deprecated without a successor", item);
    if (active && asList(meta.contradicts).length)
      push("Open contradictions", `${item}: with ${relationTargets(note, root, "contradicts").join(", ")}`);
    if (meta.status === "draft") push("Drafts", item);
  }
  return new Map([...groups].filter(([, items]) => items.length));
}

// --- guides -------------------------------------------------------------------------------------

export const GUIDES = {
  overview: "overview.md",
  what: "what-to-write.md",
  write: "how-to-write.md",
  retrieve: "how-to-retrieve.md",
  maintain: "maintain.md",
} as const;
export type GuideTopic = keyof typeof GUIDES | "all";

function guidesDir(): string {
  // Next to the compiled package (dist/src → ../../guides) or the single-file extension bundle (server → ../guides).
  const here = dirname(fileURLToPath(import.meta.url));
  const found = [join(here, "..", "..", "guides"), join(here, "..", "guides")].find((dir) => existsSync(join(dir, "overview.md")));
  if (!found) throw new Error("KnowledgeX guides folder not found");
  return found;
}

export function guideText(topic: GuideTopic): string {
  const names = topic === "all" ? Object.values(GUIDES) : [GUIDES[topic]];
  return names.map((name) => readFileSync(join(guidesDir(), name), "utf8")).join("\n\n---\n\n");
}

// --- note operations shared by the command line and the MCP server --------------------------------

export const ACTOR = /^(?:human:|process:)\S+$|^[^\s/:]+\/\S+$/;

export function configPath(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "knowledgex", "config.json");
}

/** The library folder from $KX_BUNDLE, then from `kx init`; undefined if neither is set. */
export function configuredLibrary(): string | undefined {
  const saved = existsSync(configPath()) ? JSON.parse(readFileSync(configPath(), "utf8")) : {};
  const configured = process.env.KX_BUNDLE || saved.library || saved.bundle; // `bundle`: written by v0.2
  return configured ? expandHome(configured) : undefined;
}

export const expandHome = (path: string): string => resolve(path.replace(/^~(?=$|\/|\\)/, homedir()));

export class KxError extends Error {}

/** Open a note by bundle-relative or absolute path; the `.md` extension is optional. */
export function openNote(root: string, file: string): Note {
  const base = resolve(root);
  const path = [resolve(base, file), resolve(base, `${file}.md`)].find((p) => existsSync(p) && statSync(p).isFile());
  if (!path) throw new KxError(`Note not found in the bundle: ${file}`);
  if (!path.startsWith(base + sep)) throw new KxError(`${file} is outside the bundle (${base}).`);
  if (RESERVED.has(basename(path))) throw new KxError(`${basename(path)} is a reserved file, not a note.`);
  const note = readNote(path);
  if (note.error) throw new KxError(`${file}: ${note.error}`);
  return note;
}

export interface NewNote {
  type: string;
  title: string;
  description: string;
  body: string;
  by: string;
  tags?: string[];
  status?: "draft" | "stable";
  sources?: { id: string; resource: string; title?: string }[];
}

export function createNote(root: string, input: NewNote): Note {
  const path = join(root, `${slugify(input.title)}.md`);
  const file = rel(path, root);
  if (existsSync(path)) throw new KxError(`${file} already exists. Update that note instead.`);
  const stamp = now();
  const meta: Meta = { type: input.type, title: input.title, description: input.description };
  if (input.tags?.length) meta.tags = input.tags;
  meta.status = input.status ?? "stable";
  meta.created = day(stamp);
  meta.generated = { by: input.by, at: iso(stamp) };
  const months = expiryMonths(input.type);
  if (months) meta.stale_after = `${addMonths(day(stamp), months)}T00:00:00Z`;
  if (input.sources?.length) meta.sources = input.sources;
  const note: Note = { path, meta, body: `\n${input.body.replace(/^\n+/, "")}`, error: "" };
  writeNote(note);
  appendLog(root, "Creation", `Added [${input.title}](${encodePath(file)}).`);
  writeIndex(root);
  return note;
}

/** Record a content change. Returns the trust tier the note had before, which the change has now reset. */
export function touchNote(root: string, note: Note, by: string, message?: string): Trust {
  const before = trust(note.meta, localChecks(root, note));
  const checks = asList(note.meta.verified).map((v) => (isMapping(v) ? parseTime(v.at) : null)).filter((t): t is Date => t !== null);
  const lastCheck = checks.length ? Math.max(...checks.map((t) => t.getTime())) : 0;
  // Timestamps have one-second resolution: an edit must land strictly after the last check, or the check would still count.
  note.meta.generated = { by, at: iso(new Date(Math.max(now().getTime(), lastCheck + 1000))) };
  writeNote(note);
  const file = rel(note.path, root);
  appendLog(root, "Update", `Updated [${titleOf(note)}](${encodePath(file)})${message ? `: ${message}` : "."}`);
  writeIndex(root);
  return before;
}

export interface NoteChanges {
  title?: string;
  description?: string;
  body?: string;
  tags?: string[];
  status?: "draft" | "stable" | "deprecated";
  sources?: { id: string; resource: string; title?: string }[];
}

/** Apply changes to a note and record them. The file name never changes, so links keep working. */
export function updateNote(root: string, note: Note, changes: NoteChanges, by: string, message?: string): Trust {
  if (note.meta.type === "Decision" && changes.body !== undefined && changes.body.trim() !== note.body.trim()) {
    throw new KxError("Decisions are never edited. Save the new decision as its own note, then mark it as superseding this one.");
  }
  if (changes.title && changes.title !== note.meta.title) {
    note.meta.aliases = [...new Set([...asList(note.meta.aliases).map(String), String(note.meta.title ?? "")].filter(Boolean))];
    note.meta.title = changes.title;
  }
  if (changes.description !== undefined) note.meta.description = changes.description;
  if (changes.tags !== undefined) note.meta.tags = changes.tags;
  if (changes.status !== undefined) note.meta.status = changes.status;
  if (changes.sources !== undefined) note.meta.sources = changes.sources;
  if (changes.body !== undefined) note.body = `\n${changes.body.replace(/^\n+/, "")}`;
  return touchNote(root, note, by, message);
}

export function verifyNote(root: string, note: Note, by: string): Trust {
  const changed = changedAt(note.meta);
  const stamp = new Date(Math.max(now().getTime(), changed?.getTime() ?? 0)); // never before the change it vouches for
  const entry = { by, at: iso(stamp) };
  note.meta.verified = [...asList(note.meta.verified), entry];
  recordCheck(root, note, entry);
  const months = expiryMonths(note.meta.type);
  if (months && "stale_after" in note.meta) note.meta.stale_after = `${addMonths(day(stamp), months)}T00:00:00Z`; // a checked note starts a fresh expiry window
  writeNote(note);
  appendLog(root, "Verification", `[${titleOf(note)}](${encodePath(rel(note.path, root))}) checked by ${by}.`);
  writeIndex(root);
  return trust(note.meta, localChecks(root, note));
}

function ensureLink(root: string, note: Note, other: Note, label: string): void {
  if (!localLinks(note, root).includes(rel(other.path, root))) {
    note.body = `${note.body.replace(/\n+$/, "")}\n\n${label} [${titleOf(other)}](${linkTo(note, other)}).\n`;
  }
}

export function relateNotes(root: string, source: Note, relation: Relation, target: Note): void {
  if (resolve(source.path) === resolve(target.path)) throw new KxError("A note cannot relate to itself.");
  const sourceFile = rel(source.path, root);
  const targetFile = rel(target.path, root);
  if (!relationTargets(source, root, relation).includes(targetFile)) {
    source.meta[relation] = [...asList(source.meta[relation]).map(String), targetFile];
  }
  ensureLink(root, source, target, relation === "supersedes" ? "Supersedes" : "Contradicts");
  writeNote(source);
  const pair = `[${titleOf(source)}](${encodePath(sourceFile)}) ${relation} [${titleOf(target)}](${encodePath(targetFile)}).`;
  if (relation === "supersedes") {
    target.meta.status = "deprecated";
    ensureLink(root, target, source, "Superseded by");
    writeNote(target);
    appendLog(root, "Supersession", pair);
  } else {
    appendLog(root, "Contradiction", pair);
  }
  writeIndex(root);
}

// --- notebooks: a library of bundles --------------------------------------------------------------

export const DEFAULT_NOTEBOOK = "general";
const STATE_FILE = ".knowledgex.json";
const LOCK_FILE = ".knowledgex.lock";
const NOTEBOOK_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
type NotebookRecord = { received?: string; confirmed?: Record<string, string[]> };
type LibraryState = { notebooks: Record<string, NotebookRecord> };

function readState(library: string): LibraryState {
  try {
    const state = JSON.parse(readFileSync(join(library, STATE_FILE), "utf8"));
    if (isMapping(state?.notebooks)) return state;
  } catch {
    // missing or unreadable: no confirmation counts until made again, which fails safe
  }
  return { notebooks: {} };
}

function writeState(library: string, state: LibraryState): void {
  writeFileSync(join(library, STATE_FILE), JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** The notebooks in a library: subfolders that are OKF bundles. */
export function notebooks(library: string): string[] {
  if (!existsSync(library)) return [];
  return readdirSync(library, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && isBundle(join(library, entry.name)))
    .map((entry) => entry.name)
    .sort();
}

/** True if the folder is a library: it has a state file, or holds nothing but notebooks and the library index. */
export function isLibrary(dir: string): boolean {
  if (existsSync(join(dir, STATE_FILE))) return true;
  const found = new Set(notebooks(dir));
  return found.size > 0 && readdirSync(dir).every((name) => name.startsWith(".") || name === "index.md" || found.has(name));
}

/**
 * The library for a chosen folder: the library a chosen notebook belongs to; the folder itself if it is empty,
 * a library, or a v0.2 bundle; otherwise a KnowledgeX folder inside it.
 */
export function libraryFor(folder: string): string {
  const parent = dirname(resolve(folder));
  if (isBundle(folder) && existsSync(join(parent, STATE_FILE))) return parent;
  const busy = existsSync(folder) && !isBundle(folder) && !isLibrary(folder) && readdirSync(folder).some((name) => !name.startsWith("."));
  return busy ? join(folder, "KnowledgeX") : folder;
}

/**
 * Prepare a library and return its notebooks. A v0.2 bundle moves into `general` and keeps its confirmations,
 * an empty library gets `general`, and any other notebook seen for the first time is recorded as received.
 */
export function openLibrary(library: string): string[] {
  mkdirSync(library, { recursive: true });
  if (migrating(library)) return notebooks(library);
  if (isV02Bundle(library) && !migrate(library)) return notebooks(library);
  const state = readState(library);
  const before = JSON.stringify(state);
  const stamp = iso(now());
  let names = notebooks(library);
  if (!names.length) {
    state.notebooks[DEFAULT_NOTEBOOK] = {};
    ensureBundle(join(library, DEFAULT_NOTEBOOK));
    names = [DEFAULT_NOTEBOOK];
  }
  // Records of notebooks that are missing are kept: a notebook may be only briefly unreadable, such as while a sync
  // client restores it. Keeping them is safe, because a copy's confirmations never match checks recorded here.
  for (const name of names) state.notebooks[name] ??= { received: stamp };
  if (JSON.stringify(state) !== before) writeState(library, state);
  writeLibraryIndex(library);
  return names;
}

/** A folder that holds notes directly, as v0.2 did, rather than an already-started library. */
function isV02Bundle(folder: string): boolean {
  return isBundle(folder) && !existsSync(join(folder, STATE_FILE)) && !notebooks(folder).length;
}

/** True while another process is moving a v0.2 folder into `general`. A lock over a minute old is left from a crash. */
function migrating(library: string): boolean {
  const lock = join(library, LOCK_FILE);
  try {
    if (Date.now() - statSync(lock).mtimeMs < 60_000) return true;
    rmSync(lock, { force: true });
  } catch {
    // no lock
  }
  return false;
}

/** Move a v0.2 folder's notes into `general`, keeping their confirmations. False if another process is doing it. */
function migrate(library: string): boolean {
  const lock = join(library, LOCK_FILE);
  try {
    writeFileSync(lock, "", { flag: "wx" }); // several app processes can start at once; only one migrates
  } catch {
    return false;
  }
  try {
    if (!isV02Bundle(library)) return true; // finished by another process just before the lock was taken
    const target = join(library, DEFAULT_NOTEBOOK);
    if (existsSync(target)) throw new KxError(`Can't turn ${library} into a library of notebooks: it already has a ${DEFAULT_NOTEBOOK} folder.`);
    mkdirSync(target);
    for (const name of readdirSync(library)) {
      if (!name.startsWith(".") && name !== DEFAULT_NOTEBOOK) renameSync(join(library, name), join(target, name));
    }
    appendLog(target, "Update", `Became the ${DEFAULT_NOTEBOOK} notebook of a KnowledgeX library.`);
    // The user's own notes, not a copy: their existing confirmations are recorded as made here.
    const confirmed: Record<string, string[]> = {};
    for (const note of loadNotes(target)) {
      const checks = validVerifications(note.meta).map(checkKey);
      if (checks.length) confirmed[rel(note.path, target)] = checks;
    }
    writeState(library, { notebooks: { [DEFAULT_NOTEBOOK]: { confirmed } } });
    return true;
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Start a new, empty notebook in a library. */
export function createNotebook(library: string, name: string): void {
  if (!NOTEBOOK_NAME.test(name)) throw new KxError(`Notebook names use lowercase letters, digits, and hyphens, like client-acme. Got: ${name}`);
  openLibrary(library); // a v0.2 folder must become a library first, or the new notebook would end up inside general
  if (existsSync(join(library, name))) throw new KxError(`There is already a notebook or folder named ${name}.`);
  const state = readState(library);
  state.notebooks[name] = {};
  writeState(library, state);
  ensureBundle(join(library, name));
}

/** Copy a bundle into the library as a received notebook. Returns its name. */
export function addNotebook(library: string, from: string, name?: string): string {
  const source = expandHome(from);
  if (!isBundle(source)) throw new KxError(`${from} is not an OKF bundle: it needs an index.md with okf_version.`);
  const target = name ?? slugify(basename(source));
  if (!NOTEBOOK_NAME.test(target)) throw new KxError(`Notebook names use lowercase letters, digits, and hyphens, like client-acme. Got: ${target}`);
  if (existsSync(join(library, target))) throw new KxError(`There is already a notebook or folder named ${target}. Choose another name.`);
  openLibrary(library);
  cpSync(source, join(library, target), { recursive: true });
  const state = readState(library);
  state.notebooks[target] = { received: iso(now()) }; // a fresh record, even if the library once had a notebook by this name
  writeState(library, state);
  openLibrary(library);
  return target;
}

/** One line about a notebook: how many notes, of which types, and whether it was received. */
export function notebookSummary(library: string, name: string): string {
  const notes = loadNotes(join(library, name)).filter((note) => !note.error && note.meta.status !== "deprecated");
  const counts = new Map<string, number>();
  for (const note of notes) counts.set(String(note.meta.type ?? "?"), (counts.get(String(note.meta.type ?? "?")) ?? 0) + 1);
  const types = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([type]) => type);
  const received = readState(library).notebooks[name]?.received;
  return [
    `${notes.length} note${notes.length === 1 ? "" : "s"}${types.length ? ` (mostly ${types.join(", ")})` : ""}`,
    ...(received ? [`received ${received.slice(0, 10)}`] : []),
  ].join("; ");
}

function writeLibraryIndex(library: string): void {
  const lines = ["# Notebooks", "", ...notebooks(library).map((name) => `* [${name}](${encodePath(name)}/) - ${notebookSummary(library, name)}`), ""];
  const path = join(library, "index.md");
  const text = lines.join("\n");
  if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text, "utf8");
}

/** For a note in a library's notebook, the checks made in this library; undefined for a bundle outside a library. */
export function localChecks(root: string, note: Note): Set<string> | undefined {
  const library = dirname(resolve(root));
  if (!existsSync(join(library, STATE_FILE))) return undefined;
  return new Set(readState(library).notebooks[basename(resolve(root))]?.confirmed?.[rel(note.path, root)] ?? []);
}

function recordCheck(root: string, note: Note, entry: Record<string, any>): void {
  const library = dirname(resolve(root));
  if (!existsSync(join(library, STATE_FILE))) return;
  const state = readState(library);
  const record = (state.notebooks[basename(resolve(root))] ??= {});
  const file = rel(note.path, root);
  record.confirmed = { ...record.confirmed, [file]: [...(record.confirmed?.[file] ?? []), checkKey(entry)] };
  writeState(library, state);
}

/** A note's id across the library: `notebook/file`. */
export const noteId = (root: string, path: string): string => `${basename(resolve(root))}/${rel(path, root)}`;

/** Open a note by `notebook/file`, or by file name alone when exactly one of the given notebooks has it. */
export function findNote(library: string, names: string[], id: string): { root: string; note: Note } {
  const slash = id.indexOf("/");
  if (slash > 0 && names.includes(id.slice(0, slash))) {
    const root = join(library, id.slice(0, slash));
    return { root, note: openNote(root, id.slice(slash + 1)) };
  }
  const found = names.flatMap((name) => {
    try {
      return [{ root: join(library, name), note: openNote(join(library, name), id) }];
    } catch (error) {
      if (error instanceof KxError) return [];
      throw error;
    }
  });
  if (found.length === 1) return found[0];
  if (found.length) throw new KxError(`${id} is in more than one notebook. Name the notebook, like ${noteId(found[0].root, found[0].note.path)}.`);
  throw new KxError(`Note not found: ${id}`);
}
