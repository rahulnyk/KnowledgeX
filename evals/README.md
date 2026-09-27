# Judgment evals

KnowledgeX lives or dies on judgment: an agent that saves the wrong things makes the library worse, not better, and an agent that never looks at it might as well not have one. These evals measure both.

- **What to keep:** a case gives an agent a finished conversation and the guide, and checks what it proposes to keep.
- **Retrieval:** a case gives an agent a question the user's notes can answer, and checks whether it searches before answering.
- **When to offer:** a case stops a conversation at the user's latest message, and checks whether the agent offers to save something then, in one line at the end of its reply, or rightly stays quiet.

They work with **any agent** that can take a prompt and reply in text.

## What a case tests

Most cases in [`cases/`](cases/) are a short, fictional conversation plus the answer key:

- **expect**: notes the agent should propose, with the right note type, the right action (`new`, `update`, `supersede`, `contradict`), and the key details that must be in them
- **optional**: notes that are reasonable to propose but not required
- **avoid**: things the agent must not keep, such as timestamps, prices, error output, secrets, or a duplicate of an existing note
- **bundle**: notes that already exist, for cases about updating, superseding, or flagging conflicts
- **reference**: a hand-written ideal answer, used to validate the case itself

The 20 keeping cases cover decisions, lessons, playbooks, entities, people, preferences, plans, timelines, and sources. They also include updating, superseding, and flagging conflicts with existing notes, avoiding duplicates, keeping secrets out, and five conversations where **nothing** should be kept.

### Retrieval cases

A case with `kind: retrieve` asks a question instead: the user says something ordinary, such as "I need to get this week's progress update to Meridian. How should I send it?", and the answer lives in a note. **The notes are not in the prompt** — finding them is the point. The agent is told it can call `search_notes` and `read_note`, and replies with the calls it would make and what it would say.

- **expect**: the lookup the agent should make, matched against its tool calls and queries
- **avoid**: specifics in the answer that it could only know by reading a note, which catch an agent answering from general knowledge or a guess
- **bundle**: the notes that exist, used to write the case and to check the answer key

These cases score three things: whether the agent looked before answering, whether it searched for the right thing, and whether it answered from nowhere.

### Offer cases

A case with `kind: offer` stops partway through a conversation, on a user turn. The agent sees what an AI app shows it (the KnowledgeX instructions and the `read_guide` and `save_note` descriptions) plus the guides, and writes its next reply. The offer is found in that reply, the way the user would see it: from the first sentence that asks to keep something, such as "Worth keeping: …" or "Save it?", to the end.

- **expect**: what the offer should name. Leave it out when the right move is to say nothing, and any offer fails.
- **avoid**: things the offer must not hold, such as a detail of this task only, or something already offered and passed over
- **reference**: a hand-written ideal `reply`

An offer also fails if it isn't one line or isn't the last thing in the reply. The cases cover offering a decision, a preference, a correction and a lesson as they settle mid-conversation; staying quiet on lookups and unsettled ideas; not repeating an offer the user passed over; and, at the end of a conversation, proposing what was passed over but never what the user declined.

**Does telling the AI to search help?** The README suggests a line for an assistant's standing instructions. Add `--reminder` to put that line in the retrieval and offer prompts, and compare two runs:

```bash
pnpm evals run --agent "cd /tmp && claude -p" --case client-update-channel-lookup --case supplier-contract-order-lookup
```

```bash
pnpm evals run --agent "cd /tmp && claude -p" --case client-update-channel-lookup --case supplier-contract-order-lookup --reminder
```

The report says which mode it ran in, so the two are easy to tell apart.

## Run it

