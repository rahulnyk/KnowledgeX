# KnowledgeX design

This document explains why KnowledgeX exists, how it is built, the decisions behind it, and where it is going. The rules agents follow live in the [agent guides](../guides/); this document doesn't repeat them.

---

## 1. The problem

AI agents are becoming everyday collaborators, but their memory is broken in one of two ways:

- **They forget.** Every conversation starts from zero, and decisions, preferences, and lessons have to be re-explained.
- **They remember everything.** Memory features save chat fragments wholesale. The store fills with outdated numbers, half-finished thoughts, and narrative, and the agent cites it confidently anyway.

The hard part isn't storage. Knowledge fails less by being missing than by being **wrong, stale, or buried in noise**. A useful memory system has to answer three questions:

| Question | Hard part | Where KnowledgeX answers it |
|---|---|---|
| **What to write** | Separating lasting knowledge from conversation leftovers | [what-to-write.md](../guides/what-to-write.md): five gates, how fast information goes stale, what to look for, what never to write |
| **How to write** | A consistent, portable shape that shows trust and age | [how-to-write.md](../guides/how-to-write.md): OKF v0.2 notes with four extension keys |
| **How to retrieve** | Finding the current, trustworthy answer cheaply | [how-to-retrieve.md](../guides/how-to-retrieve.md): cheap search first, supersession, trust shown in answers, trust gating actions |

A fourth, **maintenance** ([maintain.md](../guides/maintain.md)), keeps the answers true over time.

---

## 2. Principles

