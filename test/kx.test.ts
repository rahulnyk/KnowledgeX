// End-to-end checks for the kx command line, the core library, and the MCP server. Run with: pnpm test
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as kb from "../src/bundle.js";
import { main } from "../src/cli.js";
import { createServer } from "../src/mcp.js";
import { checkCases, loadCases, main as evalsMain, offerStart, type Offer, promptFor, type Reply, scoreOffer, scoreRetrieve } from "../evals/run.js";

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

test("notes edited in another editor, and wikilinks", (t) => {
  const library = join(tempDir(t), "notes");
  const names = kb.openLibrary(library);
  const root = join(library, names[0]);

  // Wikilinks made in an editor such as Obsidian count as links.
  kb.createNote(root, { type: "Concept", title: "Retainer", description: "What a retainer is.", body: "## Definition\n- Money held on account.\n", by: AGENT });
  kb.createNote(root, {
    type: "Playbook",
    title: "Client intake",
    description: "How a new client is taken on.",
    body: "## Steps\n- Agree the [[retainer|retainer amount]] first.\n- See [[retainer#definition]].\n",
    by: AGENT,
  });
  assert.deepEqual(kb.localLinks(kb.openNote(root, "client-intake.md"), root), ["retainer.md", "retainer.md"]);
  assert.equal(kb.wikiTarget("retainer|amount"), "retainer.md");
  assert.equal(kb.wikiTarget("notes/2026.png"), "notes/2026.png");
  assert.equal(kb.wikiTarget("../outside"), "", "a wikilink can't point outside the notebook");
  let findings = kb.check(root);
  assert.ok(findings.some((f) => /wikilinks/.test(f.message)), "portability warning stays");
  assert.ok(!findings.some((f) => /broken link/.test(f.message)), "a wikilink to a note that exists is not broken");

  // A wikilink satisfies the link a relation needs in the body.
  kb.createNote(root, { type: "Concept", title: "Old retainer", description: "d", body: "## Definition\n- Old.\n", by: AGENT });
  const newer = kb.openNote(root, "retainer.md");
  newer.meta.supersedes = ["old-retainer.md"];
  newer.body = `${newer.body}\nReplaces [[old-retainer]].\n`;
  kb.writeNote(newer);
  assert.ok(!kb.check(root).some((f) => /also needs a link in the body/.test(f.message)));

  // An edit made in another editor counts as the user's own confirmation.
  const file = join(root, "client-intake.md");
  assert.equal(kb.trustIn(root, kb.openNote(root, "client-intake.md")), "unverified");
  writeFileSync(file, `${readFileSync(file, "utf8")}- Confirm the fee by email.\n`);
  const edited = kb.openNote(root, "client-intake.md");
  assert.equal(kb.editedHere(root, edited), true);
  assert.equal(kb.trustIn(root, edited), "human-reviewed");
  const groups = kb.review(root);
  assert.ok(!(groups.get("Never verified") ?? []).some((item) => item.startsWith("client-intake.md")), "the user's own edit needs no checking");
  assert.ok((groups.get("Never verified") ?? []).some((item) => item.startsWith("retainer.md")), "other notes still do");

  // Writing through KnowledgeX puts the note back under the usual rules.
  kb.updateNote(root, kb.openNote(root, "client-intake.md"), { description: "How a new client is taken on, with fees." }, AGENT);
  assert.equal(kb.editedHere(root, kb.openNote(root, "client-intake.md")), false);
  assert.equal(kb.trustIn(root, kb.openNote(root, "client-intake.md")), "unverified");

  // A note in a copied notebook was never written here, so it is not treated as edited by the user.
  const theirs = join(tempDir(t), "theirs");
  kb.ensureBundle(theirs);
  kb.createNote(theirs, { type: "Lesson", title: "Their lesson", description: "d", body: "- x\n", by: AGENT });
  const added = kb.addNotebook(library, theirs, "from-them");
  const copied = kb.openNote(join(library, added), "their-lesson.md");
  assert.equal(kb.editedHere(join(library, added), copied), false);
  assert.equal(kb.trustIn(join(library, added), copied), "unverified");
});

