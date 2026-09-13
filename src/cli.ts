#!/usr/bin/env node
// kx: the KnowledgeX command line.
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as kb from "./bundle.js";

const CONTEXT_HINT = "<!-- kx: Start with one italic line telling a reader with no context what this is and why it matters. -->\n";
const TEMPLATES: Record<string, string> = {
  Decision:
    "\n## Decision\n\n## Why\n\n## Alternatives considered\n\n## Reversal conditions\n" +
    "<!-- kx: The specific signals that should reopen this decision. -->\n\n## Consequences\n",
  Preference: "\n## Preference\n\n## Why\n\n## Scope\n",
  Principle: "\n## Principle\n\n## Why\n\n## Origin\n",
  Lesson: "\n## When this applies\n\n## Rule\n\n## Why\n\n## Origin\n<!-- kx: One dated line. No story. -->\n",
  Concept: "\n## Definition\n\n## Why it matters here\n",
  Entity:
    "\n## About\n\n## Key facts (as of {today})\n" +
    "<!-- kx: Facts that change over time. Give each a footnote marker whose id matches an entry in `sources`. -->\n\n## Notes\n",
  Person: "\n## Who\n\n## Context\n\n## Notes\n",
  Playbook: "\n## When to use\n\n## Steps\n\n## Pitfalls\n",
  Plan: "\n## Goal\n\n## Approach\n\n## Milestones\n\n## Review points\n",
  Idea: "\n## The idea\n\n## Why it is interesting\n\n## Open questions\n\n## Next step\n",
  Source: "\n## About\n\n## Takeaways\n\n## Highlights\n",
  Timeline: "\n## Entries\n<!-- kx: Newest first, one line each: date, what happened, why it matters. -->\n",
};
const SKILL_HEADER = `---
name: knowledgex
description: Long-term memory with judgment. Use when the user wants to save, remember, or note something; when recalling earlier decisions, preferences, lessons, people, or plans; before answering questions that depend on what was decided or learned before; and at the end of substantial conversations to propose what is worth keeping. Notes live in an Open Knowledge Format (OKF) bundle managed with the \`kx\` command.
---

`;

const HELP = `kx ${kb.VERSION}: durable, trustworthy knowledge for any AI agent.

Usage: kx <command> [options]

  init FOLDER                                   create a bundle and make it the default
  guide [overview|what|write|retrieve|maintain|all]
                                                print the agent guide
  new TYPE "Title" --description TEXT --by ID   create a note from its type's template
      [--tags a,b] [--status draft] [--source id=URL ...]
  touch FILE --by ID [--message TEXT]           record that a note's content changed
  verify FILE --by ID                           record that a note's content was checked
  relate FILE supersedes|contradicts FILE --by ID
                                                mark a replacement or a conflict
  search [words] [--type TYPE] [--all]          find notes, with trust and freshness
  check                                         validate the bundle
  review                                        list maintenance work
  index                                         rebuild index.md
  install-skill FOLDER                          write KnowledgeX as an Agent Skill into a skills folder
  mcp                                           run the MCP server (for AI apps)

Options: --bundle FOLDER (default: $KX_BUNDLE, then the folder set by \`kx init\`)
--by is who is acting: <agent>/<model>, human:<id>, or process:<name>.`;

function bundleRoot(explicit?: string): string {
  const root = explicit ? kb.expandHome(explicit) : kb.configuredBundle();
  if (!root) throw new kb.KxError("No bundle yet. Create one with: kx init <folder>");
  if (!existsSync(root)) throw new kb.KxError(`Bundle folder not found: ${root}`);
  return root;
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new kb.KxError(`Missing ${what}. Run \`kx --help\` for usage.`);
  return value;
}

function actor(value: string | undefined): string {
  const by = need(value, "--by");
  if (!kb.ACTOR.test(by)) {
    throw new kb.KxError("--by must be <agent>/<model> for agents (e.g. my-agent/1.0), human:<id> for people, or process:<name> for jobs");
  }
  return by;
}

