# Walkthrough

This guide takes you from nothing to a working KnowledgeX setup in about 15 minutes. No programming experience is needed; you'll copy a few commands into a terminal.

**What you'll end up with:** a folder of notes that your AI agent keeps. It holds only what's worth remembering, and every note shows how much it can be trusted.

---

## 1. The idea in one minute

Imagine a careful assistant who takes notes for you. They don't write down everything you say. At the end of a meeting, they say:

> "I'd keep two things: we chose PostgreSQL for the job queue, and we'd revisit that if volume grows a lot. I'm skipping the benchmark numbers; they were from a laptop. OK?"

Months later, when you ask "why did we pick PostgreSQL?", they find the note, tell you the reason, and add: "you confirmed this in March."

KnowledgeX teaches your AI agent to be that assistant.

Three words you'll see:

- **Bundle**: the folder where notes live.
- **Note**: one markdown file about one thing (a decision, a person, a lesson…).
- **`kx`**: the small command-line tool that manages the bundle.

---

## 2. Install

### Open a terminal

- **macOS:** open *Terminal* (in Applications → Utilities).
- **Windows:** open *PowerShell* from the Start menu.
- **Linux:** open your terminal app.

### Install uv

uv is a tool that installs Python programs, and Python itself if you need it.

macOS and Linux:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Windows:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Close the terminal and open a new one, so it picks up the new command.

### Install KnowledgeX

Install it straight from GitHub:

```bash
uv tool install git+https://github.com/rahulnyk/KnowledgeX
```

If you've downloaded the repository instead (for example with **Code → Download ZIP** on its GitHub page), install from that folder: `uv tool install ./KnowledgeX`.

Check it worked:

```bash
kx --version
```

You should see something like `kx 0.1.0`.

> **Stuck?** Ask your AI agent: "Install KnowledgeX from this repository for me." Agents that can run commands can do these steps.

---

## 3. Create your bundle

Pick a folder for your knowledge. A new, empty folder is best.

```bash
kx init ~/KnowledgeX
```

This creates the folder with two files:

- `index.md`: a list of your notes, grouped by type (empty for now)
- `log.md`: a record of every change

> **Using Obsidian?** You can put the bundle inside your vault, for example `kx init ~/MyVault/KnowledgeX`. In Obsidian, go to *Settings → Files & links*, turn off **Use [[Wikilinks]]**, and set **New link format** to **Relative path to file**. Links you add by hand will then work in every tool, not just Obsidian.

---

## 4. Connect your AI agent

Your agent needs to know that KnowledgeX exists and how to use it. Pick the option that matches your agent.

### Option A: agents that support Agent Skills

A skill is a folder of instructions the agent loads when it's relevant. For Claude Code:

```bash
kx install-skill ~/.claude/skills
```

For other agents, find their "skills folder" in their documentation and use that path instead.

### Option B: agents that read an instructions file

Many coding agents read a file such as `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`, or a rules file in your editor. Add this to it:

```markdown
## Long-term knowledge (KnowledgeX)
Durable knowledge is kept in a KnowledgeX bundle, managed with the `kx` command.
- Before answering questions that depend on earlier decisions, preferences, lessons, people, or plans, run `kx search <words>`.
- Before saving anything, and at the end of substantial conversations, run `kx guide` and follow it.
```

### Option C: chat apps without access to your computer

Print the full guide:

```bash
kx guide all
```

Copy the output into the app's custom instructions or project instructions. The agent will then decide well what's worth keeping and write notes in the right format, but you'll need to copy notes into your bundle yourself.

---

## 5. Your first notes

Have a normal conversation with your agent about something real: a plan, a choice, a problem you solved.

At a natural stopping point, the agent should offer something like:

> Worth keeping: (1) **Decision**: use PostgreSQL as the job queue, revisit if volume passes 1,000 jobs per hour. (2) **Lesson**: benchmark on production-like machines. Skipping: laptop benchmark numbers, the setup troubleshooting. Save these?

If it doesn't offer, ask: *"Is anything from this conversation worth keeping?"*

Say yes (or "only the first one"). The agent creates the notes. Open your bundle folder and look. A note looks like this:

