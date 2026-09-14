// End-to-end checks for the kx command line, the core library, and the MCP server. Run with: pnpm test
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as kb from "../src/bundle.js";
import { main } from "../src/cli.js";
import { createServer } from "../src/mcp.js";
import { checkCases, loadCases, main as evalsMain } from "../evals/run.js";

const AGENT = "test-agent/1.0";

function kx(...args: string[]): { code: number; out: string } {
  const lines: string[] = [];
  try {
    return { code: main(args, (text) => lines.push(text)), out: lines.join("\n") };
  } catch (error) {
    if (!(error instanceof kb.KxError)) throw error;
    return { code: 1, out: `${lines.join("\n")}\n${error.message}` };
  }
}

function tempDir(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "kx-test-"));
  const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, KX_BUNDLE: process.env.KX_BUNDLE, KX_NOTEBOOK: process.env.KX_NOTEBOOK };
  process.env.XDG_CONFIG_HOME = join(dir, "config");
  delete process.env.KX_BUNDLE;
  delete process.env.KX_NOTEBOOK;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  });
  return dir;
}

test("helpers", () => {
  assert.equal(kb.slugify("Café — Q3 Plan!"), "cafe-q3-plan");
  assert.equal(kb.addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(kb.parseTime("2026-01-02T00:00:00")?.toISOString(), "2026-01-02T00:00:00.000Z"); // no zone means UTC
  assert.equal(kb.parseTime("not a date"), null);
  const meta: kb.Meta = {
    generated: { by: AGENT, at: "2026-01-02T00:00:00Z" },
    verified: [{ by: "human:alex", at: "2026-01-01T00:00:00Z" }],
  };
  assert.equal(kb.trust(meta), "unverified"); // content changed after the human check
  meta.verified.push({ by: AGENT, at: "2026-01-03T00:00:00Z" });
  assert.equal(kb.trust(meta), "machine-confirmed");
  assert.equal(kb.trust({ verified: { by: "human:alex", at: "2026-01-01" } }), "human-reviewed");
});

test("regressions from code review", (t) => {
  const root = join(tempDir(t), "notes");
  kb.ensureBundle(root);

  // An edit in the same second as a confirmation must still need confirming again, and a re-confirmation must count.
  const note = kb.createNote(root, { type: "Preference", title: "Style", description: "d", body: "- one\n", by: AGENT });
  kb.verifyNote(root, note, "human:alex");
  kb.updateNote(root, kb.openNote(root, "style.md"), { body: "- one\n- unconfirmed addition\n" }, AGENT);
  assert.equal(kb.trust(kb.openNote(root, "style.md").meta), "unverified");
  assert.equal(kb.verifyNote(root, kb.openNote(root, "style.md"), "human:alex"), "human-reviewed");

  // Titles in other scripts get distinct, stable, portable file names.
  const first = kb.slugify("契約レビューの順序");
  assert.match(first, /^note-[0-9a-f]{8}$/);
  assert.notEqual(first, kb.slugify("顧客への連絡方法"));
  assert.equal(first, kb.slugify("契約レビューの順序"));
  assert.match(kb.slugify("Q3 計画"), /^q3-[0-9a-f]{8}$/);
  kb.createNote(root, { type: "Lesson", title: "契約レビューの順序", description: "d", body: "x", by: AGENT });
  kb.createNote(root, { type: "Lesson", title: "顧客への連絡方法", description: "d", body: "y", by: AGENT });

  // Only the top level is read, so an unreadable or unrelated subfolder can't break the bundle.
  mkdirSync(join(root, "private"), { mode: 0o000 });
  try {
    assert.equal(kb.loadNotes(root).length, 3);
    assert.equal(kx("check", "--bundle", root).code, 0);
  } finally {
    chmodSync(join(root, "private"), 0o755);
  }

  // Built-in object keys are not note types or guide topics.
  assert.equal(kb.isType("constructor"), false);
  kb.createNote(root, { type: "constructor", title: "Proto", description: "d", body: "x", by: AGENT });
  assert.equal(kx("guide", "constructor").code, 1);
});

test("eval cases are valid", async () => {
  assert.deepEqual(checkCases(loadCases()), []);
  // pnpm passes the `--` from `pnpm run evals -- check` through to the script.
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(await evalsMain(["--", "check"]), 0);
  } finally {
    console.log = log;
  }
});

