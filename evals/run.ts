// Judgment evals for KnowledgeX: given a finished conversation, does an agent keep the right things?
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

// Compiled to dist/evals/run.js; the cases stay in the source folder.
const HERE = fileURLToPath(new URL("../../evals/", import.meta.url));
const ACTIONS = ["new", "update", "supersede", "contradict", "timeline"];
const NEEDS_TARGET = ["update", "supersede", "contradict", "timeline"];
const FIELDS = ["type", "title", "description", "content"];
// Distinctive phrases from the guide's own examples. A proposal that repeats one copied the guide instead of judging.
export const GUIDE_EXAMPLES = ["postgresql as the job queue", "production-like machines", "contracts longer than 12 months", "fewer moving parts"];

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
  category: string;
  summary: string;
  bundle?: { file: string; type: string; title: string; description: string }[];
  conversation: Record<string, string>[];
  expect?: Kernel[];
  optional?: Kernel[];
  avoid?: Kernel[];
  reference?: Proposal[];
}
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
  c.conversation.flatMap((turn) => Object.entries(turn).map(([role, text]) => `${role.toUpperCase()}: ${String(text).trim()}`)).join("\n\n");

export function promptFor(c: Case): string {
  const notes = (c.bundle ?? []).map((n) => `- ${n.file} (${n.type}): ${n.title}. ${n.description}`).join("\n") || "(The bundle is empty.)";
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

export function parseResponse(text: string): Proposal[] {
  if (text.startsWith("AGENT ERROR")) {
    throw new Error(text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2).join(": "));
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in the response");
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("the response is not valid JSON");
  }
  const proposals = (data as { proposals?: unknown })?.proposals;
  if (!Array.isArray(proposals)) throw new Error("the response has no `proposals` list");
  return proposals.filter((p): p is Proposal => typeof p === "object" && p !== null && !Array.isArray(p));
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

export function report(results: Result[], meta: Record<string, string>): string {
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

  const lines = [
    "# KnowledgeX judgment eval",
    "",
    `- Agent: \`${meta.agent ?? "unknown"}\``,
    `- Date: ${meta.date ?? "unknown"}`,
    `- KnowledgeX guide version: ${meta.knowledgex ?? kb.VERSION}`,
    "",
    "| Metric | Result | Meaning |",
    "|---|---|---|",
    `| Cases passed | ${passed}/${results.length} (${pct(passed, results.length)}) | Everything right: the expected notes, correct action and type, nothing extra, nothing transient |`,
    `| Recall | ${found.length}/${required.length} (${pct(found.length, required.length)}) | Expected notes the agent proposed |`,
    `| Precision | ${useful}/${proposals} (${pct(useful, proposals)}) | Proposals that were expected or acceptable |`,
    `| Stayed quiet | ${quietOk}/${quiet.length} (${pct(quietOk, quiet.length)}) | Cases with nothing required, where the agent proposed nothing unwanted |`,
    `| Transient leaks | ${leaks} in ${leakyCases} case(s) | Proposals containing things the guide says never to keep |`,
    `| Right action and type | ${right}/${found.length} (${pct(right, found.length)}) | Among expected notes found |`,
    `| Detail completeness | ${pct(completeness, found.length)} | Key details (reasons, reversal conditions, …) present in found notes |`,
    "",
    "| Case | Result | Notes |",
    "|---|---|---|",
  ];
  for (const r of results) {
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
    lines.push(`| ${r.id} | ${r.passed ? "pass" : "FAIL"} | ${notes.join("; ").replace(/\|/g, "/")} |`);
  }
  return `${lines.join("\n")}\n`;
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
    const absent = ["category", "summary", "conversation", "avoid", "reference"].filter((key) => !(key in c));
    if (absent.length) {
      problem(`missing ${absent.join(", ")}`);
      continue;
    }
    if (!c.conversation.every((turn) => typeof turn === "object" && Object.keys(turn).length === 1 && ["user", "assistant"].includes(Object.keys(turn)[0]))) {
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

    const reference = scoreCase(c, c.reference ?? []);
    if (!reference.passed) problem(`the reference answer fails:\n${report([reference], {}).trimEnd().split("\n").pop()}`);
    for (const entry of reference.required) {
      if (entry.missingDetails.length) problem(`the reference answer lacks details for \`${entry.id}\`: ${entry.missingDetails.join(", ")}`);
    }
    const dump = [{ action: "new", type: "Note", title: "Conversation notes", description: "", content: text }];
    if (scoreCase(c, dump).passed) problem("saving the whole transcript passes this case; tighten it");
  }
  return problems;
}

// --- commands -----------------------------------------------------------------------------------

/** Run one prompt through an agent command, which reads the prompt on stdin (or a file via {prompt_file}) and prints the reply. */
function runAgent(c: Case, command: string, out: string, timeoutSeconds: number): Promise<void> {
  const promptPath = join(out, `${c.id}.prompt.md`);
  writeFileSync(promptPath, promptFor(c));
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
    if (!existsSync(path)) return scoreCase(c, [], "no response file");
    try {
      return scoreCase(c, parseResponse(readFileSync(path, "utf8")));
    } catch (error) {
      return scoreCase(c, [], (error as Error).message);
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
      for (const c of cases) writeFileSync(join(folder, `${c.id}.prompt.md`), promptFor(c));
      console.log(`Wrote ${cases.length} prompts to ${folder}. Save each reply as <case>.response.txt, then run \`score\`.`);
      return 0;
    }
    case "run": {
      if (!values.agent) throw new kb.KxError('Usage: run --agent "<command that reads a prompt on stdin>"');
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
      const out = resolve(values.out ?? join(HERE, "results", `${stamp}-${values.agent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`));
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "meta.json"), `${JSON.stringify({ agent: values.agent, date: new Date().toISOString().slice(0, 16), knowledgex: kb.VERSION }, null, 2)}\n`);
      console.error(`Running ${cases.length} case(s) with \`${values.agent}\`…`);
      const queue = [...cases];
      const jobs = Math.max(1, Number.parseInt(values.jobs, 10) || 1);
      const timeout = Number.parseInt(values.timeout, 10) || 600;
      await Promise.all(Array.from({ length: jobs }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) await runAgent(c, values.agent!, out, timeout);
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
      console.log("Usage: pnpm evals <check | run --agent CMD [--case ID] [--jobs N] [--timeout S] | prompts FOLDER | score FOLDER>");
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
