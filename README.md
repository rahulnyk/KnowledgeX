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

KnowledgeX isn't tied to Claude. Any AI app that supports MCP servers can connect with `npx -y knowledgex mcp`, and the `kx` command line (`npm install -g knowledgex`) works for scripts and for coding agents that run shell commands.

The [technical guide](docs/technical.md) covers setup for other AI apps and coding agents, settings, and the full command reference.

## How it works

- **The notes folder is an OKF bundle:** one markdown file per note, plus an index and a change log. Every note records who wrote it, who confirmed it, where its facts came from, and when it goes out of date.
- **The agent guides** tell the AI what's worth keeping, how to write it, how to look things up, and how to keep notes current. Read them in [`guides/`](guides/).
- **The MCP server and `kx` command** do the bookkeeping, so notes stay consistent whichever AI writes them.

The notes are ordinary markdown files, so you can also browse them in Obsidian, VS Code, or any markdown editor.

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
git tag v0.2.0 && git push origin v0.2.0
```

A tag with a suffix, such as `v0.3.0-rc.1` (with the same version in the three files), is published as a pre-release on GitHub and under npm's `next` tag, so the download links and `npm install knowledgex` keep pointing at the last stable version.

## License

[MIT](LICENSE)