test("the code and the guides agree", () => {
  const guideTypes = [...kb.guideText("write").matchAll(/^\| `([A-Z]\w+)` \| .+ \| (Never|\d+ months)/gm)];
  assert.deepEqual(guideTypes.map((m) => m[1]), Object.keys(kb.TYPES), "type names and order");
  assert.deepEqual(guideTypes.map((m) => (m[2] === "Never" ? null : Number.parseInt(m[2]))), Object.values(kb.TYPES), "expiry months");
  const manifest = JSON.parse(readFileSync(new URL("../../manifest.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, kb.VERSION);
  assert.equal(pkg.version, kb.VERSION);
});

test("command-line workflow", (t) => {
  const dir = tempDir(t);
  const library = join(dir, "library");
  assert.equal(kx("init", library).code, 0);
  const root = join(library, "general");
  assert.match(readFileSync(join(root, "index.md"), "utf8"), /okf_version: "0.2"/);
  assert.match(readFileSync(join(library, "index.md"), "utf8"), /\* \[general\]\(general\/\)/);

  let result = kx("new", "Decision", "Use PostgreSQL as the job queue", "--description", "Jobs live in PostgreSQL until volume needs a dedicated queue.", "--by", AGENT);
  const old = result.out.trim();
  assert.equal(result.code, 0);
  assert.equal(basename(old), "use-postgresql-as-the-job-queue.md");
  assert.equal(kb.readNote(old).meta.stale_after, undefined); // decisions don't expire
  assert.match(readFileSync(old, "utf8"), new RegExp(`generated:\\n  by: ${AGENT}\\n  at: 20`)); // timestamps stay plain strings

  result = kx("check");
  assert.equal(result.code, 0);
  assert.match(result.out, /template hints/); // fresh templates warn but don't fail

  result = kx("new", "Entity", "Acme Payments API", "--description", "The payment provider behind checkout.", "--by", AGENT, "--source", "acme-docs=https://docs.example.com");
  const entity = result.out.trim();
  assert.match(kb.readNote(entity).meta.stale_after, /T00:00:00Z$/);
  assert.equal(kx("verify", basename(entity), "--by", "human:alex").code, 0);
  assert.equal(kb.trust(kb.readNote(entity).meta), "human-reviewed");
  assert.notEqual(kx("verify", basename(entity), "--by", "not an actor").code, 0);

  const newer = kx("new", "Decision", "Use a dedicated job queue", "--description", "Jobs move to a dedicated queue service.", "--by", AGENT).out.trim();
  assert.equal(kx("relate", basename(newer), "supersedes", basename(old), "--by", AGENT).code, 0);
  assert.equal(kb.readNote(old).meta.status, "deprecated");
  assert.match(readFileSync(old, "utf8"), /\(use-a-dedicated-job-queue\.md\)/);
  assert.match(readFileSync(newer, "utf8"), /\(use-postgresql-as-the-job-queue\.md\)/);

  result = kx("search", "job", "queue");
  assert.ok(result.out.includes(basename(newer)) && !result.out.includes(basename(old)));
  result = kx("search", "postgresql", "--all");
  assert.match(result.out, /superseded by: use-a-dedicated-job-queue\.md/);
  assert.equal(kx("check").code, 0);

  writeFileSync(join(root, "Bad Note.md"), "---\ntitle: x\n---\nSee [[Other]]. As we discussed today.\n");
  result = kx("check");
  assert.equal(result.code, 1);
  for (const expected of ["missing `type`", "wikilinks", "chat transcript"]) assert.ok(result.out.includes(expected), expected);
  unlinkSync(join(root, "Bad Note.md"));

  const note = kb.readNote(entity);
  note.meta.stale_after = "2000-01-01T00:00:00Z";
  kb.writeNote(note);
  result = kx("review");
  assert.ok(result.out.includes("## Stale") && result.out.includes(basename(entity)));
  assert.match(readFileSync(join(root, "log.md"), "utf8"), /\*\*Supersession\*\*/);

  const skills = join(dir, "skills");
  assert.equal(kx("install-skill", skills).code, 0);
  assert.ok(readFileSync(join(skills, "knowledgex", "SKILL.md"), "utf8").startsWith("---\nname: knowledgex"));
  assert.ok(existsSync(join(skills, "knowledgex", "references", "what-to-write.md")));
});

test("MCP server", async (t) => {
  const library = join(tempDir(t), "notes");
  const root = join(library, "general");
  const server = createServer(library, "Alex Doe");
  const client = new Client({ name: "test-app", version: "2.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(() => client.close());
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: result.content.map((c) => c.text).join("\n"), isError: Boolean(result.isError) };
  };

  assert.ok(existsSync(join(root, "index.md")), "the notes folder is created on first run");
  assert.match(client.getInstructions() ?? "", /long-term memory/);
  const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(tools, ["check_up", "confirm_note", "link_notes", "list_notebooks", "read_guide", "read_note", "save_note", "search_notes", "update_note"]);
  assert.match((await call("read_guide", { topic: "what" })).text, /five gates/i);

  const body = "_Chosen in 2026 while volume was low._\n\n## Decision\n- Keep background jobs in PostgreSQL.\n";
  let result = await call("save_note", { type: "Decision", title: "Keep jobs in PostgreSQL", description: "Background jobs stay in PostgreSQL for now.", body });
  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /general\/keep-jobs-in-postgresql\.md/);
  const file = "general/keep-jobs-in-postgresql.md";
  assert.equal(kb.readNote(join(library, file)).meta.generated.by, "test-app/2.0", "authorship comes from the connected app");

  result = await call("update_note", { file, change_summary: "rewrite", body: "Something else" });
  assert.ok(result.isError && /never edited/.test(result.text), "decisions can't be edited");

  result = await call("confirm_note", { file, confirmed_by_user: true });
  assert.match(result.text, /human-reviewed/);
  assert.equal(kb.readNote(join(library, file)).meta.verified[0].by, "human:alex-doe");

  await call("save_note", { type: "Decision", title: "Move jobs to a queue service", description: "Background jobs move to a dedicated queue.", body: "## Decision\n- Use a queue service.\n" });
  result = await call("link_notes", { file: "move-jobs-to-a-queue-service.md", relation: "supersedes", target: file }); // a file name alone works when only one notebook has it
  assert.equal(result.isError, false, result.text);
  result = await call("search_notes", { query: "jobs" });
  assert.ok(result.text.includes("move-jobs-to-a-queue-service.md") && !result.text.includes(file));
  assert.match((await call("read_note", { file })).text, /replaced by: general\/move-jobs-to-a-queue-service\.md/);

  await call("save_note", { type: "Preference", title: "Writing style", description: "House style for documents.", body: "## Preference\n- Sentence case headings.\n" });
  result = await call("update_note", { file: "writing-style.md", change_summary: "added a rule", body: "## Preference\n- Sentence case headings.\n- No exclamation marks.\n" });
  assert.equal(result.isError, false, result.text);
  assert.match(readFileSync(join(root, "writing-style.md"), "utf8"), /No exclamation marks/);

  assert.match((await call("check_up")).text, /Never checked|Never verified/);
  assert.ok((await call("read_note", { file: "../outside.md" })).isError, "paths outside the notes folder are refused");
  assert.equal(kx("check", "--bundle", root).code, 0, "notes saved through the server pass validation");

  // A notebook starts only when asked to, so a typo can't create one.
  const draft = { type: "Person", title: "Dana Lee", description: "Contact at Acme.", body: "## Who\n- Legal counsel at Acme.\n" };
  result = await call("save_note", { ...draft, notebook: "acme-cse" });
  assert.ok(result.isError && /create_notebook/.test(result.text));
  result = await call("save_note", { ...draft, notebook: "acme-case", create_notebook: true });
  assert.match(result.text, /Saved acme-case\/dana-lee\.md/);
  assert.match((await call("search_notes", { query: "acme" })).text, /acme-case\/dana-lee\.md/);
  assert.ok(!(await call("search_notes", { query: "acme", notebook: "general" })).text.includes("dana-lee"));
  assert.match((await call("list_notebooks")).text, /acme-case: 1 note \(mostly Person\)\ngeneral: /);
  result = await call("link_notes", { file: "acme-case/dana-lee.md", relation: "contradicts", target: "general/writing-style.md" });
  assert.ok(result.isError && /different notebooks/.test(result.text));

  // KX_NOTEBOOK limits a connection to one notebook.
  const locked = createServer(library, "Alex Doe", "acme-case");
  const lockedClient = new Client({ name: "test-app", version: "2.0" });
  const [c2, s2] = InMemoryTransport.createLinkedPair();
  await Promise.all([locked.connect(s2), lockedClient.connect(c2)]);
  t.after(() => lockedClient.close());
  const found = (await lockedClient.callTool({ name: "search_notes", arguments: {} })) as { content: { text: string }[] };
  assert.ok(found.content[0].text.includes("acme-case/dana-lee.md") && !found.content[0].text.includes("general/"));
  const refused = (await lockedClient.callTool({ name: "read_note", arguments: { file: "general/writing-style.md" } })) as { isError?: boolean };
  assert.ok(refused.isError, "other notebooks are out of reach");
});

test("notebooks", (t) => {
  const dir = tempDir(t);

  // A v0.2 notes folder becomes the general notebook and keeps the user's own confirmations.
  const library = join(dir, "notes");
  kb.ensureBundle(library);
  const mine = kb.createNote(library, { type: "Preference", title: "Style", description: "d", body: "- one\n", by: AGENT });
  kb.verifyNote(library, mine, "human:alex");
  kb.createNotebook(library, "early"); // before anything else opened the folder as a library
  assert.deepEqual(kb.openLibrary(library), ["early", "general"]);
  rmSync(join(library, "early"), { recursive: true });
  assert.deepEqual(kb.openLibrary(library), ["general"]);
  const general = join(library, "general");
  assert.equal(kb.trust(kb.openNote(general, "style.md").meta, kb.localChecks(general, kb.openNote(general, "style.md"))), "human-reviewed");
  assert.ok(!existsSync(join(library, "style.md")) && existsSync(join(library, ".knowledgex.json")));
  assert.match(readFileSync(join(general, "log.md"), "utf8"), /general notebook/);

  // Someone's bundle, with their own confirmation on it.
  const theirs = join(dir, "from-sam");
  kb.ensureBundle(theirs);
  const playbook = kb.createNote(theirs, { type: "Playbook", title: "Contract review", description: "d", body: "## Steps\n- Liability first.\n", by: AGENT });
  kb.verifyNote(theirs, playbook, "human:sam");
  assert.equal(kb.trust(kb.openNote(theirs, "contract-review.md").meta, kb.localChecks(theirs, playbook)), "human-reviewed", "outside a library, checks count");

  // Copied in, trust doesn't travel: the note needs confirming here.
  process.env.KX_BUNDLE = library;
  assert.equal(kx("add", theirs).code, 0);
  const received = join(library, "from-sam");
  const copy = () => kb.openNote(received, "contract-review.md");
  assert.equal(kb.trust(copy().meta, kb.localChecks(received, copy())), "unverified");
  assert.ok(kb.review(received).has("Confirmed in another copy, not in this library"));
  assert.match(kx("notebooks").out, /from-sam: 1 note \(mostly Playbook\); received \d{4}-/);
  assert.equal(kx("add", theirs).code, 1, "a taken name is refused");
  assert.equal(kx("verify", "contract-review.md", "--notebook", "from-sam", "--by", "human:alex").code, 0);
  assert.equal(kb.trust(copy().meta, kb.localChecks(received, copy())), "human-reviewed");

  // A folder dropped in by hand is picked up and starts unconfirmed too, even under a name the library knew.
  rmSync(received, { recursive: true });
  assert.deepEqual(kb.openLibrary(library), ["general"]);
  cpSync(theirs, received, { recursive: true });
  assert.deepEqual(kb.openLibrary(library), ["from-sam", "general"]);
  assert.equal(kb.trust(copy().meta, kb.localChecks(received, copy())), "unverified");

  // A lost record fails safe: nothing counts until confirmed again.
  unlinkSync(join(library, ".knowledgex.json"));
  kb.openLibrary(library);
  const style = kb.openNote(general, "style.md");
  assert.equal(kb.trust(style.meta, kb.localChecks(general, style)), "unverified");

  // A folder with other files gets a library inside it; a library or an empty folder is used as it is.
  const busy = join(dir, "Documents");
  mkdirSync(busy);
  writeFileSync(join(busy, "taxes.pdf"), "");
  assert.equal(kb.libraryFor(busy), join(busy, "KnowledgeX"));
  assert.equal(kb.libraryFor(library), library);
  assert.equal(kb.libraryFor(join(dir, "new")), join(dir, "new"));
  assert.equal(kx("notebooks", "create", "Bad Name").code, 1);
  assert.equal(kx("new", "Idea", "x", "--description", "d", "--by", AGENT, "--notebook", "missing").code, 1);
});