export function main(argv: string[], print: (text: string) => void = console.log): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      bundle: { type: "string" },
      by: { type: "string" },
      description: { type: "string" },
      tags: { type: "string" },
      status: { type: "string" },
      source: { type: "string", multiple: true },
      message: { type: "string" },
      type: { type: "string" },
      all: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
  });
  const [command, ...args] = positionals;
  if (values.version) {
    print(`kx ${kb.VERSION}`);
    return 0;
  }
  if (values.help || !command) {
    print(HELP);
    return command || values.help ? 0 : 1;
  }

  switch (command) {
    case "init": {
      const root = kb.expandHome(need(args[0], "FOLDER"));
      kb.ensureBundle(root);
      mkdirSync(join(kb.configPath(), ".."), { recursive: true });
      writeFileSync(kb.configPath(), JSON.stringify({ bundle: root }, null, 2) + "\n");
      print(`Bundle ready: ${root}`);
      const foreign = kb.loadNotes(root).filter((note) => note.error || !note.meta.type);
      if (foreign.length) {
        print(`Heads-up: ${foreign.length} markdown file(s) here are not OKF notes, and \`kx check\` will flag them. An empty folder works best.`);
      }
      print("Next: connect your agent (see the README), or read the agent guide with `kx guide`.");
      return 0;
    }
    case "guide": {
      const topic = (args[0] ?? "overview") as kb.GuideTopic;
      if (topic !== "all" && !Object.hasOwn(kb.GUIDES, topic)) throw new kb.KxError(`Unknown guide: ${topic}. Choose from: ${Object.keys(kb.GUIDES).join(", ")}, all`);
      print(kb.guideText(topic));
      return 0;
    }
    case "new": {
      const root = bundleRoot(values.bundle);
      const type = need(args[0], "TYPE");
      const title = need(args[1], '"Title"');
      if (values.status && values.status !== "draft" && values.status !== "stable") throw new kb.KxError("--status must be draft or stable");
      const sources = (values.source ?? []).map((item) => {
        const at = item.indexOf("=");
        if (at < 1 || at === item.length - 1) throw new kb.KxError(`--source must look like id=https://example.com, got: ${item}`);
        return { id: item.slice(0, at), resource: item.slice(at + 1) };
      });
      const note = kb.createNote(root, {
        type,
        title,
        description: need(values.description, "--description"),
        body: CONTEXT_HINT + (Object.hasOwn(TEMPLATES, type) ? TEMPLATES[type] : "\n## Notes\n").replace("{today}", kb.day(kb.now())),
        by: actor(values.by),
        tags: (values.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
        status: values.status as "draft" | "stable" | undefined,
        sources,
      });
      if (!kb.isType(type)) console.error(`Note: \`${type}\` is not a KnowledgeX type (${Object.keys(kb.TYPES).join(", ")}).`);
      print(note.path);
      return 0;
    }
    case "touch": {
      const root = bundleRoot(values.bundle);
      const note = kb.openNote(root, need(args[0], "FILE"));
      const before = kb.touchNote(root, note, actor(values.by), values.message);
      print(`Recorded the change to ${kb.rel(note.path, root)}.`);
      if (before !== "unverified") print(`Its earlier verification (${before}) no longer covers the new content. Verify it again once checked.`);
      return 0;
    }
    case "verify": {
      const root = bundleRoot(values.bundle);
      const note = kb.openNote(root, need(args[0], "FILE"));
      const by = actor(values.by);
      print(`${kb.rel(note.path, root)} is now ${kb.verifyNote(root, note, by)}.`);
      return 0;
    }
    case "relate": {
      const root = bundleRoot(values.bundle);
      const relation = need(args[1], "supersedes|contradicts") as kb.Relation;
      if (!kb.RELATIONS.includes(relation)) throw new kb.KxError("The relation must be supersedes or contradicts.");
      actor(values.by); // required for a consistent interface; a relation is metadata, not a content change
      const source = kb.openNote(root, need(args[0], "FILE"));
      const target = kb.openNote(root, need(args[2], "target FILE"));
      kb.relateNotes(root, source, relation, target);
      print(`${kb.rel(source.path, root)} ${relation} ${kb.rel(target.path, root)}.`);
      return 0;
    }
    case "search": {
      const root = bundleRoot(values.bundle);
      const { notes, successors } = kb.search(root, args.join(" "), values.type, values.all);
      print(`Bundle: ${root}`);
      if (!notes.length) print("No matching notes.");
      for (const note of notes) {
        const file = kb.rel(note.path, root);
        const meta = note.meta;
        print(`\n${file}: ${kb.titleOf(note)}`);
        print(`    ${[meta.type ?? "?", kb.trust(meta), kb.freshness(meta), meta.status ?? "?"].join(" · ")}`);
        if (meta.description) print(`    ${meta.description}`);
        if (successors.has(file)) print(`    superseded by: ${successors.get(file)!.join(", ")}`);
        const contradicts = kb.relationTargets(note, root, "contradicts");
        if (contradicts.length) print(`    contradicts: ${contradicts.join(", ")}`);
      }
      return 0;
    }
    case "check": {
      const root = bundleRoot(values.bundle);
      const findings = kb.check(root);
      for (const f of findings) print(`${f.level.padEnd(7)} ${f.file}: ${f.message}`);
      const errors = findings.filter((f) => f.level === "error").length;
      print(`${root}: ${errors} error(s), ${findings.length - errors} warning(s)`);
      return errors ? 1 : 0;
    }
    case "review": {
      const root = bundleRoot(values.bundle);
      const groups = kb.review(root);
      print(`# KnowledgeX review, ${kb.day(kb.now())}\n\nBundle: ${root}\n`);
      if (!groups.size) print("Nothing needs attention.");
      for (const [kind, items] of groups) print(`## ${kind}\n\n${items.map((item) => `- [ ] ${item}`).join("\n")}\n`);
      return 0;
    }
    case "index": {
      const root = bundleRoot(values.bundle);
      kb.writeIndex(root);
      print(`Rebuilt ${join(root, "index.md")}`);
      return 0;
    }
    case "install-skill": {
      const target = join(kb.expandHome(need(args[0], "FOLDER")), "knowledgex");
      mkdirSync(join(target, "references"), { recursive: true });
      writeFileSync(join(target, "SKILL.md"), SKILL_HEADER + kb.guideText("overview"));
      for (const [topic, name] of Object.entries(kb.GUIDES)) {
        if (topic !== "overview") writeFileSync(join(target, "references", name), kb.guideText(topic as kb.GuideTopic));
      }
      print(`Installed the KnowledgeX skill in ${target}`);
      return 0;
    }
    default:
      throw new kb.KxError(`Unknown command: ${command}. Run \`kx --help\` for usage.`);
  }
}

// Run only when executed as `kx` (npm links the bin, so compare real paths), not when imported by tests.
const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  if (argv[0] === "mcp") {
    const { startServer } = await import("./mcp.js");
    await startServer();
  } else {
    try {
      process.exitCode = main(argv);
    } catch (error) {
      if (!(error instanceof kb.KxError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS"))) throw error;
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  }
}