1. **Agent-agnostic.** The rules are plain markdown, and the operations are exposed both as MCP tools and as a command line. Nothing depends on a particular AI vendor or model.
2. **Tool-agnostic.** Knowledge is stored in an open format in plain files. Editors and knowledge tools are views onto it, not its owner.
3. **No setup for non-technical users.** People such as lawyers and PR managers install one file with a double-click. No terminal, runtime, accounts, servers, or databases.
4. **Open standard.** Notes are [Open Knowledge Format (OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), so they are portable without KnowledgeX.
5. **A note is a liability, not an asset.** Every note must be searched past and kept true. The bar for writing is high; fewer, better notes.
6. **Write what remains, not the transcript.** Knowledge is what's still useful after the conversation, its context, and its moment have passed.
7. **Trust is visible and honest.** Authorship and verification are separate. Only a person can make a note human-reviewed, and editing a note resets its trust.
8. **Trust decides what agents may do.** Unverified knowledge may inform an answer. Only human-reviewed guidance may drive actions without asking.
9. **People stay in charge.** Agents propose; people approve.

---

## 3. Architecture

```
      ┌──────────── AI app (Claude Desktop, Cursor, …) ────────────┐   ┌──── agent with a shell ────┐
      │  one-click extension or MCP config → MCP tools + guides     │   │  Agent Skill / AGENTS.md    │
      └──────────────────────────────┬─────────────────────────────┘   └──────────────┬──────────────┘
                                     │ MCP server (kx mcp)                            │ kx commands
                                     ▼                                                ▼
   ┌────────────┐      ┌─────────────────────────────────────────────────────┐
   │  guides    │      │ bundle: a flat folder of OKF markdown notes          │
   │ (packaged  │      │   index.md · log.md · <kebab-case-note>.md …         │
   │  markdown) │      └───────────────▲─────────────────────────────────────┘
   └────────────┘                      │ opened directly, or synced
                        ┌──────────────┴──────────────────────────────┐
                        │ knowledge tools                              │
                        │  markdown editors: open the folder (today)   │
                        │  Notion, Confluence: connectors (planned)    │
                        │  Evernote, OneNote: import/export (planned)  │
                        └──────────────────────────────────────────────┘
```

| Component | What it is | Where |
|---|---|---|
| **Guides** | The rules: overview, what to write, how to write, how to retrieve, maintain | `guides/`, served by the `read_guide` tool and `kx guide` |
| **Bundle** | The knowledge itself, as a conformant OKF bundle on disk | The folder chosen at install (default `Documents/KnowledgeX`) or with `kx init`. Planned: that folder becomes a library of notebooks, each one a bundle (§4.11) |
| **Core library** | Reading, writing, trust, links, search, validation, maintenance, and the index | `src/bundle.ts` |
| **MCP server** | Eight tools for AI apps: `read_guide`, `search_notes`, `read_note`, `save_note`, `update_note`, `confirm_note`, `link_notes`, `check_up`, plus the key rules as server instructions | `src/mcp.ts`, run with `kx mcp` |
| **One-click extension** | The MCP server bundled into one file with the guides, installed by double-click in Claude Desktop | `manifest.json`, built with `pnpm run pack:mcpb` |
| **`kx` command line** | The same operations for scripts and shell-capable agents, plus templates and `install-skill` | `src/cli.ts` |
| **Agent integrations** | Ways to hand the guides to an agent | The extension or MCP config, `kx install-skill` (Agent Skills), an instructions-file snippet, `kx guide all` for chat apps |
| **Tool connections** | Ways people see and edit the bundle | Markdown folder tools today; connectors planned (§6) |

### How KnowledgeX stays agent-agnostic

- **Guides are plain markdown.** Any agent that can read text can follow them.
- **AI apps that support MCP** get the tools and the key rules through the MCP server. Tool descriptions carry the essential rules (propose first, cite trust), because descriptions are what apps reliably show the model.
- **`kx` is a command line.** Any agent that can run shell commands can use it.
- **Agents with a skills system** get a generated skill folder, with the same text as the guides.
- **Agents that read instruction files** get a four-line snippet that points them at `kx guide`.
- **Chat apps that support neither MCP nor shell commands** get the whole guide as a prompt. They can decide and format well, but can't read or write the bundle.
- **Identity follows OKF's actor convention** (`<agent>/<model>`, `human:<id>`, `process:<name>`), so no agent is special. The MCP server takes the agent's identity from the connected app, so a model can't misreport it.

### How KnowledgeX stays tool-agnostic

The bundle, not any single tool, is the **canonical copy**:

- **It is portable.** Plain files in an open format survive any tool, vendor, or subscription.
- **It has one shape to validate.** Checks, trust rules, and maintenance run the same way whatever the user edits in.
- **It works with git.** Version history, review, and backup come for free.

Tools fall into three groups:

| Group | Examples | How they connect |
|---|---|---|
| **Markdown folder tools** | Obsidian, VS Code, Typora, GitHub, GitLab | Open the bundle folder directly. Works today. |
| **API-based knowledge tools** | Notion, Confluence | A connector syncs notes and pages. Frontmatter maps to page properties (Notion) or content properties and labels (Confluence). Planned. |
| **Closed or export-only tools** | Evernote, OneNote, Apple Notes | Import and export through their export formats. Planned. |

The trade-off: with API-based tools there are two copies, so sync can conflict. The plan is to start with **one-way publishing** (bundle → tool), then add controlled two-way sync once conflict handling is designed.

---

## 4. Key decisions

### 4.1 OKF, not AIX

[AIX](https://github.com/DavidROliverBA/aix-format) is a proposed superset of OKF. It adds stable `id`s, typed `links`, content-hashed media, and federation between bundles. We adopt **OKF only**:

- **OKF is the safer long-term bet.** It is published by Google, has a stated versioning policy (minor versions add features without breaking), and has the larger tool ecosystem.
- **AIX already drifts from OKF.** It claims to be a strict superset, but spells things differently: `sources[].uri` versus OKF's `resource`, `agent:` and `pipeline:` versus OKF's `<producer>/<version>` and `process:`, `active` versus `stable`. Following two moving drafts doubles the migration risk.
- **The AIX features we need fit inside OKF more cheaply:**

| AIX feature | KnowledgeX approach |
|---|---|
| Stable `id` | Not needed. The path is the identity, as in OKF. The bundle is flat so files rarely move, editors update links on rename, and `aliases` keeps old names searchable. |
| Typed `links` | Only two relationships change system behaviour, `supersedes` and `contradicts`, so only they get keys. Every other relationship is an ordinary link with a sentence explaining it. |
| `provenance` map | Not needed. `generated.by` shows who wrote it, `sources` shows where facts came from, and `status: draft` marks uncertainty. |
| Media, federation, manifest | Out of scope for now |

### 4.2 Four extension keys, no more

`created`, `aliases`, `supersedes`, `contradicts`. OKF requires consumers to keep keys they don't recognise, so notes stay conformant. Adding any other key requires revising the profile. If a future OKF version standardises an equivalent, KnowledgeX moves to it.

### 4.3 The bundle is OKF on disk, with no export step

The bundle is a flat folder with kebab-case file names, relative markdown links (not `[[wikilinks]]`), and OKF's reserved `index.md` and `log.md`. Any OKF consumer can read it as-is. The cost is that some editors (such as Obsidian) show file names rather than titles in their file lists.

### 4.4 A verification counts only if it came after the last content change

OKF records `generated` (last content change) and `verified` (checks) separately. KnowledgeX counts a check toward the trust level only if `verified.at ≥ generated.at`. Editing a note automatically lowers its trust, while the history of past checks stays in the file.

### 4.5 Built-in checks rather than an external linter

[okflint](https://github.com/mattdav/okflint) validates bundles against declarative profiles and inspired these checks. We don't depend on it: it needs a separate Python install, and the KnowledgeX checks (trust, staleness, mirrored relationships, transcript-style writing) are small. Bundles stay conformant OKF, so any OKF linter can still be run alongside.

### 4.6 TypeScript on Node, not Python

v0.1 was written in Python. v0.2 is TypeScript, because the people KnowledgeX is for shouldn't install anything:

- **Claude Desktop ships its own Node.js** for extensions, so a Node extension installs with a double-click. A Python extension would require the user to install Python first, which Windows doesn't include and macOS may not.
- **Compiled Python binaries** would avoid that, but need a build per operating system and paid code signing to avoid security warnings.
- **One codebase** serves the extension, the MCP server (`npx`), and the command line, so the trust and staleness rules can't drift between implementations.

Runtime dependencies are the MCP SDK, `zod` (tool input schemas), and `yaml`. The YAML 1.2 core schema keeps ISO 8601 timestamps as plain strings, so they are written back exactly as OKF expects. The extension bundles everything into a single JavaScript file, so it doesn't depend on any package manager's layout. The eval runner is TypeScript too, so contributors need only Node.

### 4.7 Propose first

Agents propose what to keep and write only what the user approves, unless the user opts out. Automatic writing is where memory systems accumulate noise, so autonomy has to be earned.

### 4.8 No databases

Up to roughly ten thousand notes, descriptions plus search plus supersession give precise retrieval with no infrastructure. A search index or embeddings would be added only when recall measurably fails.

### 4.9 Tools write whole notes, and enforce the rules that matter most

Chat apps usually can't edit files, so the MCP tools take full note content rather than asking the agent to edit files and record changes afterwards. The rules whose violation would quietly damage trust are enforced in code, not left to the model:

- decisions can't be edited, only superseded;
- every change resets the note's trust;
- authorship comes from the connected app;
- notes can't be read or written outside the notes folder.

The one rule code can't check, whether the user really confirmed a note, is stated in the `confirm_note` tool description and the guides.

### 4.10 Zero-configuration defaults

The extension works without touching its settings. The notes folder defaults to `Documents/KnowledgeX` and is created on first use. The user's name is optional; without it, confirmations are recorded as `human:user`.

### 4.11 Notebooks: a library of bundles

People keep separate bodies of knowledge (a client matter, a team's playbooks, personal preferences) and want to pass them around. Knowledge should be **additive**: when someone sends a notebook, adding it takes one step, with nothing to merge.

**Naming.** Users see **notebooks**. A notebook *is* an OKF bundle, and the docs say so wherever the word first appears, so people who know OKF aren't left guessing. "Project" was ruled out because it clashes with Projects in Claude Desktop.

**What OKF offers.** OKF v0.2 has no mechanism for composing bundles: no manifest of bundles, no cross-bundle links, no import. It does provide the parts we need:

- bundles are directory trees, and an `index.md` in any directory may list subdirectories;
- a bundle may be distributed "as a subdirectory within a larger repository";
- `okf_version` is only allowed in a bundle-root `index.md`, so it marks where a bundle starts.

The spec doesn't say how a consumer should treat a bundle nested inside another. KnowledgeX defines that for itself (below), and it is worth proposing upstream.

**Layout.** The notes folder becomes a **library**. Each subfolder whose `index.md` carries `okf_version` is a notebook: a complete, standalone, flat bundle, as before.

```
Documents/KnowledgeX/           library (the folder chosen at install)
  index.md                      generated: one entry per notebook
  .knowledgex.json              which notebooks this library created or received, and confirmations made here
  general/                      the default notebook
    index.md  log.md  <note>.md …
  acme-case/
    index.md  log.md  <note>.md …
```

- **Folders only ever separate notebooks.** A notebook stays flat (§4.3), so notes never move and paths stay stable.
- **The default notebook is `general`**, not `main`, which would be confused with git's default branch.
- **The library `index.md`** has no frontmatter and lists each notebook with its note count and most common types. OKF allows no key other than `okf_version` in a bundle-root `index.md`, so a notebook has no title or description field of its own.
- **Links and relationships stay inside a notebook.** Markdown links are relative, and `supersedes`/`contradicts` are resolved against the notebook's own root, so a notebook works the same inside any library.

**Adding and sending.**

- **Add:** copy the notebook folder into the library, or `git clone` it there. The library picks it up on the next call and regenerates its index. `kx add FOLDER [--name NAME]` does the same from the command line, checks the notebook, and refuses a name already taken. Clashes are only ever between folder names, never between notes.
- **Send:** copy or zip the notebook folder. It is a valid OKF bundle with nothing tied to the sender's library.
- **No MCP tool imports from arbitrary paths.** The server only touches the library (§4.9), and copying a folder in covers the need.

**Received notebooks start unconfirmed.** A notebook someone sends arrives with their confirmations. Under §4.4 those would let their Decisions and Playbooks drive actions for the recipient, who never reviewed them. So:

- `.knowledgex.json` records which notebooks the library created, which it **received** (any notebook it finds that it didn't create), and every confirmation made in this library for a note in a received notebook.
- In a received notebook, only confirmations recorded in `.knowledgex.json` count toward the trust tier. The confirmations that arrived with the notebook are kept and shown ("confirmed by human:alex before it reached this library"), but the note reads as unverified until someone confirms it here.
- **Not by name.** `KX_USER` is optional, and everyone who leaves it empty is `human:user`, so names can't tell the sender from the recipient.
- **Not by date.** If the sender later sends an updated copy, its new confirmations are dated after the first copy arrived, and dates can be forged. A record kept outside the notebook has neither problem.
- **Losing `.knowledgex.json` makes every notebook look received.** That fails safe: the user is asked to confirm again, and nothing becomes trusted by accident.
- **Limitation:** if someone else's folder replaces a notebook this library created, under the same name, the library still treats it as its own. `kx add` refuses names already taken for this reason.

**Choosing a notebook.**

- **Notes are addressed as `notebook/file`**, for example `acme-case/client-preferences.md`, so `read_note`, `update_note`, `confirm_note`, and `link_notes` need no new parameter. `link_notes` refuses notes in different notebooks.
- **`search_notes`** searches every notebook by default and labels each result with its notebook. An optional `notebook` narrows it.
- **`save_note`** takes a `notebook`, defaulting to `general`. It creates a notebook only when `create_notebook` is set, so a typo fails instead of silently starting a new notebook. As with notes, the agent proposes a new notebook before creating it.
- **A new `list_notebooks` tool** shows each notebook with its note count, main types, and whether it was received. That makes nine tools.
- **Per-conversation choice comes from instructions**, not settings: a Claude Desktop Project's instructions ("Use the KnowledgeX notebook `acme-case`"), or `AGENTS.md`/`CLAUDE.md` in a repository.
- **`KX_NOTEBOOK`** locks a connection to one notebook, for a hard boundary. The other notebooks are invisible to that connection.
- **The command line** takes `--notebook NAME`. `--bundle FOLDER` still points at any single bundle directly.

**Migration and startup.**

- **A v0.2 notes folder is itself a bundle.** On first start its notes move into `general/`, the move is logged, and `general` is recorded as created by this library, since the notes are the user's own.
- **The chosen folder is used as the library** if it is empty, already a library, or a v0.2 bundle. A folder holding anything else gets a `KnowledgeX` library inside it, as today.
- **`kx init FOLDER`** creates a library with a `general` notebook.

**Alternatives rejected.**

- **One hierarchical bundle, with subfolders as sections.** A received bundle would stop being standalone: its `/` links and root-relative paths would resolve against the wrong root, and one section couldn't be sent on its own.
- **Merging received notes into an existing notebook.** File-name clashes, duplicates, and lost provenance, for no gain over keeping the notebook whole.
- **Cross-notebook `supersedes` and `contradicts`.** They would make notebooks depend on each other and break when one is sent alone. Deferred until there is a need.

---

## 5. Background

### 5.1 Open Knowledge Format v0.2

- A **bundle** is a directory of markdown files with YAML frontmatter, with reserved `index.md` (progressive-disclosure listing) and `log.md` (dated changelog).
- Only `type` is required. Also recommended: `title`, `description`, `resource`, `tags`.
- **Trust and lifecycle fields:**
    - `sources`: provenance, with per-claim footnotes keyed to source ids
    - `generated: {by, at}` and `verified: [{by, at}]`
    - three derived trust tiers: unverified, machine-confirmed, human-reviewed
    - `status`: `draft`, `stable`, or `deprecated`
    - `stale_after`
- **Links** are plain markdown links, and they're untyped.
- **Consumers must tolerate** unknown types, unknown keys, and broken links.
- Trust tiers are advisory in OKF. KnowledgeX makes them gate agent actions (principle 8).

### 5.2 The ecosystem gap

The OKF tools directory lists dozens of projects, mostly **producers** (turning data catalogs, codebases, or websites into bundles), **validators**, and **viewers**. Agent-memory projects on OKF exist, such as hermes-okf (append-only agent memory) and KL4A (document claims with human review at extraction time).

We found nothing that decides *what is worth remembering* from conversations, and nothing that re-verifies knowledge as its sources change or its `stale_after` passes. KnowledgeX focuses on those two gaps.

---

## 6. Roadmap

### Phase 1: build the system (in progress)

| Milestone | Scope | Status |
|---|---|---|
| **M1: core** | Agent guides, `kx` command line (init, guide, new, touch, verify, relate, search, check, review, index, install-skill), tests, README, walkthrough | ✅ v0.1 (Python), ported to TypeScript in v0.2 |
| **M2: judgment evals** | 20 fictional conversations with answer keys, and an agent-agnostic runner that scores precision, recall, staying quiet, transient leaks, action and type, and detail completeness ([evals/](../evals/)). Next: use the results to tune the guides. | ✅ Built |
| **M3: MCP server and one-click extension** | Eight MCP tools with the key rules built in; a Claude Desktop extension with a folder picker and zero-configuration defaults; plain-language walkthrough for non-technical users | ✅ v0.2 |
| **M4: notebooks** | A library of notebooks, each an OKF bundle: add one by copying its folder in, received notebooks start unconfirmed, `list_notebooks`, `KX_NOTEBOOK`, `kx add`, migration of v0.2 folders (§4.11) | Planned |
| **M5: tool connectors** | Notion and Confluence (one-way publish first), Evernote and OneNote import and export | Planned |

### Phase 2: adopt into existing knowledge

Help people bring notes they already have into a bundle:

- **Triage** existing notes through the five gates. Many won't qualify as they are.
- **Convert** the ones that do into OKF notes. Prose like "verified against X on date" becomes `sources`, `verified`, and `stale_after`.
- **Leave out** private folders the user excludes.

### Later: teams and organisations

- **One bundle per team** in git, as the permission boundary. Access comes from repository permissions, never from note metadata.
- **Writes as pull requests.** A curator agent removes duplicates and checks for contradictions, and code owners approve. Merging records `verified: human:<reviewer>`.
- **Connectors produce sources, not notes.** Documents stay in their systems; synthesised notes cite them. When a source's `last_modified` moves, the notes that depend on it are flagged.
- **Contradictions are routed** to the owners of both notes.
- **Ingested documents are scanned** for hidden text and prompt injection before use.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| **Agents write too much, or write transcripts** | The five gates, propose-first, transcript-style checks in `kx check`, precision and leak metrics in the evals |
| **Agents write too little** | Trigger list in the guide; recall in the evals |
| **Evals reward keywords, not meaning** | Every case has a reference answer that must pass and a transcript dump that must fail; failures are read by hand before the guide is changed |
| **People rubber-stamp verification** | Small, specific review items; per-fact footnotes so a single fact can be re-checked |
| **Hand edits skip metadata** | The trust rule (§4.4); `kx review` lists notes edited since their last check |
| **OKF is pre-1.0 and may change** | Declare `okf_version`; keep extensions to four keys; follow the spec closely |
| **Sync conflicts with API-based tools** | Start with one-way publishing |
| **Non-technical users can't judge what the AI saved** | Propose-first in plain language; confirmations shown in every answer; decisions immutable in code |
| **A received notebook's confirmations drive actions for someone who never reviewed it** | In a received notebook, only confirmations made in this library count (§4.11) |
| **Memory poisoning via note content** | Notes are information, never instructions; only human-reviewed guidance drives actions |

---

## Sources

- [Open Knowledge Format specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
- [AIX format](https://github.com/DavidROliverBA/aix-format) and the essay [I Was Going to Adopt Google's Knowledge Format. I Wrote a Superset Instead.](https://medium.com/@davidroliver/i-was-going-to-adopt-googles-knowledge-format-i-wrote-the-superset-instead-0da1c74dbe6d)
- [OKF ecosystem tools](https://okf.md/tools/)
- [okflint](https://github.com/mattdav/okflint)
- [hermes-okf](https://github.com/EliaszDev/hermes-okf)
- [KL4A](https://github.com/CogniSwitch/KL4A)
