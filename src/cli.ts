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
description: Long-term memory with judgment. Use when the user wants to save, remember, or note something; when recalling earlier decisions, preferences, lessons, people, or plans; before answering questions that depend on what was decided or learned before; and at the end of substantial conversations to propose what is worth keeping. Notes live in notebooks (Open Knowledge Format bundles) managed with the \`kx\` command.
---

`;

const HELP = `kx ${kb.VERSION}: durable, trustworthy knowledge for any AI agent.

Usage: kx <command> [options]

  init FOLDER                                   create a library of notebooks and make it the default
  guide [overview|what|write|retrieve|maintain|all]
                                                print the agent guide
  new TYPE "Title" --description TEXT --by ID   create a note from its type's template (--notebook is required
                                                when there is more than one notebook)
      [--tags a,b] [--status draft] [--source id=URL ...]
  touch FILE --by ID [--message TEXT]           record that a note's content changed
  verify FILE --by ID                           record that a note's content was checked
  relate FILE supersedes|contradicts FILE --by ID
                                                mark a replacement or a conflict
  search [words] [--type TYPE] [--all]          find notes, with trust and freshness
  check                                         validate a notebook
  review                                        list maintenance work
  index                                         rebuild index.md
  notebooks [create NAME]                       list notebooks, or start a new one
  add FOLDER [--name NAME]                      copy a notebook someone sent into the library
  install-skill FOLDER                          write KnowledgeX as an Agent Skill into a skills folder
  mcp                                           run the MCP server (for AI apps)

Options: --notebook NAME (default: $KX_NOTEBOOK, then general), or --bundle FOLDER to use any bundle directly.
The library is $KX_BUNDLE, or else the folder set by \`kx init\`.
--by is who is acting: <agent>/<model>, human:<id>, or process:<name>.`;

function library(): string {
  const configured = kb.configuredLibrary();
  if (!configured) throw new kb.KxError("No library yet. Create one with: kx init <folder>");
  if (!existsSync(configured)) throw new kb.KxError(`Library folder not found: ${configured}`);
  return kb.libraryFor(configured);
}

