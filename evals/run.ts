// Judgment evals for KnowledgeX: does an agent keep the right things, offer them at the right moment, and look before answering?
//
//   pnpm evals check                              validate the cases
//   pnpm evals run --agent "claude -p"            run every case through an agent, then score
//   pnpm evals prompts evals/results/manual       write prompts to paste into a chat app by hand
//   pnpm evals score evals/results/<run>          score saved responses
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import * as kb from "../src/bundle.js";
import { INSTRUCTIONS, READ_GUIDE, SAVE_NOTE } from "../src/mcp.js";

// Compiled to dist/evals/run.js; the cases stay in the source folder.
const HERE = fileURLToPath(new URL("../../evals/", import.meta.url));
const ACTIONS = ["new", "update", "supersede", "contradict", "timeline"];
const NEEDS_TARGET = ["update", "supersede", "contradict", "timeline"];
const FIELDS = ["type", "title", "description", "content"];
// Distinctive phrases from the guide's own examples. A proposal that repeats one copied the guide instead of judging.
export const GUIDE_EXAMPLES = ["postgresql as the job queue", "production-like machines", "contracts longer than 12 months", "fewer moving parts", "liability clauses before payment terms"];

// Retrieval cases ask a question the notes can answer, to see whether the agent looks before it answers.
const RETRIEVE_PROMPT = `You are an AI assistant that uses KnowledgeX, the user's knowledge library. Follow the guide below.

=== GUIDE ===
<<GUIDE>>
=== END GUIDE ===
<<REMINDER>>
You can call these tools:
- search_notes(query): search the user's notes. Returns each note's title, description, type, whether the user confirmed it, and whether it is out of date.
- read_note(file): read one note in full.

The user says:

=== USER ===
<<QUESTION>>
=== END USER ===

Decide what you would do, then reply with only a JSON object and no other text, in this shape:

{"tool_calls": [{"tool": "search_notes", "query": "<words>"}], "answer": "<what you would say to the user>"}

- List every tool call you would make, in order, in "tool_calls". Use an empty list if you would call none.
- Write the reply you would give the user, in "answer".
`;

// The line the README tells people to put in their assistant's standing instructions.
const REMINDER = `
The user's standing instructions say: "I use KnowledgeX as my knowledge library. Search it when my past decisions or preferences matter, and offer to save anything worth keeping when it comes up. Save only what I approve."
`;

// Offer cases stop mid-conversation, at the user's latest message, to see whether the agent offers to save
// something then, in one line at the end of its reply, and stays quiet when there is nothing to keep.
const OFFER_PROMPT = `You are an AI assistant connected to KnowledgeX, the user's knowledge library. The app gives you these instructions from KnowledgeX:

=== INSTRUCTIONS ===
<<INSTRUCTIONS>>
=== END INSTRUCTIONS ===

Among your tools:
- read_guide: <<READ_GUIDE>>
- save_note: <<SAVE_NOTE>>

You have already read these KnowledgeX guides:

=== GUIDE ===
<<GUIDE>>
=== END GUIDE ===
<<REMINDER>>
Here is the conversation so far. The user has just sent the last message, and it is your turn to reply:

=== CONVERSATION ===
<<CONVERSATION>>
=== END CONVERSATION ===

Write your next reply. Don't call any tools. Reply with only a JSON object and no other text, in this shape:

{"reply": "<everything you would say to the user, in full>"}
`;

const PROMPT = `You are an AI agent that uses KnowledgeX. Follow the guide below.

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
`;

type Spec = (string | string[])[];
interface Kernel {
  id: string;
  match: Spec;
  types?: string[];
  action?: string;
  target?: string;
  capture?: Record<string, Spec>;
  fields?: string[];
}
export interface Case {
  _file: string;
  id: string;
  kind?: "keep" | "retrieve" | "offer";
  category: string;
  summary: string;
  bundle?: { file: string; type: string; title: string; description: string; trust?: string; freshness?: string }[];
  question?: string;
  conversation?: Record<string, string>[];
  expect?: Kernel[];
  optional?: Kernel[];
  avoid?: Kernel[];
  reference?: Proposal[] | Reply;
}

/** What a retrieval case's agent replies: the calls it would make, and what it would tell the user. */
export interface Reply {
  tool_calls?: { tool?: string; query?: string; file?: string }[];
  answer?: string;
}

/** What an offer case's agent replies: everything it would say to the user. */
export interface Offer {
  reply?: string;
}

