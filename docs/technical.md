# Technical guide

For connecting KnowledgeX to AI apps other than Claude Desktop, using it from the command line, or setting it up for coding agents. If you use Claude Desktop, you don't need any of this: see the [walkthrough](walkthrough.md).

Everything here needs [Node.js](https://nodejs.org) 22 or newer.

---

## Connect an AI app over MCP

Any app that supports MCP servers can use KnowledgeX. The server gives the AI eight tools and the key rules, so there's nothing else to set up.

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
| `KX_BUNDLE` | The notes folder | The folder set with `kx init`, otherwise `~/Documents/KnowledgeX` |
| `KX_USER` | Your name, recorded when you confirm a note | `user` |

The folder is created on first use. If it already contains other files and isn't a KnowledgeX folder, notes go in a `KnowledgeX` folder inside it.

### Tools

| Tool | What it does |
|---|---|
| `read_guide` | Read the rules: what to keep, how to write, how to look things up, how to maintain notes |
| `search_notes` | Find notes, with whether each was confirmed and whether it's out of date |
| `read_note` | Read one note in full, with its sources and history of checks |
| `save_note` | Save a new note the user approved |
| `update_note` | Change a note the user approved changing (decisions can't be edited) |
| `confirm_note` | Record that a note was checked, by the user or against its sources |
| `link_notes` | Mark a note as replacing an older one, or as conflicting with another |
| `check_up` | List notes that need attention |

---

## Install the command line

```bash
npm install -g knowledgex
```

Create your notes folder and make it the default:

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
Durable knowledge is kept in a KnowledgeX bundle, managed with the `kx` command.
- Before answering questions that depend on earlier decisions, preferences, lessons, people, or plans, run `kx search <words>`.
- Before saving anything, and at the end of substantial conversations, run `kx guide` and follow it.
```

**Chat apps with no MCP or shell access.** Paste the output of `kx guide all` into the app's custom instructions. The AI will follow the rules, but it can't read or write your notes folder directly.

---

## Command reference

| Command | What it does |
|---|---|
| `kx init FOLDER` | Create a notes folder (bundle) and make it the default |
| `kx guide [overview\|what\|write\|retrieve\|maintain\|all]` | Print the agent guide (default: `overview`) |
| `kx new TYPE "Title" --description TEXT --by ID [--tags a,b] [--status draft] [--source id=URL]` | Create a note from its type's template and print its path; repeat `--source` for several sources |
| `kx touch FILE --by ID [--message TEXT]` | Record that a note's content changed |
| `kx verify FILE --by ID` | Record that a note was checked; restarts its expiry window |
| `kx relate FILE supersedes FILE --by ID` | Mark a note as replacing another; the older note is retired |
| `kx relate FILE contradicts FILE --by ID` | Mark a known conflict between two notes |
| `kx search [words] [--type TYPE] [--all]` | Find notes, with trust and freshness; `--all` includes retired notes |
| `kx check` | Validate the folder; exits with an error if any note is invalid |
| `kx review` | List maintenance work: stale, unconfirmed, conflicting, drafts |
| `kx index` | Rebuild `index.md` |
| `kx install-skill FOLDER` | Write KnowledgeX as an Agent Skill into a skills folder |
| `kx mcp` | Run the MCP server |

**Options that apply to most commands**

- **`--bundle FOLDER`** uses a notes folder other than the default. The default comes from `KX_BUNDLE`, then from `kx init`, which saves it in `~/.config/knowledgex/config.json` (or under `$XDG_CONFIG_HOME`).
- **`--by ID`** says who is acting:
    - `<agent>/<model>` for an AI agent, for example `claude-code/claude-opus-5`;
    - `human:<name>` for a person, for example `human:alex`;
    - `process:<name>` for a scheduled job.

**Note types**

`Decision`, `Preference`, `Principle`, `Lesson`, `Concept`, `Entity`, `Person`, `Playbook`, `Plan`, `Idea`, `Source`, `Timeline`. The [how to write](../guides/how-to-write.md) guide explains each type, its expiry, and the note format.

---

## What's in a notes folder

- **Notes:** one markdown file per note, named like `use-postgresql-as-the-job-queue.md`, in the [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).
- **`index.md`:** the list of notes by type, rebuilt automatically.
- **`log.md`:** a dated record of every change.

The folder is flat and plain text, so it works with any markdown editor, with git, and with other OKF tools.
