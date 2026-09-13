# Maintain

Knowledge rots quietly. Maintenance keeps the bundle true, so that agents can keep trusting it. Run it on a schedule (weekly works for most bundles) or whenever the user asks.

## Steps

1. **Run `kx check`** and fix every error. Fix warnings when the fix is clear.
2. **Run `kx review`** to get the work list.
3. **Work through each group** as described below. Prepare concrete changes, but don't apply anything the user hasn't approved.
4. **Show the proposals** to the user as a short checklist, or write them to a file the user reviews. Don't put that file inside the bundle.
5. **Apply what is approved**, recording each change with `kx touch`, `kx verify`, or `kx relate`.

## What to do for each group

| Group | What to do |
|---|---|
| **Stale** | Re-read the note's sources. If the facts still hold, run `kx verify`, which also restarts the note's expiry window. If they changed, update the key facts, then `kx touch`. If the note no longer matters, propose deprecating or deleting it. |
| **Edited since last verified** | Compare the content with its sources, or ask the user to confirm it. Then `kx verify`. |
| **Sources changed since last verified** | Re-read the changed sources, update what they affect, then `kx touch`, and `kx verify` once checked. |
| **Superseded but not deprecated** | Confirm the replacement is right, then set `status: deprecated` on the old note. |
| **Deprecated without a successor** | Either link the replacement with `kx relate NEW supersedes OLD`, or confirm the note was simply retired. |
| **Open contradictions** | Show both sides to the user. Resolve by superseding the wrong note, or by correcting both. |
| **Drafts** | Ask whether each draft is now solid (set `status: stable`) or should be dropped. |
| **Never verified** | Most important first: Decisions, Preferences, Principles, and Playbooks that agents act on. Check them against sources or with the user. |

Also, now and then:

- **Read the reversal conditions** in active `Decision` notes. If any have been met, propose revisiting the decision.
- **Review `Idea` notes past their date.** Pursue the idea (turn it into a `Plan`) or drop it.
- **Look for duplicates**: notes with overlapping titles, aliases, or descriptions. Propose merging them into one note and superseding the rest.

## Running it on a schedule

Any agent that can run on a schedule can do maintenance. Give it this prompt:

> Run KnowledgeX maintenance. Read the guide with `kx guide maintain` and follow it. Use `--by process:weekly-review` for changes you are allowed to record. Collect everything that needs a person into one short checklist.
