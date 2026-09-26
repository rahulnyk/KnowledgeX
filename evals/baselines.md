# Baselines

Results of running the cases against real agents. `evals/results/` is not committed, so the headline numbers are kept here. Add a row when you run a full sweep, and say what changed since the last one.

| Date | Agent | Guide | Cases passed | Recall | Precision | Stayed quiet | Transient leaks |
|---|---|---|---|---|---|---|---|
| 2026-09-21 | Claude Code (Sonnet 4.6), `claude -p`, three runs | 0.3.1 + tuned guide | 13, 14, 17 of 20 | 100% | 86-95% | 5/5 (100%) | 2-5 leaks |
| 2026-09-21 | Claude Code (Sonnet 4.6), `claude -p` | 0.3.1 + tuned "what to write" | 13/20 (65%) | 16/16 (100%) | 18/21 (86%) | 5/5 (100%) | 5 in 5 cases |
| 2026-09-21 | Claude Code (Sonnet 4.6), `claude -p` | 0.3.1 | 13/20 (65%) | 16/16 (100%) | 17/18 (94%) | 5/5 (100%) | 7 in 6 cases |
| 2026-09-13 | Llama 3.1 8B via Ollama | 0.1.0 | 4/20 (20%) | 12/16 (75%) | 15/28 (54%) | 2/5 (40%) | 7 in 7 cases |

Retrieval cases were added in 0.3.1, and both runs used the standing-instruction reminder (`--reminder`): **looked before answering 2/2** in both, and **searched for the right thing 2/2** once the expect rules stopped demanding wording a sensible query needn't use.

## Offering when it comes up

Offer cases were added after 0.3.2: ten turns where the agent should offer something mid-conversation, stay quiet, not repeat an offer that was passed over, or make one closing proposal. The offer is judged in the reply the user would see. Both runs used Llama 3.1 8B via Ollama at temperature 0 with a 12K context, because `claude -p` wasn't available. "Before" is the 0.3.2 wording, which only asked for a proposal at the end; "after" adds the triggers and the "How to offer" and "At the end of a conversation" sections.

| Run | Offer cases passed | Offered at the right moment | Stayed quiet | Offers that broke a rule | Keep cases passed | Keep: stayed quiet |
|---|---|---|---|---|---|---|
| Before | 4/10 | 2/5 | 2/5 | 1 | 2/20 | 1/5 |
| After | 3/10 | 3/5 | 1/5 | 3 | 0/20 | 0/5 |

- **Llama offers more, and too readily.** It now makes offers mid-conversation that it used to leave out of its reply, which gains the lesson case, but it also offers on quiet turns: a one-off egg question, an unsettled offsite idea.
- **Its offers are loose.** The closing proposal kept shelf details, and the preference offer ("simplify slides") didn't name the rule.
- **Keep cases moved within noise for this model**, failing on one extra proposal each.
- **No conclusion yet.** An 8B model struggles to stay quiet under any wording (see the 0.1.0 row above). A Claude run is needed: `pnpm evals run --agent "cd /tmp && claude -p"` from a normal terminal.

## The noise floor

Three runs of the same configuration, same guide, scored 13, 14 and 17 out of 20. **Treat anything inside that range as noise.** A change is only worth believing if it moves the cases that fail every time, or moves the range as a whole across several runs.

Failures by how often they repeat, over those three runs:

| How often | Case | Fault |
|---|---|---|
| 3/3 | `article-takeaways-source` | An article's takeaways saved as the wrong type, missing two required details |
| 3/3 | `language-learning-plan` | Keeps "free tier" |
| 2/3 | `dependency-pinning-duplicate` | Creates a new note instead of updating the one that exists |
| 2/3 | `api-versioning-decision` | Keeps a vendor's typo'd string |
| 2/3 | `review-policy-contradiction` | Keeps how someone failed to find a document |
| 1/3 | `analytics-vendor-entity`, `database-restore-playbook`, `release-cadence-supersede`, `tls-certificate-outage-lesson` | Various |

Retrieval, with `--reminder` on: **looked before answering 2/2** in all three runs, and **searched for the right thing 2/2**. The supplier case failed once, on answering from general knowledge.

**Duplicate avoidance is the most valuable of these.** A library fills with near-duplicates if an agent creates where it should update, which is the failure KnowledgeX exists to prevent.

## Two cases were wrong, not the agent

Scoring the same three runs after fixing them gives 13, 14 and 17.

- **`database-restore-playbook`** banned the error messages the restore prints. A playbook is more useful when it names the symptom a reader will see, so the rule now catches the failed command and the trial-and-error story instead.
- **`dependency-pinning-duplicate`** banned naming the incident, which contradicted the guide's own requirement that a `Lesson` carry a one-line origin. It now catches the build status instead, and still catches creating a duplicate note.

`language-learning-plan` was left alone: a plan tier changes, and the guide says to cut it.

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