test("the user's own changes, recorded", (t) => {
  const dir = tempDir(t);
  const library = join(dir, "notes");
  const root = join(library, kb.openLibrary(library, "human:alex")[0]);
  const note = (file: string) => kb.openNote(root, file);
  const state = () => JSON.parse(readFileSync(join(library, ".knowledgex.json"), "utf8")).notebooks;
  kb.createNote(root, { type: "Entity", title: "Acme", description: "A client.", body: "## About\n- Retail.\n", by: AGENT });
  kb.createNote(root, { type: "Decision", title: "Bill monthly", description: "d", body: "## Decision\n- Monthly.\n", by: AGENT });
  kb.createNote(root, { type: "Lesson", title: "Ask early", description: "d", body: "## Rule\n- Ask.\n", by: AGENT });

  // Notes written before fingerprints existed are fingerprinted as they are the first time the library opens:
  // what an agent wrote doesn't become the user's, but any change after that does.
  // A change made to a note that already had a fingerprint, from 0.3.1, is still the user's.
  const lesson = join(root, "ask-early.md");
  writeFileSync(lesson, `${readFileSync(lesson, "utf8")}- Before the kickoff.\n`);
  const legacy = state();
  delete legacy.general.tracked;
  delete legacy.general.content["acme.md"];
  writeFileSync(join(library, ".knowledgex.json"), JSON.stringify({ notebooks: legacy }));
  kb.openLibrary(library, "human:alex");
  assert.ok(state().general.content["acme.md"] && state().general.tracked);
  assert.equal(kb.trustIn(root, note("acme.md")), "unverified");
  assert.equal(kb.editOf(root, note("ask-early.md"))?.by, "human:alex");
  kb.updateNote(root, note("ask-early.md"), { body: "## Rule\n- Ask.\n" }, AGENT);

  // A change made in another editor is recorded as the user's, with their name, logged, and indexed.
  const acme = join(root, "acme.md");
  writeFileSync(acme, readFileSync(acme, "utf8").replace("title: Acme", "title: Acme Retail").replace("- Retail.", "- Retail, since 2019."));
  assert.equal(kb.editOf(root, note("acme.md"))?.by, "", "seen before it is recorded");
  kb.openLibrary(library, "human:alex");
  assert.deepEqual(Object.keys(kb.editOf(root, note("acme.md"))!), ["by", "at"]);
  assert.equal(kb.editOf(root, note("acme.md"))!.by, "human:alex");
  assert.equal(kb.trustIn(root, note("acme.md")), "human-reviewed");
  assert.match(readFileSync(join(root, "log.md"), "utf8"), /Edited \[Acme Retail\]\(acme\.md\) outside KnowledgeX, by human:alex/);
  assert.match(readFileSync(join(root, "index.md"), "utf8"), /\[Acme Retail\]/);
  kb.openLibrary(library, "human:alex");
  assert.equal(readFileSync(join(root, "log.md"), "utf8").match(/Acme Retail.*outside KnowledgeX/g)?.length, 1, "recorded once");

  // The user's edit starts a fresh expiry window, as a check does, without touching their file.
  const expired = readFileSync(acme, "utf8").replace(/stale_after: .*/, "stale_after: 2000-01-01T00:00:00Z");
  writeFileSync(acme, expired);
  assert.match(kb.freshness(note("acme.md").meta), /^stale/);
  kb.openLibrary(library, "human:alex");
  assert.match(kb.freshnessIn(root, note("acme.md")), /^fresh until/);
  assert.equal(readFileSync(acme, "utf8"), expired);

  // A check or a link keeps the content the user's; an agent's change does not.
  kb.verifyNote(root, note("acme.md"), AGENT);
  assert.equal(kb.trustIn(root, note("acme.md")), "human-reviewed");
  kb.updateNote(root, note("acme.md"), { body: "## About\n- Wholesale.\n" }, AGENT);
  assert.equal(kb.trustIn(root, note("acme.md")), "unverified");

  // A note written by hand is the user's too, in any notebook, and a decision they wrote is theirs to shape.
  writeFileSync(join(root, "my-own.md"), "---\ntype: Decision\ntitle: Mine\ndescription: d\nstatus: stable\n---\nMine.\n");
  kb.openLibrary(library, "human:alex");
  assert.equal(kb.editOf(root, note("my-own.md"))?.added, true);
  assert.equal(kb.trustIn(root, note("my-own.md")), "human-reviewed");
  assert.match(readFileSync(join(root, "log.md"), "utf8"), /Added \[Mine\]\(my-own\.md\) outside KnowledgeX/);
  writeFileSync(join(root, "my-own.md"), readFileSync(join(root, "my-own.md"), "utf8") + "Still mine.\n");
  kb.openLibrary(library, "human:alex");
  assert.ok(!kb.review(root).has("Decisions changed outside KnowledgeX"));

  // A change not yet recorded, such as one made just before a check through `kx --bundle`, is recorded before the write.
  const acmeNow = readFileSync(acme, "utf8");
  writeFileSync(acme, acmeNow.replace("- Wholesale.", "- Wholesale and retail."));
  kb.verifyNote(root, note("acme.md"), AGENT);
  assert.equal(kb.editOf(root, note("acme.md"))?.by, kb.personId());
  assert.equal(kb.trustIn(root, note("acme.md")), "human-reviewed");
  assert.match(readFileSync(join(root, "log.md"), "utf8"), /Edited \[Acme Retail\]\(acme\.md\) outside KnowledgeX, by human:/);

  // A decision an agent recorded is replaced, never changed: a change to it is flagged.
  const bill = join(root, "bill-monthly.md");
  writeFileSync(bill, readFileSync(bill, "utf8").replace("- Monthly.", "- Quarterly."));
  kb.openLibrary(library, "human:alex");
  assert.match(kb.review(root).get("Decisions changed outside KnowledgeX")?.[0] ?? "", /^bill-monthly\.md .*changed by human:alex/);

  // Line endings converted by a sync client or git are not an edit.
  const ask = join(root, "ask-early.md");
  writeFileSync(ask, `\uFEFF${readFileSync(ask, "utf8").replace(/\n/g, "\r\n")}`);
  kb.openLibrary(library, "human:alex");
  assert.equal(kb.editedHere(root, note("ask-early.md")), false);

  // A renamed note keeps its confirmations; records of a note gone for a month are dropped.
  kb.verifyNote(root, note("ask-early.md"), "human:alex");
  renameSync(ask, join(root, "ask-questions-early.md"));
  kb.openLibrary(library, "human:alex");
  assert.equal(kb.trustIn(root, note("ask-questions-early.md")), "human-reviewed");
  assert.equal(kb.editedHere(root, note("ask-questions-early.md")), false, "a rename is not an edit");
  assert.equal(state().general.confirmed["ask-early.md"], undefined);
  assert.match(readFileSync(join(root, "log.md"), "utf8"), /Renamed ask-early\.md to \[Ask early\]\(ask-questions-early\.md\)/);
  unlinkSync(join(root, "my-own.md"));
  kb.openLibrary(library, "human:alex");
  assert.ok(state().general.missing["my-own.md"], "kept while it may come back");
  const aged = JSON.parse(readFileSync(join(library, ".knowledgex.json"), "utf8"));
  aged.notebooks.general.missing["my-own.md"] = "2000-01-01T00:00:00Z";
  writeFileSync(join(library, ".knowledgex.json"), JSON.stringify(aged));
  kb.openLibrary(library, "human:alex");
  assert.ok(!("my-own.md" in state().general.content) && !("my-own.md" in (state().general.edited ?? {})));

  // In a received notebook, what arrived isn't the user's, but what they change there is.
  const theirs = join(dir, "theirs");
  kb.ensureBundle(theirs);
  kb.createNote(theirs, { type: "Lesson", title: "Their lesson", description: "d", body: "- x\n", by: AGENT });
  const received = join(library, kb.addNotebook(library, theirs, "from-sam"));
  assert.equal(kb.trustIn(received, kb.openNote(received, "their-lesson.md")), "unverified");
  writeFileSync(join(received, "their-lesson.md"), `${readFileSync(join(received, "their-lesson.md"), "utf8")}- y\n`);
  kb.openLibrary(library, "human:alex");
  assert.equal(kb.trustIn(received, kb.openNote(received, "their-lesson.md")), "human-reviewed");

  // The change keeps the history: who confirmed the earlier version is still shown, and who confirmed it since.
  const samChecked = join(received, "sam-checked.md");
  writeFileSync(samChecked, "---\ntype: Lesson\ntitle: Sam's rule\ndescription: d\nstatus: stable\ngenerated:\n  by: a/1\n  at: 2026-01-01T00:00:00Z\nverified:\n  - by: human:sam\n    at: 2026-01-02T00:00:00Z\n---\n- x\n");
  const late = join(dir, "late");
  kb.ensureBundle(late);
  cpSync(samChecked, join(late, "sam-checked.md"));
  unlinkSync(samChecked);
  const lateBook = join(library, kb.addNotebook(library, late, "from-sam-later"));
  const samNote = () => kb.openNote(lateBook, "sam-checked.md");
  assert.deepEqual(kb.checksAroundEdit(lateBook, samNote()), { before: [], since: [] }, "not the user's until they change it");
  writeFileSync(join(lateBook, "sam-checked.md"), `${readFileSync(join(lateBook, "sam-checked.md"), "utf8")}- y\n`);
  kb.openLibrary(library, "human:alex");
  kb.verifyNote(lateBook, samNote(), "human:alex");
  assert.deepEqual(kb.checksAroundEdit(lateBook, samNote()), { before: ["human:sam (in another copy)"], since: ["human:alex"] });
});

