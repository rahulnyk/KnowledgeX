# Technical guide

For connecting KnowledgeX to AI apps other than Claude Desktop, using it from the command line, or setting it up for coding agents. If you use Claude Desktop, you don't need any of this: see the [walkthrough](walkthrough.md).

Everything here needs [Node.js](https://nodejs.org) 22 or newer.

---

## Connect an AI app over MCP

Any app that supports MCP servers can use KnowledgeX. The server gives the AI nine tools and the key rules, so there's nothing else to set up. The README's [Get started](../README.md#get-started) section has step-by-step setup for Claude Desktop, the ChatGPT desktop app, Perplexity, Windsurf, Cursor, Gemini CLI, Code Puppy, VS Code, Claude Code, and Codex.

**Apps with an MCP configuration file** (for example Cursor or VS Code):

```json
{
  "mcpServers": {
    "knowledgex": {
      "command": "npx",
      "args": ["-y", "knowledgex", "mcp"],
      "env": { "KX_BUNDLE": "/path/to/your/notes" }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add knowledgex -- npx -y knowledgex mcp
```

### Settings

| Variable | Meaning | Default |
|---|---|---|
| `KX_BUNDLE` | The notes folder: a library that holds your notebooks | The folder set with `kx init`, otherwise `~/Documents/KnowledgeX` |
| `KX_USER` | Your name, recorded when you confirm a note | `user` |
| `KX_NOTEBOOK` | Limit this connection to one notebook | Not set: every notebook |

To set them, add an `env` entry to the app's MCP configuration, as in the example above, or pass `--env KX_BUNDLE=/path/to/notes` to `codex mcp add` or `claude mcp add`.

The folder is created on first use. If it already contains other files and isn't a KnowledgeX library, the library goes in a `KnowledgeX` folder inside it. A notes folder from v0.2, which held notes directly, becomes the `general` notebook the first time a newer version opens it.

### Tools

| Tool | What it does |
|---|---|
| `read_guide` | Read the rules: what to keep, how to write, how to look things up, how to maintain notes |
| `search_notes` | Find notes, with whether each was confirmed and whether it's out of date |
| `read_note` | Read one note in full, with its sources and history of checks |
| `save_note` | Save a new note the user approved; names the notebook when there is more than one |
| `update_note` | Change a note the user approved changing (decisions can't be edited) |
| `confirm_note` | Record that a note was checked, by the user or against its sources |
| `link_notes` | Mark a note as replacing an older one, or as conflicting with another |
| `check_up` | List notes that need attention, in every notebook |
| `list_notebooks` | List notebooks, with note counts, main types, and which were received |

Tools refer to notes as `notebook/file`, like `general/writing-style.md`. A file name alone works when only one notebook has that file.

## Notebooks

A notes folder is a **library** of **notebooks**. Each notebook is an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundle, meaning a flat folder of notes with its own `index.md` and `log.md`, so any notebook can be used, sent, or validated on its own.

```
KnowledgeX/                 the library
  index.md                  generated list of notebooks
  .knowledgex.json          confirmations made in this library, and which notebooks were received
  general/                  the default notebook
  acme-case/
```

- **Add a notebook** by copying its folder into the library, or with `kx add FOLDER [--name NAME]`, which also checks it and refuses names already taken. It is picked up on the next tool call.
- **Share a notebook** by copying its folder. `.knowledgex.json` stays behind.
- **Trust doesn't travel with copies.** A confirmation counts only if it was made in this library and is recorded in `.knowledgex.json`. Confirmations that came with a copied notebook are still shown, but its notes count as unconfirmed until confirmed here. Losing `.knowledgex.json` has the same effect on every notebook. A bundle used directly with `--bundle` has no library, so its confirmations count as written.
- **Pick a notebook per project** in the project's instructions (a Claude Desktop Project, `AGENTS.md`, or `CLAUDE.md`): *Use the KnowledgeX notebook acme-case.*
- **Hard boundary:** a connection with `KX_NOTEBOOK` set only sees that notebook, for example:

```bash
claude mcp add knowledgex-acme --env KX_NOTEBOOK=acme-case -- npx -y knowledgex mcp
```

---

## Install the command line

```bash
npm install -g knowledgex
```

Create your notes folder (a library with a `general` notebook) and make it the default:

```bash
kx init ~/KnowledgeX
```

Run `kx --help` at any time for the list of commands.

---

## Set up agents that run shell commands

**Agents that support Agent Skills.** Install the guide as a skill in your agent's skills folder. For Claude Code:

```bash
kx install-skill ~/.claude/skills
```

**Agents that read an instructions file** (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or an editor rules file). Add:

```markdown
## Long-term knowledge (KnowledgeX)
Durable knowledge is kept in KnowledgeX notebooks, managed with the `kx` command.
- Before answering questions that depend on earlier decisions, preferences, lessons, people, or plans, run `kx search <words>` (add `--notebook NAME` for a notebook other than general).
- Before saving anything, and at the end of substantial conversations, run `kx guide` and follow it.
```

**Chat apps with no MCP or shell access.** Paste the output of `kx guide all` into the app's custom instructions. The AI will follow the rules, but it can't read or write your notes folder directly.

---

## Command reference

| Command | What it does |
|---|---|
| `kx init FOLDER` | Create a notes folder (a library with a `general` notebook) and make it the default |
| `kx guide [overview\|what\|write\|retrieve\|maintain\|all]` | Print the agent guide (default: `overview`) |
| `kx new TYPE "Title" --description TEXT --by ID [--tags a,b] [--status draft] [--source id=URL]` | Create a note from its type's template and print its path; repeat `--source` for several sources. Needs `--notebook` when there is more than one notebook |
| `kx touch FILE --by ID [--message TEXT]` | Record that a note's content changed |
| `kx verify FILE --by ID` | Record that a note was checked; restarts its expiry window |
| `kx relate FILE supersedes FILE --by ID` | Mark a note as replacing another; the older note is retired |
| `kx relate FILE contradicts FILE --by ID` | Mark a known conflict between two notes |
| `kx search [words] [--type TYPE] [--all]` | Find notes, with trust and freshness; `--all` includes retired notes |
| `kx check` | Validate a notebook; exits with an error if any note is invalid |
| `kx review` | List maintenance work: stale, unconfirmed, conflicting, drafts |
| `kx index` | Rebuild a notebook's `index.md` |
| `kx notebooks` | List notebooks |
| `kx notebooks create NAME` | Start a new notebook |
| `kx add FOLDER [--name NAME]` | Copy a notebook someone sent into the library; its notes start unconfirmed |
| `kx install-skill FOLDER` | Write KnowledgeX as an Agent Skill into a skills folder |
| `kx mcp` | Run the MCP server |

**Options that apply to most commands**

- **`--notebook NAME`** picks the notebook to work on. The default is `KX_NOTEBOOK`, then `general`. The library comes from `KX_BUNDLE`, then from `kx init`, which saves it in `~/.config/knowledgex/config.json` (or under `$XDG_CONFIG_HOME`).
- **`--bundle FOLDER`** works on any OKF bundle directly, inside a library or not.
- **`--by ID`** says who is acting:
    - `<agent>/<model>` for an AI agent, for example `claude-code/claude-opus-5`;
    - `human:<name>` for a person, for example `human:alex`;
    - `process:<name>` for a scheduled job.

**Note types**

`Decision`, `Preference`, `Principle`, `Lesson`, `Concept`, `Entity`, `Person`, `Playbook`, `Plan`, `Idea`, `Source`, `Timeline`. The [how to write](../guides/how-to-write.md) guide explains each type, its expiry, and the note format.

---

## What's in a notebook

- **Notes:** one markdown file per note, named like `use-postgresql-as-the-job-queue.md`, in the [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).
- **`index.md`:** the list of notes by type, rebuilt automatically.
- **`log.md`:** a dated record of every change.

Each notebook folder is flat and plain text, so it works with any markdown editor, with git, and with other OKF tools.
