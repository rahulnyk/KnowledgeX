# KnowledgeX

**A personal knowledge library you and your AI build together.**

What you know ends up scattered: in chat histories that disappear, in notes you never reread, and in your own head. AI assistants don't fix that. They start from nothing every conversation, or they save everything until the pile is too unreliable to use.

KnowledgeX gives you both one library to work from. At the end of a conversation, your AI offers what's worth keeping, such as a decision and the reason for it, a preference, a lesson, or a person you work with, and saves only what you approve. Each note links to the ones it relates to, so the library grows into a knowledge graph of what you know, one conversation at a time.

It's plain markdown in a folder on your computer. Read, edit and rearrange it in any editor, such as Obsidian; your AI reads and writes the same files. When it answers from a note, it says which note, whether you confirmed it, and whether it might be out of date.

> **Status:** early (v0.3). Things may still change.

## How it works, in pictures

![Why KnowledgeX — one notebook, both of you](https://raw.githubusercontent.com/rahulnyk/KnowledgeX/main/assets/readme/01-why.png)

![Setting it up — three clicks, then just talk](https://raw.githubusercontent.com/rahulnyk/KnowledgeX/main/assets/readme/02-setup.png)

![What to expect — it asks first, always](https://raw.githubusercontent.com/rahulnyk/KnowledgeX/main/assets/readme/03-what-to-expect.png)

## Get started

KnowledgeX works with any AI app that can run a local MCP server (MCP is the standard way to give an AI new tools). Find your app below. After setup, talk to your AI as usual; see [what using it looks like](#what-using-it-looks-like).

- **Claude Desktop** needs nothing else installed.
- **Every other app** runs KnowledgeX with [Node.js](https://nodejs.org). Install version 22 or newer first; the installer from the website is the easiest way.

Your notes go in a `KnowledgeX` folder in your Documents. To use a different folder, set `KX_BUNDLE` in the app's MCP settings; the [technical guide](docs/technical.md#settings) shows how.

### Desktop AI apps

**Claude Desktop** (Mac and Windows)

1. **Download** [KnowledgeX.mcpb](https://github.com/rahulnyk/KnowledgeX/releases/latest/download/KnowledgeX.mcpb).
2. **Double-click the downloaded file.** Claude Desktop opens an install screen. Click **Install**. You can pick a different notes folder on that screen.
3. **Start a new chat.** The [walkthrough](docs/walkthrough.md) shows what to expect, step by step.

**ChatGPT desktop app**

1. Open **Settings → MCP servers → Add server**.
2. Name it `KnowledgeX` and choose **STDIO**.
3. Enter the command `npx`, with the arguments `-y knowledgex mcp`.
4. Save, then select **Restart**.

This setup is shared with Codex, so KnowledgeX also works in the Codex CLI and IDE extension.

**Perplexity** (Mac)

1. In **Settings → Connectors**, install the Perplexity helper app when asked. It lets Perplexity run local servers.
2. Select **Add Connector** and stay on the **Simple** tab.
3. Name it `KnowledgeX`, enter the command `npx -y knowledgex mcp`, and save.

**Gemini desktop app**

Google has announced custom MCP support for Gemini Spark in the Gemini app for Mac, in beta for Google AI Ultra subscribers in the US. We haven't yet confirmed whether it can run local servers like KnowledgeX. Until then, Gemini users can use KnowledgeX through [Gemini CLI](#coding-tools).

### Coding tools

**Windsurf, Cursor, and Gemini CLI.** Add KnowledgeX to the app's MCP settings file:

| App        | Settings file                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Windsurf   | `~/.codeium/windsurf/mcp_config.json` (also opens from the **MCPs** icon in the Cascade panel) |
| Cursor     | `~/.cursor/mcp.json`                                                                           |
| Gemini CLI | `~/.gemini/settings.json`                                                                      |

```json
{
    "mcpServers": {
        "knowledgex": {
            "command": "npx",
            "args": ["-y", "knowledgex", "mcp"]
        }
    }
}
```

If the file already exists, add the `mcpServers` section to it, or just the `knowledgex` entry if `mcpServers` is already there.

**Code Puppy.** Add KnowledgeX to `~/.code_puppy/mcp_servers.json`, then run `/mcp start knowledgex` in Code Puppy:

```json
{
    "mcp_servers": {
        "knowledgex": {
            "type": "stdio",
            "command": "npx",
            "args": ["-y", "knowledgex", "mcp"]
        }
    }
}
```

**VS Code (GitHub Copilot).** Run **MCP: Open User Configuration** from the Command Palette, and add:

```json
{
    "servers": {
        "knowledgex": {
            "type": "stdio",
            "command": "npx",
            "args": ["-y", "knowledgex", "mcp"]
        }
    }
}
```

**Claude Code:**

```bash
claude mcp add --scope user knowledgex -- npx -y knowledgex mcp
```

**Codex CLI** (also adds it to the ChatGPT desktop app):

```bash
codex mcp add knowledgex -- npx -y knowledgex mcp
```

### Any other app

Any app that can run a local MCP server can use KnowledgeX with the command `npx -y knowledgex mcp`. For apps without MCP, coding agents that run shell commands, and the `kx` command line, see the [technical guide](docs/technical.md).

## Make it automatic

After setup, KnowledgeX already works: the tools are there in every chat, your AI offers what's worth keeping at the end of a conversation, and "remember this" or "what did we decide about X?" always works.

One habit is worth making explicit, because it's the quiet one. Unless your AI is told to, it may answer a question from the conversation alone and never look at your notes. Add this to your AI's standing instructions (in Claude Desktop, **Settings → Profile → personal preferences**, which applies to every chat):

```
I use KnowledgeX as my knowledge library. Before answering anything that depends on my earlier decisions, preferences, people, plans or lessons, search my notes first. At the end of a substantial conversation, tell me what's worth keeping, and save only what I approve.
```

**Working on one client or project?** Notes can live in their own notebook. Name it in that project's instructions, such as a Claude Project or a `CLAUDE.md` or `AGENTS.md` file in a repository:

```
Use the KnowledgeX notebook acme-case for this project. Search it before answering questions about this client, and save new notes there.
```

To go further and keep a connection to a single notebook, so nothing else is visible to it, see `KX_NOTEBOOK` in the [technical guide](docs/technical.md#settings).

## What using it looks like

**Keeping something.** At the end of a useful conversation, your AI offers:

> I'd keep two things: your decision to review liability clauses before payment terms, and why; and that the client prefers updates by email, not calls. I'd skip the draft wording we went back and forth on. Save these?

Say yes, "only the first", or no. If nothing is worth keeping, it won't ask. You can also just say _"remember this"_.

**Asking later.**

> **You:** How do we usually review supplier contracts?
>
> **Your AI:** Liability and indemnity first, then termination, then payment terms. That's from your note "Contract review order", which you confirmed in March.

**Confirming.** When your AI saves a note, it asks whether it's right. Say yes, and the note is marked as confirmed by you. If the note is changed later, it needs confirming again.

**Changing your mind.** Tell your AI, and it saves the new decision and marks the old one as replaced. It never silently edits a past decision, so you keep the history.

**A check-up.** Ask _"Do any of my notes need attention?"_ Your AI lists notes that may be out of date, conflict with each other, or were never confirmed, and suggests fixes.

**Notebooks.** Keep a client or project in its own notebook: say _"start a notebook for the Acme case."_ Everything else goes in the `general` notebook. To share a notebook, send its folder. To add one you received, drop the folder into your notes folder. Notes someone else confirmed start unconfirmed for you, until you confirm them yourself.

## Your notes and your privacy

- **Notes stay on your computer**, as plain text files in the folder you chose. You can open, read, back up, or delete them like any other files.
- **KnowledgeX itself never connects to the internet.**
- **When your AI uses a note, the note's text becomes part of your conversation**, so it's handled like anything else you type into that app.
- **Your AI is instructed never to save passwords or account numbers**, and to ask before saving confidential client or personal information.

## Technical users

The `kx` command line (`npm install -g knowledgex`) works for scripts and for coding agents that run shell commands. The [technical guide](docs/technical.md) covers it, along with settings, agent skills, and the full command reference.

## How it works

- **The notes folder holds notebooks, and each notebook is an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundle:** one markdown file per note, plus an index and a change log. Every note records who wrote it, who confirmed it, where its facts came from, and when it goes out of date.
- **The agent guides** tell the AI what's worth keeping, how to write it, how to look things up, and how to keep notes current. Read them in [`guides/`](guides/).
- **The MCP server and `kx` command** do the bookkeeping, so notes stay consistent whichever AI writes them.

The notes are ordinary markdown files, so you can also browse them in Obsidian, VS Code, or any markdown editor, and edit them there. A note you edit yourself counts as confirmed by you.

## Learn more

- [Walkthrough](docs/walkthrough.md): step by step, from install to your first notes
- [Technical guide](docs/technical.md): other AI apps, coding agents, and the `kx` command reference
- [Design](docs/design.md): goals, architecture, decisions, and roadmap
- [Judgment evals](evals/README.md): how we measure whether an AI keeps the right things

## Contributing

Issues and pull requests are welcome. You need Node.js 22 or newer and [pnpm](https://pnpm.io). Running `corepack enable` once gives you the exact pnpm version the project uses.

```bash
pnpm install
```

```bash
pnpm test
```

To build the Claude Desktop extension (`KnowledgeX.mcpb`):

```bash
pnpm run pack:mcpb
```

Changes to the guides should be checked against the [judgment evals](evals/README.md). New eval cases are especially welcome.

Tests run automatically on every pull request, on macOS, Windows, and Linux.

**Releasing.** Set the new version in `package.json`, `manifest.json`, and `VERSION` in `src/bundle.ts` (the tests check they match), merge to `main`, then tag and push. The release workflow publishes the package to npm (with provenance, through trusted publishing, so no npm token is stored) and publishes `KnowledgeX.mcpb` as a GitHub release, which the download links in this README point to. Re-running a failed release skips the steps that already succeeded.

```bash
git tag v0.3.0 && git push origin v0.3.0
```

A tag with a suffix, such as `v0.3.0-rc.1` (with the same version in the three files), is published as a pre-release on GitHub and under npm's `next` tag, so the download links and `npm install knowledgex` keep pointing at the last stable version.

## License

[MIT](LICENSE)
