# KnowledgeX

**A memory for your AI that keeps what matters, and nothing else.**

AI assistants forget everything when a conversation ends. The usual fixes go too far the other way: they save everything, and before long the "memory" is a pile of outdated fragments nobody trusts.

KnowledgeX works like a careful assistant taking notes. At the end of a conversation, Claude suggests what's worth keeping, such as a decision and the reason for it, a preference, a lesson, or a person you work with. It saves only what you approve. Later, when you ask about it, Claude tells you what it knows and how far to trust it: whether you confirmed it, and whether it might be out of date.

Your notes are plain text files in a folder on your computer.

> **Status:** early (v0.2). Things may still change.

## Get started in Claude Desktop

You need [Claude Desktop](https://claude.ai/download) for Mac or Windows. There's nothing else to install.

1. **Download** [KnowledgeX.mcpb](https://github.com/rahulnyk/KnowledgeX/releases/latest/download/KnowledgeX.mcpb).
2. **Double-click the downloaded file.** Claude Desktop opens an install screen. Click **Install**. Your notes will be kept in a `KnowledgeX` folder in your Documents; you can pick a different folder on that screen.
3. **Start a new chat** and talk to Claude as usual.

That's it. The [walkthrough](docs/walkthrough.md) shows what to expect, step by step.

## What using it looks like

**Keeping something.** At the end of a useful conversation, Claude offers:

> I'd keep two things: your decision to review liability clauses before payment terms, and why; and that the client prefers updates by email, not calls. I'd skip the draft wording we went back and forth on. Save these?

Say yes, "only the first", or no. If nothing is worth keeping, Claude won't ask. You can also just say *"remember this"*.

**Asking later.**

> **You:** How do we usually review supplier contracts?
>
> **Claude:** Liability and indemnity first, then termination, then payment terms. That's from your note "Contract review order", which you confirmed in March.

**Confirming.** When Claude saves a note, it asks whether it's right. Say yes, and the note is marked as confirmed by you. If the note is changed later, it needs confirming again.

**Changing your mind.** Tell Claude, and it saves the new decision and marks the old one as replaced. It never silently edits a past decision, so you keep the history.

**A check-up.** Ask *"Do any of my notes need attention?"* Claude lists notes that may be out of date, conflict with each other, or were never confirmed, and suggests fixes.

## Your notes and your privacy

- **Notes stay on your computer**, as plain text files in the folder you chose. You can open, read, back up, or delete them like any other files.
- **KnowledgeX itself never connects to the internet.**
- **When Claude uses a note, the note's text becomes part of your conversation**, so it's handled like anything else you type to Claude.
- **Claude is instructed never to save passwords or account numbers**, and to ask before saving confidential client or personal information.

## Other AI apps and technical users

KnowledgeX isn't tied to Claude. The notes use the open [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), and any AI app that supports MCP servers can connect. These options need [Node.js](https://nodejs.org) 18 or newer.

**Apps with MCP settings** (for example Cursor or VS Code). Add the server to the app's MCP configuration:

```json
{
  "mcpServers": {
    "knowledgex": {
      "command": "npx",
      "args": ["-y", "github:rahulnyk/KnowledgeX", "mcp"],
      "env": { "KX_BUNDLE": "/path/to/your/notes" }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add knowledgex -- npx -y github:rahulnyk/KnowledgeX mcp
```

**The `kx` command line**, for scripts and for agents that run shell commands:

```bash
npm install -g github:rahulnyk/KnowledgeX
```

```bash
kx init ~/KnowledgeX
```

Agents that support Agent Skills can load the guide with `kx install-skill <skills-folder>`. Agents that read an instructions file (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) can use this snippet:

```markdown
## Long-term knowledge (KnowledgeX)
Durable knowledge is kept in a KnowledgeX bundle, managed with the `kx` command.
- Before answering questions that depend on earlier decisions, preferences, lessons, people, or plans, run `kx search <words>`.
- Before saving anything, and at the end of substantial conversations, run `kx guide` and follow it.
```

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
| `kx review` | List notes that need attention |
| `kx index` | Rebuild the list of notes |
| `kx install-skill FOLDER` | Install KnowledgeX as an Agent Skill |
| `kx mcp` | Run the MCP server |

`--by` says who is acting: `human:<name>`, `<agent>/<model>`, or `process:<name>`. To use a folder other than your default, add `--bundle FOLDER` or set `KX_BUNDLE`.

## How it works

- **The notes folder is an OKF bundle:** one markdown file per note, plus an index and a change log. Every note records who wrote it, who confirmed it, where its facts came from, and when it goes out of date.
- **The agent guides** tell the AI what's worth keeping, how to write it, how to look things up, and how to keep notes current. Read them in [`guides/`](guides/).
- **The MCP server and `kx` command** do the bookkeeping, so notes stay consistent whichever AI writes them.

The notes are ordinary markdown files, so you can also browse them in Obsidian, VS Code, or any markdown editor.

## Learn more

- [Walkthrough](docs/walkthrough.md): step by step, from install to your first notes
- [Design](docs/design.md): goals, architecture, decisions, and roadmap
- [Judgment evals](evals/README.md): how we measure whether an AI keeps the right things

## Contributing

Issues and pull requests are welcome. You need Node.js 18 or newer.

```bash
npm install
```

```bash
npm test
```

To build the Claude Desktop extension (`KnowledgeX.mcpb`):

```bash
npm run pack:mcpb
```

Changes to the guides should be checked against the [judgment evals](evals/README.md). New eval cases are especially welcome.

## License

[MIT](LICENSE)