test("the library's records survive crashes and apps writing at once", async (t) => {
  const dir = tempDir(t);
  const library = join(dir, "notes");
  kb.openLibrary(library);
  const statePath = join(library, ".knowledgex.json");

  // Several processes saving at once: every fingerprint is kept.
  const { spawn } = await import("node:child_process");
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const env = { ...process.env, KX_BUNDLE: library };
  const run = (i: number) =>
    new Promise<number>((done) => {
      const script = `for n in 1 2 3 4 5; do node ${JSON.stringify(cli)} new Idea "Idea ${i} $n" --description d --by ${AGENT} >/dev/null || exit 1; done`;
      spawn("sh", ["-c", script], { env, stdio: "inherit" }).on("exit", (code) => done(code ?? 1));
    });
  assert.deepEqual(await Promise.all([1, 2, 3, 4].map(run)), [0, 0, 0, 0]);
  const content = JSON.parse(readFileSync(statePath, "utf8")).notebooks.general.content;
  assert.equal(Object.keys(content).length, 20);
  assert.ok(!existsSync(`${statePath}.lock`));

  // A lock left by a crash doesn't block the library, whether its process is gone or the lock is far too old.
  const lock = `${statePath}.lock`;
  const ended = spawn(process.execPath, ["-e", ""]);
  await new Promise((done) => ended.on("exit", done));
  writeFileSync(lock, String(ended.pid));
  assert.deepEqual(kb.openLibrary(library), ["general"]);
  assert.ok(!existsSync(lock));
  writeFileSync(lock, "");
  utimesSync(lock, new Date(0), new Date(0));
  assert.deepEqual(kb.openLibrary(library), ["general"]);

  // A lock whose process is still running is never taken away, however long it has been held.
  const running = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
  t.after(() => running.kill());
  writeFileSync(lock, String(running.pid));
  const minuteAgo = new Date(Date.now() - 60_000);
  utimesSync(lock, minuteAgo, minuteAgo);
  process.env.KX_LOCK_WAIT_MS = "200";
  try {
    assert.throws(() => kb.openLibrary(library), /busy/);
  } finally {
    delete process.env.KX_LOCK_WAIT_MS;
  }
  assert.equal(readFileSync(lock, "utf8"), String(running.pid), "left in place");
  running.kill();
  await new Promise((done) => running.on("exit", done));
  assert.deepEqual(kb.openLibrary(library), ["general"]);

  // An unreadable file is set aside for recovery, not overwritten, and nothing counts as confirmed until then.
  writeFileSync(statePath, '{"notebooks": {"general": {"confir');
  assert.deepEqual(kb.openLibrary(library), ["general"]);
  assert.ok(readdirSync(library).some((name) => name.startsWith(".knowledgex.json.unreadable-")));
  assert.ok(JSON.parse(readFileSync(statePath, "utf8")).notebooks.general.tracked);
  assert.ok(!readdirSync(library).some((name) => name.endsWith(".tmp")), "written through a temporary file");
});

