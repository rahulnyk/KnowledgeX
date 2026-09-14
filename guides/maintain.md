# Maintain

Knowledge rots quietly. Maintenance keeps every notebook true, so that agents can keep trusting it. Run it on a schedule (weekly works for most people) or whenever the user asks, for example "check up on my notes".

## Steps

1. **Get the work list** with the maintenance operation (see the operations table in the overview). It includes format problems; fix every one, and fix warnings when the fix is clear.
2. **Work through each group** as described below. Prepare concrete changes, but don't apply anything the user hasn't approved.
3. **Show the proposals** to the user as a short checklist in plain words, such as "Your note on the vendor contract is a year old. Want me to re-check it?" If the user prefers, write the list to a file they review, outside the library.
4. **Apply what is approved**, recording each change: change the note, record a check, or link notes.

## What to do for each group

| Group | What to do |
|---|---|
| **Stale** | Re-read the note's sources. If the facts still hold, record a check, which also restarts the note's expiry window. If they changed, update the key facts. If the note no longer matters, propose retiring it. |
| **Confirmed in another copy, not in this library** | The notebook was copied in with its confirmations, which don't count here. Show the user what the note says and who confirmed it before, and record their confirmation if they agree. Start with the notes agents act on. |
| **Edited since last verified** | Compare the content with its sources, or ask the user to confirm it. Then record the check. |
| **Sources changed since last verified** | Re-read the changed sources, update what they affect, and record a check once done. |
| **Superseded but not deprecated** | Confirm the replacement is right, then retire the old note (`status: deprecated`). |
| **Deprecated without a successor** | Either link the replacement as superseding it, or confirm the note was simply retired. |
| **Open contradictions** | Show both sides to the user. Resolve by superseding the wrong note, or by correcting both. |
| **Drafts** | Ask whether each draft is now solid (make it `stable`) or should be dropped. |
| **Never verified** | Most important first: Decisions, Preferences, Principles, and Playbooks that agents act on. Check them against sources or with the user. |

Also, now and then:

- **Read the reversal conditions** in active `Decision` notes. If any have been met, propose revisiting the decision.
- **Review `Idea` notes past their date.** Pursue the idea (turn it into a `Plan`) or drop it.
- **Look for duplicates**: notes with overlapping titles, aliases, or descriptions. Propose merging them into one note and superseding the rest.

## Running it on a schedule

Any agent that can run on a schedule can do maintenance. Give it this prompt:

> Run KnowledgeX maintenance. Read the "maintain" guide and follow it. Record changes you are allowed to make as `process:weekly-review`. Collect everything that needs a person into one short checklist.