You need [Node.js](https://nodejs.org) 22 or newer and [pnpm](https://pnpm.io), with `pnpm install` run once in the repository.

**Validate the cases** (no agent needed):

```bash
pnpm evals check
```

**Run every case through an agent.** `--agent` is any command that reads the prompt on standard input and prints the reply:

```bash
pnpm evals run --agent "claude -p"
```

```bash
pnpm evals run --agent "ollama run llama3.1"
```

If your agent takes a file instead of standard input, put `{prompt_file}` in the command, and it will be replaced with the prompt's path. Use `--case <id>` to run a single case, and `--jobs` to change how many run at once (default 4).

Tips:

- **Run agents from a neutral folder**, so project instructions or memory don't leak into the results, e.g. `--agent "cd /tmp && claude -p"`.
- **Run from a normal terminal**, not from inside an agent session, and not from a terminal inside an AI app. Some agent CLIs refuse to start inside their own session, and an app may set variables its own child processes rely on. The Claude Code desktop app sets `ANTHROPIC_BASE_URL`, which a `claude -p` started from its terminal inherits, so every case fails to authenticate. Either use Terminal or iTerm, or drop the variables in the agent command: `--agent "cd /tmp && env -u ANTHROPIC_BASE_URL -u CLAUDECODE claude -p"`.
- **Local models need room.** Prompts are about 4,000 tokens, which is more than some local runtimes allow by default, so the guide can be silently cut off. Give the model a context window of at least 8,000 tokens; with Ollama, set `OLLAMA_CONTEXT_LENGTH=8192` when starting the server.

**Chat apps with no command line.** Write the prompts, paste each one into the app, save each reply as `<case-id>.response.txt` in the same folder, then score:

```bash
pnpm evals prompts evals/results/manual
```

```bash
pnpm evals score evals/results/manual
```

Results go to `evals/results/<time>-<agent>/`: the prompts, the raw replies, and `report.md`.

## Reading the report

| Metric | Meaning |
|---|---|
| **Cases passed** | Everything right: every expected note with the correct action and type, nothing extra, nothing transient |
| **Recall** | Share of expected notes the agent proposed |
| **Precision** | Share of proposals that were expected or acceptable |
| **Stayed quiet** | In cases where nothing was required, how often the agent proposed nothing unwanted |
| **Transient leaks** | Proposals containing things the guide says never to keep, or copying the guide's own examples |
| **Right action and type** | Among expected notes the agent found |
| **Detail completeness** | Whether found notes include key details, such as the reason or reversal conditions of a decision |

Matching uses keywords, so results are reproducible and cost nothing to score. The trade-off is that an unusual paraphrase can be missed. When a failure looks wrong, read the reply in the results folder and, if the case is too strict, widen its keywords.

## Results so far

| Date | Agent | Guide | Passed | Recall | Precision | Stayed quiet | Leaks |
|---|---|---|---|---|---|---|---|
| 2026-09-13 | Llama 3.1 8B via Ollama (8K context, temperature 0) | 0.1.0 | 4/20 | 75% | 54% | 2/5 | 7 |

What that first run showed:

- **Small models copy the guide's examples.** Examples from the guide showed up as proposals in unrelated conversations. The scorer now flags this in every case.
- **Note types blur.** Plans, timelines, and sources were labelled `Decision`.
- **Write decisions are hard.** The model created new notes where the right move was to update, supersede, or flag a conflict.
- **Staying quiet is hard.** Brainstorms and one-off questions still produced proposals.

Add a row when you run a new agent or change the guide.

## Add a case

1. Copy a case in [`cases/`](cases/) that's close to what you want to test, and rename it to `<id>.yaml`.
2. Write a realistic conversation, including the noise real conversations have: side issues, numbers, logistics.
3. Fill in `expect`, `optional`, and `avoid`. A `match` is a list of groups: every group needs at least one of its words, and matching ignores case. For example, `[["version"], ["path", "url"]]` means "mentions version, and mentions path or url".
4. Write a `reference` answer, and run `pnpm evals check`. The check fails if the reference doesn't pass, if an avoid rule never appears in the conversation, or if saving the whole transcript would pass.

Rules for cases:

- **Everything is fictional.** No real people, private details, real credentials, or content from anyone's actual notes or conversations.
- **Don't reuse the guide's own examples**, or the eval measures memorisation instead of judgment.
- **One thing per case.** A case should make clear what it tests.