export const isRetrieve = (c: Case): boolean => c.kind === "retrieve";
export const isOffer = (c: Case): boolean => c.kind === "offer";
type Proposal = Record<string, unknown>;
interface Required {
  id: string;
  matched: boolean;
  actionOk: boolean;
  typeOk: boolean;
  completeness: number;
  missingDetails: string[];
}
export interface Result {
  id: string;
  kind?: "keep" | "retrieve" | "offer";
  searched?: boolean;
  offered?: boolean;
  passed: boolean;
  error: string;
  proposals: number;
  required: Required[];
  optional: string[];
  extras: string[];
  violations: string[];
}

// --- cases --------------------------------------------------------------------------------------

export function loadCases(ids?: string[]): Case[] {
  const folder = join(HERE, "cases");
  const cases = readdirSync(folder)
    .filter((name) => name.endsWith(".yaml"))
    .sort()
    .map((name) => ({ ...(parse(readFileSync(join(folder, name), "utf8")) ?? {}), _file: name }) as Case)
    .filter((c) => !ids?.length || ids.includes(c.id));
  const missing = (ids ?? []).filter((id) => !cases.some((c) => c.id === id));
  if (missing.length) throw new kb.KxError(`Unknown case(s): ${missing.join(", ")}`);
  return cases;
}

const transcript = (c: Case): string =>
  (c.conversation ?? []).flatMap((turn) => Object.entries(turn).map(([role, text]) => `${role.toUpperCase()}: ${String(text).trim()}`)).join("\n\n");

export function promptFor(c: Case, reminder = false): string {
  const notes =
    (c.bundle ?? [])
      .map((n) => `- ${n.file} (${n.type}): ${n.title}. ${n.description}${n.trust ? ` [${[n.trust, n.freshness].filter(Boolean).join(", ")}]` : ""}`)
      .join("\n") || "(The bundle is empty.)";
  if (isOffer(c)) {
    return OFFER_PROMPT.replace("<<INSTRUCTIONS>>", () => INSTRUCTIONS)
      .replace("<<READ_GUIDE>>", () => READ_GUIDE)
      .replace("<<SAVE_NOTE>>", () => SAVE_NOTE)
      .replace("<<GUIDE>>", () => `${kb.guideText("overview")}\n\n${kb.guideText("what")}`)
      .replace("<<REMINDER>>", () => (reminder ? REMINDER : ""))
      .replace("<<CONVERSATION>>", () => transcript(c));
  }
  if (isRetrieve(c)) {
    // The notes aren't in the prompt: finding them is what the case measures.
    return RETRIEVE_PROMPT.replace("<<GUIDE>>", () => `${kb.guideText("overview")}\n\n${kb.guideText("retrieve")}`)
      .replace("<<REMINDER>>", () => (reminder ? REMINDER : ""))
      .replace("<<QUESTION>>", () => String(c.question ?? "").trim());
  }
  const guide = `${kb.guideText("overview")}\n\n${kb.guideText("what")}`;
  return PROMPT.replace("<<GUIDE>>", () => guide).replace("<<NOTES>>", () => notes).replace("<<CONVERSATION>>", () => transcript(c));
}


// --- scoring ------------------------------------------------------------------------------------

/** `spec` is a list of groups; every group needs one of its terms in the text (case-insensitive substrings). */
// ponytail: keyword matching is reproducible and free but misses paraphrases; add an LLM judge if that bites.
export function hits(spec: Spec | undefined, text: string): boolean {
  const groups = (spec ?? []).map((g) => (typeof g === "string" ? [g] : g));
  const lower = text.toLowerCase();
  return groups.length > 0 && groups.every((group) => group.some((term) => lower.includes(String(term).toLowerCase())));
}

const textOf = (p: Proposal, fields = FIELDS): string => fields.map((f) => String(p[f] ?? "")).join(" ");
const actionOf = (p: Proposal): string => String(p.action || "new").trim().toLowerCase();

function jsonOf(text: string): unknown {
  if (text.startsWith("AGENT ERROR")) {
    throw new Error(text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2).join(": "));
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in the response");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("the response is not valid JSON");
  }
}

export function parseResponse(text: string): Proposal[] {
  const data = jsonOf(text);
  const proposals = (data as { proposals?: unknown })?.proposals;
  if (!Array.isArray(proposals)) throw new Error("the response has no `proposals` list");
  return proposals.filter((p): p is Proposal => typeof p === "object" && p !== null && !Array.isArray(p));
}

