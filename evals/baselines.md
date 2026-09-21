# Baselines

Results of running the cases against real agents. `evals/results/` is not committed, so the headline numbers are kept here. Add a row when you run a full sweep, and say what changed since the last one.

| Date | Agent | Guide | Cases passed | Recall | Precision | Stayed quiet | Transient leaks |
|---|---|---|---|---|---|---|---|
| 2026-09-21 | Claude Code (Sonnet 4.6), `claude -p` | 0.3.1 + tuned "what to write" | 13/20 (65%) | 16/16 (100%) | 18/21 (86%) | 5/5 (100%) | 5 in 5 cases |
| 2026-09-21 | Claude Code (Sonnet 4.6), `claude -p` | 0.3.1 | 13/20 (65%) | 16/16 (100%) | 17/18 (94%) | 5/5 (100%) | 7 in 6 cases |
| 2026-09-13 | Llama 3.1 8B via Ollama | 0.1.0 | 4/20 (20%) | 12/16 (75%) | 15/28 (54%) | 2/5 (40%) | 7 in 7 cases |

Retrieval cases were added in 0.3.1, and both runs used the standing-instruction reminder (`--reminder`): **looked before answering 2/2** in both, and **searched for the right thing 2/2** once the expect rules stopped demanding wording a sensible query needn't use.

**Two runs is not a measurement.** The model is nondeterministic, and cases swapped between passing and failing while the total stayed at 13/20. Before tuning the guide any further, run the same configuration three times and see the spread.

## What the second run showed

Leaks fell from 7 to 5 and the two cases the guide change targeted (CI timings, incident timestamps) both passed. New failures were all over-proposing rather than over-keeping: a `Person` note for a sales rep mentioned once, another for a plumbing firm, and an article's takeaways split into a `Preference` plus a `Lesson` instead of one `Source`. The guide gained three rules in response: contact details belong in a contacts app, prefer one note unless the second stands on its own, and a source stays one note.

## What the first run showed

- **Judgment is sound.** Every expected note was proposed, nothing unwanted was kept in the five conversations that deserved nothing, and reasons and reversal conditions were present throughout.
- **One failure mode dominates:** a correct note carrying a detail from the moment, such as error output, CI timings, a free tier, clock times, or how something was found. Six of the seven failures. The "Transform, don't transcribe" section of the *what to write* guide was tightened afterwards to target exactly this.
- **One wrong type:** an article's takeaways saved as `Idea` rather than `Source`.
- **Retrieval, with the reminder on:** it searched in both cases. The supplier case still failed, partly because its expect rule demanded wording a sensible query needn't use (fixed), and partly because a one-shot prompt makes the agent guess what the search returned. Feeding results back needs a second turn.

## Reproducing

```bash
pnpm evals run --agent "cd /tmp && claude -p" --reminder
```

Run it from a terminal outside the Claude Code app; see the note in [README.md](README.md#run-it).