```markdown
---
type: Decision
title: Use PostgreSQL as the job queue
description: Jobs live in PostgreSQL until volume needs a dedicated queue.
status: stable
created: 2026-03-02
generated:
  by: my-agent/1.0
  at: 2026-03-02T10:15:00Z
---

_Chosen in March 2026 when job volume was under 1,000 per hour._

## Decision
- Keep background jobs in the existing PostgreSQL database.

## Why
- Volume is low, and it avoids running a new service.

## Alternatives considered
- A dedicated queue product: more to operate than this volume needs.

## Reversal conditions
- Sustained volume above 1,000 jobs per hour, or job delays users notice.
```

The block between the `---` lines is the note's **metadata**. It records what kind of note this is, who wrote it, and when.

**Don't expect many notes.** Most conversations produce nothing worth keeping, and that's by design. A small bundle you can trust beats a big one you can't.

---

## 6. Ask your agent to remember

In a later conversation, ask:

> What did we decide about the job queue, and why?

The agent searches the bundle and answers with the source:

> You're keeping jobs in PostgreSQL because volume is low and it avoids a new service (*Use PostgreSQL as the job queue*, unverified, no expiry). You planned to revisit if volume passes 1,000 jobs per hour.

That "unverified" is important. It means nobody has confirmed the note yet. Which brings us to…

---

## 7. Confirm the notes you trust

When you've read a note and it's right, tell your agent *"that note is correct"*, or record it yourself:

```bash
kx verify use-postgresql-as-the-job-queue.md --by human:alex
```

Use your own name after `human:`. The note is now **human-reviewed**.

Three trust levels:

| Level | Meaning |
|---|---|
| **unverified** | Nobody has checked it yet |
| **machine-confirmed** | An agent checked it against its sources |
| **human-reviewed** | A person confirmed it |

Two rules keep this honest:

- If a note is **edited after it was checked**, it goes back to unverified until someone checks it again.
- Agents only **act** on their own (as opposed to just answering) based on human-reviewed decisions, preferences, principles, and playbooks. For anything else, they ask you first.

---

## 8. When you change your mind

Decisions aren't edited; they're **replaced**, so you keep the history. Tell your agent *"we're switching to a dedicated queue"*. It will propose a new decision note and link it to the old one. By hand:

```bash
kx new Decision "Use a dedicated job queue" --description "Jobs move to a dedicated queue service." --by human:alex
```

```bash
kx relate use-a-dedicated-job-queue.md supersedes use-postgresql-as-the-job-queue.md --by human:alex
```

The old note is marked **deprecated**. Searches now show the new decision, and the old one is still there if you ask for history (`kx search queue --all`).

---

## 9. Keep it healthy

Facts go stale: prices change, people change roles, tools get replaced. Once a week or so, run:

```bash
kx review
```

It lists notes that need attention:

- **Stale**: past their "check again" date
- **Edited since last verified**: changed after someone checked them
- **Open contradictions**: two notes that disagree
- **Drafts** and **never verified** notes

The easiest way to handle the list is to ask your agent: *"Run KnowledgeX maintenance."* It reads the maintenance guide, re-checks sources, and gives you a short checklist of proposed fixes to approve.

To catch formatting mistakes (for example after editing notes by hand):

```bash
kx check
```

---

## 10. Editing notes yourself

Notes are just text files, so edit them in any editor. After changing a note's content, record the change:

```bash
kx touch use-postgresql-as-the-job-queue.md --by human:alex --message "clarified the threshold"
```

Then run `kx check`.

A few rules if you edit by hand:

- Link to other notes with normal markdown links: `[Job queue decision](use-postgresql-as-the-job-queue.md)`.
- Keep all notes directly in the bundle folder, not in subfolders.
- Don't hand-edit `index.md`; it's rebuilt automatically.

---

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| `kx: command not found` | Open a new terminal. If it still fails, run `uv tool update-shell` and open a new terminal again. |
| `No bundle yet` | Run `kx init <folder>` first. |
| The agent never proposes notes | Check it's connected (step 4). You can always ask: "Is anything worth keeping?" |
| The agent saves too much | Tell it to follow the gates in `kx guide what` strictly. Delete notes you don't want. |
| `kx check` reports errors | Each line names the file and the problem. Fix it, or ask your agent to. |
| I want a second bundle (e.g. work and personal) | Create it with `kx init <other-folder>`, which makes it the new default. Or keep your default and pass `--bundle <folder>` to use the other one. |

---

## Where next

- Read the agent guides to see exactly what your agent is told: `kx guide all`
- Read the [design document](design.md) for the reasoning and the roadmap
