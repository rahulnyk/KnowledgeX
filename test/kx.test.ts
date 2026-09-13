// End-to-end checks for the kx command line, the core library, and the MCP server. Run with: npm test
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as kb from "../src/bundle.js";
import { main } from "../src/cli.js";
import { createServer } from "../src/mcp.js";
import { checkCases, loadCases } from "../evals/run.js";

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
  const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, KX_BUNDLE: process.env.KX_BUNDLE };
  process.env.XDG_CONFIG_HOME = join(dir, "config");
  delete process.env.KX_BUNDLE;
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

test("eval cases are valid", () => {
  assert.deepEqual(checkCases(loadCases()), []);
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
  const root = join(dir, "bundle");
  assert.equal(kx("init", root).code, 0);
  assert.match(readFileSync(join(root, "index.md"), "utf8"), /okf_version: "0.2"/);

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
  const root = join(tempDir(t), "notes");
  const server = createServer(root, "Alex Doe");
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
  assert.deepEqual(tools, ["check_up", "confirm_note", "link_notes", "read_guide", "read_note", "save_note", "search_notes", "update_note"]);
  assert.match((await call("read_guide", { topic: "what" })).text, /five gates/i);

  const body = "_Chosen in 2026 while volume was low._\n\n## Decision\n- Keep background jobs in PostgreSQL.\n";
  let result = await call("save_note", { type: "Decision", title: "Keep jobs in PostgreSQL", description: "Background jobs stay in PostgreSQL for now.", body });
  assert.equal(result.isError, false, result.text);
  const file = "keep-jobs-in-postgresql.md";
  assert.equal(kb.readNote(join(root, file)).meta.generated.by, "test-app/2.0", "authorship comes from the connected app");

  result = await call("update_note", { file, change_summary: "rewrite", body: "Something else" });
  assert.ok(result.isError && /never edited/.test(result.text), "decisions can't be edited");

  result = await call("confirm_note", { file, confirmed_by_user: true });
  assert.match(result.text, /human-reviewed/);
  assert.equal(kb.readNote(join(root, file)).meta.verified[0].by, "human:alex-doe");

  await call("save_note", { type: "Decision", title: "Move jobs to a queue service", description: "Background jobs move to a dedicated queue.", body: "## Decision\n- Use a queue service.\n" });
  result = await call("link_notes", { file: "move-jobs-to-a-queue-service.md", relation: "supersedes", target: file });
  assert.equal(result.isError, false, result.text);
  result = await call("search_notes", { query: "jobs" });
  assert.ok(result.text.includes("move-jobs-to-a-queue-service.md") && !result.text.includes(file));
  assert.match((await call("read_note", { file })).text, /replaced by: move-jobs-to-a-queue-service\.md/);

  await call("save_note", { type: "Preference", title: "Writing style", description: "House style for documents.", body: "## Preference\n- Sentence case headings.\n" });
  result = await call("update_note", { file: "writing-style.md", change_summary: "added a rule", body: "## Preference\n- Sentence case headings.\n- No exclamation marks.\n" });
  assert.equal(result.isError, false, result.text);
  assert.match(readFileSync(join(root, "writing-style.md"), "utf8"), /No exclamation marks/);

  assert.match((await call("check_up")).text, /Never checked|Never verified/);
  assert.ok((await call("read_note", { file: "../outside.md" })).isError, "paths outside the notes folder are refused");
  assert.equal(kx("check", "--bundle", root).code, 0, "notes saved through the server pass validation");
});