/** The folder a command works on: --bundle as given, or a notebook in the library. `writing`: a new note needs a named notebook when there are several. */
function bundleRoot(values: { bundle?: string; notebook?: string }, writing = false): string {
  if (values.bundle) {
    const root = kb.expandHome(values.bundle);
    if (!existsSync(root)) throw new kb.KxError(`Bundle folder not found: ${root}`);
    if (kb.isLibrary(root)) throw new kb.KxError(`${root} is a library of notebooks, not a bundle. Use --notebook NAME instead.`);
    return root;
  }
  const home = library();
  const names = kb.openLibrary(home);
  if (writing && !values.notebook && !process.env.KX_NOTEBOOK && names.length > 1) {
    throw new kb.KxError(`There are ${names.length} notebooks (${names.join(", ")}). Say which one with --notebook NAME.`);
  }
  const name = values.notebook || process.env.KX_NOTEBOOK || kb.DEFAULT_NOTEBOOK;
  if (!names.includes(name)) throw new kb.KxError(`No notebook named ${name}. Notebooks: ${names.join(", ")}`);
  return join(home, name);
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
      notebook: { type: "string" },
      name: { type: "string" },
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
      const root = kb.libraryFor(kb.expandHome(need(args[0], "FOLDER")));
      const names = kb.openLibrary(root);
      mkdirSync(join(kb.configPath(), ".."), { recursive: true });
      writeFileSync(kb.configPath(), JSON.stringify({ library: root }, null, 2) + "\n");
      print(`Library ready: ${root}`);
      print(`Notebooks: ${names.join(", ")}`);
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
      const root = bundleRoot(values, true);
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
      const root = bundleRoot(values);
      const note = kb.openNote(root, need(args[0], "FILE"));
      const before = kb.touchNote(root, note, actor(values.by), values.message);
      print(`Recorded the change to ${kb.rel(note.path, root)}.`);
      if (before !== "unverified") print(`Its earlier verification (${before}) no longer covers the new content. Verify it again once checked.`);
      return 0;
    }
    case "verify": {
      const root = bundleRoot(values);
      const note = kb.openNote(root, need(args[0], "FILE"));
      const by = actor(values.by);
      print(`${kb.rel(note.path, root)} is now ${kb.verifyNote(root, note, by)}.`);
      return 0;
    }
    case "relate": {
      const root = bundleRoot(values);
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
      const root = bundleRoot(values);
      const { notes, successors } = kb.search(root, args.join(" "), values.type, values.all);
      print(`Notebook: ${root}`);
      if (!notes.length) print("No matching notes.");
      for (const note of notes) {
        const file = kb.rel(note.path, root);
        const meta = note.meta;
        print(`\n${file}: ${kb.titleOf(note)}`);
        print(`    ${[meta.type ?? "?", kb.trustIn(root, note), kb.freshnessIn(root, note), meta.status ?? "?"].join(" · ")}`);
        if (meta.description) print(`    ${meta.description}`);
        const edit = kb.editOf(root, note);
        if (edit) {
          print(`    ${edit.added ? "written" : "changed"} outside KnowledgeX${edit.by ? ` by ${edit.by}` : ""} on ${edit.at.slice(0, 10)}`);
          const { before, since } = kb.checksAroundEdit(root, note);
          if (before.length) print(`    before that, confirmed by ${before.join(", ")}`);
          if (since.length) print(`    since then, confirmed by ${since.join(", ")}`);
        }
        if (successors.has(file)) print(`    superseded by: ${successors.get(file)!.join(", ")}`);
        const contradicts = kb.relationTargets(note, root, "contradicts");
        if (contradicts.length) print(`    contradicts: ${contradicts.join(", ")}`);
      }
      return 0;
    }
    case "check": {
      const root = bundleRoot(values);
      const findings = kb.check(root);
      for (const f of findings) print(`${f.level.padEnd(7)} ${f.file}: ${f.message}`);
      const errors = findings.filter((f) => f.level === "error").length;
      print(`${root}: ${errors} error(s), ${findings.length - errors} warning(s)`);
      return errors ? 1 : 0;
    }
    case "review": {
      const root = bundleRoot(values);
      const groups = kb.review(root);
      print(`# KnowledgeX review, ${kb.day(kb.now())}\n\nNotebook: ${root}\n`);
      if (!groups.size) print("Nothing needs attention.");
      for (const [kind, items] of groups) print(`## ${kind}\n\n${items.map((item) => `- [ ] ${item}`).join("\n")}\n`);
      return 0;
    }
    case "index": {
      const root = bundleRoot(values);
      kb.writeIndex(root);
      print(`Rebuilt ${join(root, "index.md")}`);
      return 0;
    }
    case "notebooks": {
      const home = library();
      if (args[0] === "create") {
        kb.createNotebook(home, need(args[1], "NAME"));
        print(`Started the notebook ${args[1]} in ${home}`);
        return 0;
      }
      if (args[0]) throw new kb.KxError(`Unknown notebooks command: ${args[0]}. Use \`kx notebooks\` or \`kx notebooks create NAME\`.`);
      for (const name of kb.openLibrary(home)) print(`${name}: ${kb.notebookSummary(home, name)}`);
      return 0;
    }
    case "add": {
      const home = library();
      const name = kb.addNotebook(home, need(args[0], "FOLDER"), values.name);
      const findings = kb.check(join(home, name));
      const errors = findings.filter((f) => f.level === "error").length;
      print(`Added the notebook ${name}. Its notes count as unconfirmed until you confirm them here.`);
      if (findings.length) print(`\`kx check --notebook ${name}\` found ${errors} error(s) and ${findings.length - errors} warning(s).`);
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