export function parseReply(text: string): Reply {
  const reply = jsonOf(text) as Reply;
  if (typeof reply?.answer !== "string") throw new Error("the response has no `answer`");
  return { tool_calls: Array.isArray(reply.tool_calls) ? reply.tool_calls : [], answer: reply.answer };
}

/**
 * Score a retrieval case: the notes were never in the prompt, so the agent has to look them up.
 * `expect` matches the lookup (its tool calls and queries); `avoid` matches the answer, catching facts
 * it could not know without reading a note.
 */
export function scoreRetrieve(c: Case, reply: Reply = {}, error = ""): Result {
  const calls = reply.tool_calls ?? [];
  const searched = calls.some((call) => String(call?.tool ?? "").toLowerCase().includes("search"));
  const lookup = calls.map((call) => [call?.tool, call?.query, call?.file].filter(Boolean).join(" ")).join("\n");
  const answer = String(reply.answer ?? "");
  const required = (c.expect ?? []).map((kernel) => ({
    id: kernel.id,
    matched: hits(kernel.match, lookup),
    actionOk: true,
    typeOk: true,
    completeness: 1,
    missingDetails: [] as string[],
  }));
  const violations = (c.avoid ?? []).filter((rule) => hits(rule.match, answer)).map((rule) => rule.id);
  const passed = !error && searched && required.every((e) => e.matched) && !violations.length;
  return { id: c.id, kind: "retrieve", searched, passed, error, proposals: calls.length, required, optional: [], extras: [], violations };
}

export function parseOffer(text: string): Offer {
  const data = jsonOf(text) as Offer;
  if (typeof data?.reply !== "string") throw new Error("the response has no `reply`");
  return { reply: data.reply };
}

// Words that ask to keep something. The offer is judged in the reply the user would see, not in anything the agent says about it.
// ponytail: a phrase list misses unusual wording and could catch an answer that says "save it"; add an LLM judge if that bites.
const OFFER_CUE = /worth keeping(?! in mind)|\bI'd (keep|note|save)\b|\bsave (it|this|that|these|them)\b|\b(shall|should|can) I (save|note|keep|remember)\b|\bwant me to (save|note|keep|remember)\b/i;

/** Where an offer starts in a reply: the first sentence that asks to keep something, or -1 when none does. */
export function offerStart(reply: string): number {
  for (const match of reply.matchAll(/[^.?!\n]+[.?!]*/g)) if (OFFER_CUE.test(match[0])) return match.index + match[0].search(/\S/);
  return -1;
}

/**
 * Score an offer case from the reply. The offer runs from its first sentence to the end of the reply.
 * `expect` matches what it should name; with no `expect`, any offer fails. `avoid` matches what it must not
 * hold, such as a repeated or transient item. It must be one line and the last thing in the reply, so the answer comes first.
 */
