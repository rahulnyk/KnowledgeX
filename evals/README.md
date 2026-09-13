# Judgment evals

KnowledgeX lives or dies on judgment: an agent that saves the wrong things makes memory worse, not better. These evals measure that judgment. Each case gives an agent a finished conversation and the KnowledgeX guide, and checks what the agent proposes to keep.

They work with **any agent** that can take a prompt and reply in text.

## What a case tests

Every case in [`cases/`](cases/) is a short, fictional conversation plus the answer key:

- **expect**: notes the agent should propose, with the right note type, the right action (`new`, `update`, `supersede`, `contradict`), and the key details that must be in them
- **optional**: notes that are reasonable to propose but not required
- **avoid**: things the agent must not keep, such as timestamps, prices, error output, secrets, or a duplicate of an existing note
- **bundle**: notes that already exist, for cases about updating, superseding, or flagging conflicts
- **reference**: a hand-written ideal answer, used to validate the case itself

The 20 cases cover decisions, lessons, playbooks, entities, people, preferences, plans, timelines, and sources. They also include updating, superseding, and flagging conflicts with existing notes, avoiding duplicates, keeping secrets out, and five conversations where **nothing** should be kept.

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
- **Run from a normal terminal**, not from inside an agent session. Some agent CLIs refuse to start inside their own session.
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