test("eval cases are valid", async () => {
  assert.deepEqual(checkCases(loadCases()), []);

  // Retrieval cases fail an agent that answers from nothing, and the reminder goes into the prompt only when asked.
  const lookup = loadCases(["client-update-channel-lookup"])[0];
  assert.equal(scoreRetrieve(lookup, { tool_calls: [], answer: "I'd email them on Friday morning." }).passed, false);
  assert.equal(scoreRetrieve(lookup, lookup.reference as Reply).passed, true);
  assert.ok(!promptFor(lookup).includes("standing instructions"));
  assert.ok(promptFor(lookup, true).includes("standing instructions"));
  assert.ok(!promptFor(lookup).includes("meridian-update-routine.md"), "the notes stay hidden: finding them is the test");
  // Offer cases are judged on the reply the user sees: the offer is its last line, and a quiet turn fails any offer at all.
  const due = loadCases(["offer-lesson-midway"])[0];
  const reply = (due.reference as Offer).reply!;
  assert.equal(scoreOffer(due, { reply }).passed, true);
  const offer = reply.slice(offerStart(reply));
  assert.equal(scoreOffer(due, { reply: `${offer}\n\nUse =SUM(D2:D40).` }).passed, false, "an offer before the answer interrupts it");
  assert.equal(scoreOffer(due, { reply: "Use =SUM(D2:D40)." }).passed, false, "no offer");
  const inline = "Use =SUM(D2:D40). Also, I'd keep that a filter left on is the first thing to check when the export is blank. Save this?";
  assert.equal(scoreOffer(due, { reply: inline }).passed, true, "an offer at the end of the same paragraph counts");
  const wrapUp = loadCases(["offer-at-wrap-up"])[0];
  const skipping = "Glad to help! I'd keep one thing: you chose a 240V kiln over 3-phase, and you'll reconsider if a second potter joins. I'd skip the shelves and posts. Save this?";
  assert.equal(scoreOffer(wrapUp, { reply: skipping }).passed, true, "naming what it would skip isn't keeping it");
  const quiet = loadCases(["offer-ignored-not-repeated"])[0];
  assert.equal(scoreOffer(quiet, { reply: "About 200°C. Worth keeping: you publish in metric. Save it?" }).passed, false);
  assert.equal(scoreOffer(quiet, { reply: "About 200°C, for 30 minutes." }).passed, true);
  assert.ok(promptFor(due).includes("save_note:"), "the agent sees what an AI app shows it");
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
  result = await call("save_note", { type: "Idea", title: "Unsorted", description: "d", body: "## The idea\n- x\n" });
  assert.ok(result.isError && /2 notebooks \(acme-case, general\)/.test(result.text) && /ask the user/.test(result.text), "with several notebooks, one must be named");
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

  // A notebook that is briefly unreadable, as while a sync client restores it, keeps its confirmations.
  renameSync(join(received, "index.md"), join(received, "index.md.away"));
  assert.deepEqual(kb.openLibrary(library), ["general"]);
  renameSync(join(received, "index.md.away"), join(received, "index.md"));
  assert.deepEqual(kb.openLibrary(library), ["from-sam", "general"]);
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

  // Choosing a notebook as the notes folder means its library; writing to the library root as a bundle is refused.
  assert.equal(kb.libraryFor(general), library);
  assert.match(kx("new", "Idea", "x", "--description", "d", "--by", AGENT, "--bundle", library).out, /library of notebooks/);

  // While another process holds the migration lock, a v0.2 folder is left alone; a lock left by a crash expires.
  const racing = join(dir, "racing");
  kb.ensureBundle(racing);
  writeFileSync(join(racing, ".knowledgex.lock"), "");
  assert.deepEqual(kb.openLibrary(racing), []);
  assert.ok(existsSync(join(racing, "log.md")), "nothing moved while locked");
  utimesSync(join(racing, ".knowledgex.lock"), new Date(0), new Date(0));
  assert.deepEqual(kb.openLibrary(racing), ["general"]);
  assert.ok(!existsSync(join(racing, ".knowledgex.lock")));

  // A folder with other files gets a library inside it; a library or an empty folder is used as it is.
  const busy = join(dir, "Documents");
  mkdirSync(busy);
  writeFileSync(join(busy, "taxes.pdf"), "");
  assert.equal(kb.libraryFor(busy), join(busy, "KnowledgeX"));
  assert.equal(kb.libraryFor(library), library);
  assert.equal(kb.libraryFor(join(dir, "new")), join(dir, "new"));
  assert.equal(kx("notebooks", "create", "Bad Name").code, 1);
  assert.equal(kx("new", "Idea", "x", "--description", "d", "--by", AGENT, "--notebook", "missing").code, 1);
  assert.match(kx("new", "Idea", "x", "--description", "d", "--by", AGENT).out, /Say which one with --notebook/);
});
