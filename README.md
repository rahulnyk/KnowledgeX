# KnowledgeX

**Long-term memory with judgment, for any AI agent.**

AI assistants forget everything when a conversation ends. The usual fixes go too far the other way: they save everything, and before long your "memory" is a pile of outdated chat fragments that nobody trusts.

KnowledgeX teaches your agent three things:

1. **What to write.** Keep only what will still matter later: decisions and why they were made, preferences, lessons, people, plans. Skip the chatter, the dead ends, and the numbers that will be stale next week.
2. **How to write it.** Each note is a plain markdown file that records who wrote it, who checked it, where its facts came from, and when it goes stale.
3. **How to use it.** Look things up before answering, prefer the newest version, and say how far each fact can be trusted.

Your knowledge stays in an ordinary folder on your computer, in the open [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) published by Google. There's no database and no account. You can read and edit every note yourself.

> **Status:** early (v0.1). The format and commands may still change.

## How it works

```
 you + your AI agent
        │
        │  follows the KnowledgeX guide: what to write, how, how to look it up
        ▼
   kx command  ──►  your bundle: a folder of markdown notes (OKF)
                        ├── index.md   (list of notes)
                        ├── log.md     (what changed, when)
                        └── use-postgresql-as-the-job-queue.md  …
```

- **The bundle** is a folder of notes. Open it in any markdown editor.
- **The guide** is a set of instructions your agent reads. It covers what's worth keeping, how to write it, and how to cite it.
- **The `kx` command** handles the fiddly parts: creating notes from templates, recording who changed or checked what, finding notes, and flagging problems.
- **You stay in charge.** The agent proposes what to save; you approve it. Only you can mark a note as reviewed by a person.

## What it works with

**AI agents.** KnowledgeX isn't tied to any one AI.

| Your agent | How to connect |
|---|---|
| Agents that support **Agent Skills** (`SKILL.md`) | `kx install-skill <your agent's skills folder>` |
| Agents that read an instructions file (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, rules files) | Paste the snippet from [Connect your agent](#connect-your-agent) |
| Chat apps with no access to your computer | Paste the output of `kx guide all` into the app's custom instructions. The agent can then follow the rules, but it can't read or write your bundle directly. |

**Knowledge tools.** Because the bundle is plain markdown, it works today with any tool that opens a folder of markdown files, such as Obsidian, VS Code, Typora, or a GitHub or GitLab repository.

| Tool | Status |
|---|---|
| Obsidian, VS Code, Typora, and other markdown editors | ✅ Works today. Put the bundle anywhere, including inside an Obsidian vault. |
| Git hosts (GitHub, GitLab) | ✅ Works today. The bundle is a normal folder, so you can version it. |
| Notion, Confluence | 🛠 Planned: connectors that sync the bundle with pages |
| Evernote, OneNote, Apple Notes | 🛠 Planned: import and export |

## Install

You need Python 3.9 or newer. The easiest route is [uv](https://docs.astral.sh/uv/), which also installs Python for you if needed.

**1. Install uv** (skip if you have it)

macOS and Linux:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

**2. Install KnowledgeX** straight from GitHub:

```bash
uv tool install git+https://github.com/rahulnyk/KnowledgeX
```

Prefer pip or pipx? `pipx install git+https://github.com/rahulnyk/KnowledgeX` or `pip install git+https://github.com/rahulnyk/KnowledgeX` work too.

**3. Check it works**

```bash
kx --version
```

Tip: you can also ask your AI agent to do these steps for you.

## Quick start

Create your bundle (any empty folder works):

```bash
kx init ~/KnowledgeX
```

Connect your agent (see below), then just talk to it. When something worth keeping comes up, the agent will propose it, like this:

> Worth keeping: (1) **Decision**: use PostgreSQL as the job queue, with when to revisit it. Skipping: the benchmark numbers. Save these?

Later, ask things like "what did we decide about the job queue?". The agent looks it up and tells you how trustworthy the answer is.

You can use the commands yourself too:

```bash
kx search job queue
```

```bash
kx review
```

## Connect your agent

**Agents with Agent Skills support.** Install the skill into your agent's skills folder. For Claude Code, that is:

```bash
kx install-skill ~/.claude/skills
```

For other agents, check their documentation for the skills folder location.

**Agents that read an instructions file.** Add this to your `AGENTS.md` (or `CLAUDE.md`, `GEMINI.md`, or your editor's rules file):

```markdown
## Long-term knowledge (KnowledgeX)
Durable knowledge is kept in a KnowledgeX bundle, managed with the `kx` command.
- Before answering questions that depend on earlier decisions, preferences, lessons, people, or plans, run `kx search <words>`.
- Before saving anything, and at the end of substantial conversations, run `kx guide` and follow it.
```

**Chat apps.** Run `kx guide all` and paste the output into the app's custom or project instructions.

## Commands

| Command | What it does |
|---|---|
| `kx init FOLDER` | Create a bundle and make it your default |
| `kx guide [what\|write\|retrieve\|maintain\|all]` | Print the agent guide |
| `kx new TYPE "Title" --description "…" --by ID` | Create a note from a template |
| `kx touch FILE --by ID` | Record that a note was changed |
| `kx verify FILE --by ID` | Record that a note was checked |
| `kx relate FILE supersedes\|contradicts FILE --by ID` | Mark a replacement or a conflict |
| `kx search [words] [--type TYPE] [--all]` | Find notes, with trust and freshness |
| `kx check` | Check the bundle for mistakes |
| `kx review` | List notes that need attention: stale, unchecked, conflicting |
| `kx index` | Rebuild the list of notes |
| `kx install-skill FOLDER` | Install KnowledgeX as an Agent Skill |

`--by` says who is acting: `human:<name>` for a person (e.g. `human:alex`), `<agent>/<model>` for an AI agent, or `process:<name>` for a scheduled job. To use a bundle other than your default, add `--bundle FOLDER` or set `KX_BUNDLE`.

## Questions

**Where is my data?** In the folder you chose, as plain text files. The `kx` command never connects to the internet. Your AI agent reads the notes it needs, the same way it reads any file you share with it.

**Why the Open Knowledge Format?** It's an open, vendor-neutral spec for knowledge that both people and AI can read. Your notes aren't locked into KnowledgeX: any OKF-aware tool can use them.

**Can I edit notes by hand?** Yes. Afterwards, run `kx touch FILE --by human:<you>` so the note records the change, and `kx check` to catch mistakes.

**Does it work for teams?** A bundle in a shared git repository works today. Features built for teams, such as review through pull requests and per-team bundles, are on the [roadmap](docs/design.md#roadmap).

## Learn more

- [Walkthrough](docs/walkthrough.md): step-by-step, from install to your first notes
- [Design](docs/design.md): goals, architecture, decisions, and roadmap
- Agent guides: [overview](src/knowledgex/protocol/overview.md), [what to write](src/knowledgex/protocol/what-to-write.md), [how to write](src/knowledgex/protocol/how-to-write.md), [how to retrieve](src/knowledgex/protocol/how-to-retrieve.md), [maintain](src/knowledgex/protocol/maintain.md)

## Contributing

Issues and pull requests are welcome. Run the tests with:

```bash
python tests/test_kx.py
```

Changes to the agent guides should be checked against the [judgment evals](evals/README.md), which measure whether an agent keeps the right things. New eval cases are especially welcome.

## License

[MIT](LICENSE)