export function scoreOffer(c: Case, answer: Offer = {}, error = ""): Result {
  const said = String(answer.reply ?? "").trim();
  const start = offerStart(said);
  const offered = start >= 0;
  const offer = offered ? said.slice(start) : "";
  const required = (c.expect ?? []).map((kernel) => ({
    id: kernel.id,
    matched: offered && hits(kernel.match, offer),
    actionOk: true,
    typeOk: true,
    completeness: 1,
    missingDetails: [] as string[],
  }));
  // Naming what it would skip is what the guide asks for, so avoid rules only look at what it would keep.
  const kept = offer.replace(/\b(I'd |I would )?(skip|skipping|leave out|leaving out)\b[^.?!]*/gi, "");
  const violations = (c.avoid ?? []).filter((rule) => offered && hits(rule.match, kept)).map((rule) => rule.id);
  if (offered) {
    // The last sentence must still be asking; otherwise the answer carries on after the offer.
    const last = [...said.matchAll(/[^.?!\n]+[.?!]*/g)].map((m) => m[0]).filter((t) => t.trim()).pop() ?? "";
    if (!OFFER_CUE.test(last) && !/\?\s*["')*]*$/.test(last)) violations.push("offer-not-at-end");
    else if (offer.includes("\n")) violations.push("offer-not-one-line");
    if (GUIDE_EXAMPLES.some((phrase) => offer.toLowerCase().includes(phrase))) violations.push("copied-guide-example");
  }
  const extras = offered && !required.length ? [offer] : [];
  const passed = !error && !extras.length && !violations.length && required.every((e) => e.matched);
  return { id: c.id, kind: "offer", offered, passed, error, proposals: offered ? 1 : 0, required, optional: [], extras, violations };
}

export function scoreCase(c: Case, proposals: Proposal[] = [], error = ""): Result {
  const remaining = proposals.map((_, i) => i);
  const fit = (kernel: Kernel, p: Proposal): [boolean, boolean] => {
    const actionOk = actionOf(p) === (kernel.action ?? "new");
    const targetOk = !kernel.target || basename(String(p.target ?? "")) === kernel.target;
    const typeOk = !kernel.types?.length || kernel.types.includes(String(p.type));
    return [actionOk && targetOk, typeOk];
  };
  const take = (kernel: Kernel): number | undefined => {
    const candidates = remaining.filter((i) => hits(kernel.match, textOf(proposals[i])));
    if (!candidates.length) return undefined;
    const rank = (i: number) => fit(kernel, proposals[i]).reduce((score, ok, k) => score + (ok ? 2 - k : 0), 0);
    const best = candidates.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    remaining.splice(remaining.indexOf(best), 1);
    return best;
  };

  const required = (c.expect ?? []).map((kernel): Required => {
    const index = take(kernel);
    if (index === undefined) return { id: kernel.id, matched: false, actionOk: false, typeOk: false, completeness: 0, missingDetails: [] };
    const [actionOk, typeOk] = fit(kernel, proposals[index]);
    const capture = Object.entries(kernel.capture ?? {});
    const missingDetails = capture.filter(([, spec]) => !hits(spec, textOf(proposals[index]))).map(([name]) => name);
    return { id: kernel.id, matched: true, actionOk, typeOk, completeness: capture.length ? 1 - missingDetails.length / capture.length : 1, missingDetails };
  });
  const optional = (c.optional ?? []).filter((kernel) => take(kernel) !== undefined).map((kernel) => kernel.id);
  const extras = remaining.map((i) => String(proposals[i].title || "(untitled)"));
  const violations = (c.avoid ?? [])
    .filter((rule) => proposals.some((p) => hits(rule.match, textOf(p, rule.fields ?? FIELDS)) && (rule.action === undefined || actionOf(p) === rule.action)))
    .map((rule) => rule.id);
  if (proposals.some((p) => GUIDE_EXAMPLES.some((phrase) => textOf(p).toLowerCase().includes(phrase)))) violations.push("copied-guide-example");
  const passed = !error && !extras.length && !violations.length && required.every((e) => e.matched && e.actionOk && e.typeOk);
  return { id: c.id, passed, error, proposals: proposals.length, required, optional, extras, violations };
}

const pct = (part: number, whole: number): string => (whole ? `${Math.round((100 * part) / whole)}%` : "n/a");

export function report(allResults: Result[], meta: Record<string, string>): string {
  const results = allResults.filter((r) => !r.kind || r.kind === "keep");
  const lookups = allResults.filter((r) => r.kind === "retrieve");
  const offers = allResults.filter((r) => r.kind === "offer");
  const headed = [results, lookups, offers].filter((group) => group.length).length > 1;
  const table = (rows: string[]): string[] => ["| Metric | Result | Meaning |", "|---|---|---|", ...rows, ""];
  const cases = (rows: string[]): string[] => ["| Case | Result | Notes |", "|---|---|---|", ...rows, ""];
  const line = (r: Result, notes: string[]): string => `| ${r.id} | ${r.passed ? "pass" : "FAIL"} | ${notes.join("; ").replace(/\|/g, "/")} |`;

  const lines = [
    "# KnowledgeX judgment eval",
    "",
    `- Agent: \`${meta.agent ?? "unknown"}\``,
    `- Date: ${meta.date ?? "unknown"}`,
    `- KnowledgeX guide version: ${meta.knowledgex ?? kb.VERSION}`,
    ...(lookups.length ? [`- Standing-instruction reminder: ${String(meta.reminder) === "true" ? "on" : "off"}`] : []),
    "",
  ];

  if (lookups.length) {
    const looked = lookups.filter((r) => r.searched).length;
    const expected = lookups.flatMap((r) => r.required);
    const matched = expected.filter((e) => e.matched).length;
    const invented = lookups.filter((r) => r.violations.length).length;
    lines.push(
      ...(headed ? ["## Retrieval", ""] : []),
      ...table([
        `| Looked before answering | ${looked}/${lookups.length} (${pct(looked, lookups.length)}) | Questions where the agent searched the notes instead of answering from nothing |`,
        `| Searched for the right thing | ${matched}/${expected.length} (${pct(matched, expected.length)}) | Expected lookups the agent made |`,
        `| Answered from nowhere | ${invented} in ${lookups.length} case(s) | Answers stating specifics the agent could only get from a note it never read |`,
      ]),
      ...cases(
        lookups.map((r) => {
          const notes: string[] = [];
          if (r.error) notes.push(`error: ${r.error}`);
          if (!r.searched) notes.push("never searched");
          for (const e of r.required) if (!e.matched) notes.push(`missed \`${e.id}\``);
          if (r.violations.length) notes.push(`answered from nowhere: ${r.violations.join(", ")}`);
          return line(r, notes);
        }),
      ),
    );
  }

  if (results.length) {
    const required = results.flatMap((r) => r.required);
    const found = required.filter((e) => e.matched);
    const proposals = results.reduce((sum, r) => sum + r.proposals, 0);
    const useful = found.length + results.reduce((sum, r) => sum + r.optional.length, 0);
    const quiet = results.filter((r) => !r.required.length);
    const quietOk = quiet.filter((r) => !r.error && !r.extras.length && !r.violations.length).length;
    const leaks = results.reduce((sum, r) => sum + r.violations.length, 0);
    const leakyCases = results.filter((r) => r.violations.length).length;
    const right = found.filter((e) => e.actionOk && e.typeOk).length;
    const completeness = found.reduce((sum, e) => sum + e.completeness, 0);
    const passed = results.filter((r) => r.passed).length;
    lines.push(
      ...(headed ? ["## What to keep", ""] : []),
      ...table([
        `| Cases passed | ${passed}/${results.length} (${pct(passed, results.length)}) | Everything right: the expected notes, correct action and type, nothing extra, nothing transient |`,
        `| Recall | ${found.length}/${required.length} (${pct(found.length, required.length)}) | Expected notes the agent proposed |`,
        `| Precision | ${useful}/${proposals} (${pct(useful, proposals)}) | Proposals that were expected or acceptable |`,
        `| Stayed quiet | ${quietOk}/${quiet.length} (${pct(quietOk, quiet.length)}) | Cases with nothing required, where the agent proposed nothing unwanted |`,
        `| Transient leaks | ${leaks} in ${leakyCases} case(s) | Proposals containing things the guide says never to keep |`,
        `| Right action and type | ${right}/${found.length} (${pct(right, found.length)}) | Among expected notes found |`,
        `| Detail completeness | ${pct(completeness, found.length)} | Key details (reasons, reversal conditions, …) present in found notes |`,
      ]),
      ...cases(
        results.map((r) => {
          const notes: string[] = [];
          if (r.error) notes.push(`error: ${r.error}`);
          for (const e of r.required) {
            if (!e.matched) {
              notes.push(`missed \`${e.id}\``);
              continue;
            }
            if (!e.actionOk) notes.push(`\`${e.id}\`: wrong action or target`);
            if (!e.typeOk) notes.push(`\`${e.id}\`: wrong type`);
            if (e.missingDetails.length) notes.push(`\`${e.id}\` lacks ${e.missingDetails.join(", ")}`);
          }
          if (r.extras.length) notes.push(`extra: ${r.extras.join("; ")}`);
          if (r.violations.length) notes.push(`kept transient: ${r.violations.join(", ")}`);
          return line(r, notes);
        }),
      ),
    );
  }
  if (offers.length) {
    const due = offers.filter((r) => r.required.length);
    const quiet = offers.filter((r) => !r.required.length);
    const onTime = due.filter((r) => r.required.every((e) => e.matched)).length;
    const quietOk = quiet.filter((r) => !r.error && !r.offered).length;
    const broken = offers.filter((r) => r.violations.length).length;
    lines.push(
      ...(headed ? ["## Offering to keep", ""] : []),
      ...table([
        `| Offered at the right moment | ${onTime}/${due.length} (${pct(onTime, due.length)}) | Turns where something worth keeping settled, and the agent offered it |`,
        `| Stayed quiet | ${quietOk}/${quiet.length} (${pct(quietOk, quiet.length)}) | Turns with nothing new to offer, where the agent offered nothing |`,
        `| Offers that broke a rule | ${broken} in ${offers.length} case(s) | Not one line, not at the end of the reply, repeated, or holding something not worth keeping |`,
      ]),
      ...cases(
        offers.map((r) => {
          const notes: string[] = [];
          if (r.error) notes.push(`error: ${r.error}`);
          for (const e of r.required) if (!e.matched) notes.push(r.offered ? `offer missed \`${e.id}\`` : "no offer");
          if (r.extras.length) notes.push(`offered when it shouldn't: ${r.extras.join("; ")}`);
          if (r.violations.length) notes.push(`broke: ${r.violations.join(", ")}`);
          return line(r, notes);
        }),
      ),
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// --- validation ---------------------------------------------------------------------------------

export function checkCases(cases: Case[]): string[] {
  const problems: string[] = [];
  const guide = `${kb.guideText("overview")}${kb.guideText("what")}`.toLowerCase();
  for (const phrase of GUIDE_EXAMPLES) if (!guide.includes(phrase)) problems.push(`GUIDE_EXAMPLES phrase no longer in the guide: "${phrase}"`);
  const seen = new Set<string>();

  for (const c of cases) {
    const problem = (message: string) => problems.push(`${c._file}: ${message}`);
    if (!c.id || seen.has(c.id)) {
      problem("missing or duplicate `id`");
      continue;
    }
    seen.add(c.id);
    if (c._file !== `${c.id}.yaml`) problem("file name must be <id>.yaml");
    if (isOffer(c)) {
      problems.push(...checkOfferCase(c).map((message) => `${c._file}: ${message}`));
      continue;
    }
    const needed = isRetrieve(c) ? ["category", "summary", "question", "bundle", "expect", "avoid", "reference"] : ["category", "summary", "conversation", "avoid", "reference"];
    const absent = needed.filter((key) => !(key in c));
    if (absent.length) {
      problem(`missing ${absent.join(", ")}`);
      continue;
    }
    if (isRetrieve(c)) {
      problems.push(...checkRetrieveCase(c).map((message) => `${c._file}: ${message}`));
      continue;
    }
    if (!(c.conversation ?? []).every((turn) => typeof turn === "object" && Object.keys(turn).length === 1 && ["user", "assistant"].includes(Object.keys(turn)[0]))) {
      problem("each conversation turn must be `user: ...` or `assistant: ...`");
    }
    const files = new Set<string>();
    for (const note of c.bundle ?? []) {
      if (!(note.file && note.type && note.title && note.description)) problem("bundle notes need file, type, title, and description");
      files.add(note.file);
    }

    const kernelIds = new Set<string>();
    for (const section of ["expect", "optional", "avoid"] as const) {
      for (const kernel of c[section] ?? []) {
        const label = `${section} \`${kernel.id}\``;
        if (!kernel.id || kernelIds.has(kernel.id)) problem(`${label}: missing or duplicate id`);
        kernelIds.add(kernel.id);
        if (!kernel.match?.length) problem(`${label}: needs \`match\``);
        const action = kernel.action ?? "new";
        if (!ACTIONS.includes(action)) problem(`${label}: unknown action \`${action}\``);
        if (section !== "avoid" && NEEDS_TARGET.includes(action) && !files.has(kernel.target ?? "")) {
          problem(`${label}: \`${action}\` needs a \`target\` from the case's bundle`);
        }
        const unknown = (kernel.types ?? []).filter((type) => !kb.isType(type));
        if (unknown.length) problem(`${label}: unknown types ${unknown.join(", ")}`);
      }
    }

    const text = transcript(c);
    for (const phrase of GUIDE_EXAMPLES) {
      if (text.toLowerCase().includes(phrase)) problem(`reuses the guide's own example ("${phrase}"); write a fresh scenario`);
    }
    for (const rule of c.avoid ?? []) {
      if (rule.action === undefined && !hits(rule.match, text)) problem(`avoid \`${rule.id}\` never appears in the conversation, so it tests nothing`);
    }
    if (!(c.avoid ?? []).some((rule) => rule.action === undefined)) problem("add at least one avoid rule for transient content in the conversation");

    const reference = scoreCase(c, (c.reference as Proposal[]) ?? []);
    if (!reference.passed) problem(`the reference answer fails:\n${report([reference], {}).trimEnd().split("\n").pop()}`);
    for (const entry of reference.required) {
      if (entry.missingDetails.length) problem(`the reference answer lacks details for \`${entry.id}\`: ${entry.missingDetails.join(", ")}`);
    }
    const dump = [{ action: "new", type: "Note", title: "Conversation notes", description: "", content: text }];
    if (scoreCase(c, dump).passed) problem("saving the whole transcript passes this case; tighten it");
  }
  return problems;
}

/** An offer case is sound when it stops on a user turn, its reference passes, and the wrong call (offering or staying quiet) fails. */
function checkOfferCase(c: Case): string[] {
  const problems: string[] = [];
  const absent = ["category", "summary", "conversation", "reference"].filter((key) => !(key in c));
  if (absent.length) return [`missing ${absent.join(", ")}`];
  const turns = c.conversation ?? [];
  if (!turns.every((turn) => typeof turn === "object" && Object.keys(turn).length === 1 && ["user", "assistant"].includes(Object.keys(turn)[0]))) {
    problems.push("each conversation turn must be `user: ...` or `assistant: ...`");
  }
  if (Object.keys(turns.at(-1) ?? {})[0] !== "user") problems.push("the conversation must end with a user turn: the agent writes the next reply");
  const reference = c.reference as Offer;
  if (typeof reference?.reply !== "string") return [...problems, "an offer case's `reference` needs a `reply`"];
  const ids = new Set<string>();
  for (const section of ["expect", "avoid"] as const) {
    for (const kernel of c[section] ?? []) {
      const label = `${section} \`${kernel.id}\``;
      if (!kernel.id || ids.has(kernel.id)) problems.push(`${label}: missing or duplicate id`);
      ids.add(kernel.id);
      if (!kernel.match?.length) problems.push(`${label}: needs \`match\``);
    }
  }
  const text = transcript(c).toLowerCase();
  for (const phrase of GUIDE_EXAMPLES) if (text.includes(phrase)) problems.push(`reuses the guide's own example ("${phrase}"); write a fresh scenario`);
  const scored = scoreOffer(c, reference);
  if (!scored.passed) problems.push(`the reference reply fails:\n${report([scored], {}).trimEnd().split("\n").pop()}`);
  // When an offer is due, the same reply without it must fail. (With none due, any offer already fails.)
  const start = offerStart(reference.reply);
  if ((c.expect ?? []).length && start >= 0 && scoreOffer(c, { reply: reference.reply.slice(0, start) }).passed) {
    problems.push("the reply without its offer passes this case; tighten it");
  }
  return problems;
}

/** A retrieval case is sound when its reference reply passes and an answer given without looking fails. */
function checkRetrieveCase(c: Case): string[] {
  const problems: string[] = [];
  const reference = c.reference as Reply;
  if (!reference || typeof reference.answer !== "string" || !Array.isArray(reference.tool_calls)) {
    return ["a retrieval case's `reference` needs `tool_calls` and `answer`"];
  }
  const ids = new Set<string>();
  for (const section of ["expect", "avoid"] as const) {
    for (const kernel of c[section] ?? []) {
      const label = `${section} \`${kernel.id}\``;
      if (!kernel.id || ids.has(kernel.id)) problems.push(`${label}: missing or duplicate id`);
      ids.add(kernel.id);
      if (!kernel.match?.length) problems.push(`${label}: needs \`match\``);
    }
  }
  if (!(c.expect ?? []).length) problems.push("needs at least one `expect` rule for the lookup the agent should make");
  if (!(c.avoid ?? []).length) problems.push("needs at least one `avoid` rule for facts the agent could only get from a note");
  const scored = scoreRetrieve(c, reference);
  if (!scored.passed) {
    problems.push(`the reference reply fails:\n${report([scored], {}).trimEnd().split("\n").pop()}`);
  }
  // Answering straight from the model, with no lookup, must fail: that is what the case measures.
  const guessed: Reply = { tool_calls: [], answer: (c.avoid ?? []).flatMap((rule) => rule.match.flat()).join(" ") };
  if (scoreRetrieve(c, guessed).passed) problems.push("answering without looking passes this case; tighten it");
  return problems;
}

// --- commands -----------------------------------------------------------------------------------

/** Run one prompt through an agent command, which reads the prompt on stdin (or a file via {prompt_file}) and prints the reply. */
function runAgent(c: Case, command: string, out: string, timeoutSeconds: number, reminder = false): Promise<void> {
  const promptPath = join(out, `${c.id}.prompt.md`);
  writeFileSync(promptPath, promptFor(c, reminder));
  const usesFile = command.includes("{prompt_file}");
  const child = spawn(usesFile ? command.replaceAll("{prompt_file}", JSON.stringify(promptPath)) : command, {
    shell: true,
    stdio: [usesFile ? "ignore" : "pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (chunk) => (stdout += chunk));
  child.stderr!.on("data", (chunk) => (stderr += chunk));
  child.stdin?.on("error", () => {}); // an agent that exits early closes its input; the exit code reports the failure
  child.stdin?.end(readFileSync(promptPath, "utf8"));
  const timer = setTimeout(() => child.kill(), timeoutSeconds * 1000);
  return new Promise((done) => {
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const text = signal ? `AGENT ERROR (timed out after ${timeoutSeconds}s)` : code === 0 ? stdout : `AGENT ERROR (exit ${code})\n${stderr}\n${stdout}`;
      writeFileSync(join(out, `${c.id}.response.txt`), text);
      console.error(`  ${c.id}`);
      done();
    });
  });
}

export function scoreDir(out: string, cases: Case[]): string {
  const results = cases.map((c) => {
    const path = join(out, `${c.id}.response.txt`);
    const score = (text?: string, error = "") =>
      isOffer(c)
        ? scoreOffer(c, text === undefined ? {} : parseOffer(text), error)
        : isRetrieve(c)
          ? scoreRetrieve(c, text === undefined ? {} : parseReply(text), error)
          : scoreCase(c, text === undefined ? [] : parseResponse(text), error);
    if (!existsSync(path)) return score(undefined, "no response file");
    try {
      return score(readFileSync(path, "utf8"));
    } catch (error) {
      return score(undefined, (error as Error).message);
    }
  });
  const metaPath = join(out, "meta.json");
  const text = report(results, existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {});
  writeFileSync(join(out, "report.md"), text);
  return text;
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    // `npm run evals -- run ...` strips the `--`, but pnpm and yarn pass it through, which would turn every option into a plain argument.
    args: argv[0] === "--" ? argv.slice(1) : argv,
    allowPositionals: true,
    options: {
      agent: { type: "string" },
      out: { type: "string" },
      case: { type: "string", multiple: true },
      jobs: { type: "string", default: "4" },
      reminder: { type: "boolean" }, // retrieval and offer cases only: add the standing-instruction line the README suggests
      timeout: { type: "string", default: "600" },
    },
  });
  const [command, folder] = positionals;
  const cases = loadCases(values.case);

  switch (command) {
    case "check": {
      const problems = checkCases(cases);
      console.log(problems.join("\n") || `${cases.length} cases OK`);
      return problems.length ? 1 : 0;
    }
    case "prompts": {
      if (!folder) throw new kb.KxError("Usage: prompts <folder>");
      mkdirSync(folder, { recursive: true });
      for (const c of cases) writeFileSync(join(folder, `${c.id}.prompt.md`), promptFor(c, values.reminder));
      console.log(`Wrote ${cases.length} prompts to ${folder}. Save each reply as <case>.response.txt, then run \`score\`.`);
      return 0;
    }
    case "run": {
      if (!values.agent) throw new kb.KxError('Usage: run --agent "<command that reads a prompt on stdin>"');
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
      const out = resolve(values.out ?? join(HERE, "results", `${stamp}-${values.agent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`));
      mkdirSync(out, { recursive: true });
      writeFileSync(
        join(out, "meta.json"),
        `${JSON.stringify({ agent: values.agent, date: new Date().toISOString().slice(0, 16), knowledgex: kb.VERSION, reminder: Boolean(values.reminder) }, null, 2)}\n`,
      );
      console.error(`Running ${cases.length} case(s) with \`${values.agent}\`…`);
      const queue = [...cases];
      const jobs = Math.max(1, Number.parseInt(values.jobs, 10) || 1);
      const timeout = Number.parseInt(values.timeout, 10) || 600;
      await Promise.all(Array.from({ length: jobs }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) await runAgent(c, values.agent!, out, timeout, values.reminder);
      }));
      console.log(scoreDir(out, cases));
      return 0;
    }
    case "score": {
      if (!folder) throw new kb.KxError("Usage: score <results folder>");
      console.log(scoreDir(folder, cases));
      return 0;
    }
    default:
      console.log("Usage: pnpm evals <check | run --agent CMD [--case ID] [--jobs N] [--timeout S] [--reminder] | prompts FOLDER | score FOLDER>");
      return command ? 1 : 0;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (error) => {
      if (!(error instanceof kb.KxError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS"))) throw error;
      console.error((error as Error).message);
      process.exitCode = 1;
    },
  );
}
