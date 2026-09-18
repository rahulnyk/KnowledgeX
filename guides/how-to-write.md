# How to write

Notes follow the [Open Knowledge Format (OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), plus four extra keys that OKF allows. Each notebook folder is a valid OKF bundle exactly as it sits on disk. Any OKF tool can read it, and any markdown editor can open it.

## The notebook

- **A library holds notebooks.** The library folder has one subfolder per notebook, a generated `index.md` listing them, and `.knowledgex.json`, which records confirmations made in the library. Don't edit either file by hand.
- **Each notebook is one flat folder.** No subfolders.
- **`index.md`** lists every note by type. It is generated; `kx` rebuilds it after each change.
- **`log.md`** is a dated changelog, newest first. `kx` commands add to it.
- **Every other `.md` file is a note.**
- **File names are kebab-case**, like `use-postgresql-as-the-job-queue.md`. The display name lives in `title`. Creating a note chooses the file name.
- **Always write standard relative markdown links**, like `[Job queue decision](use-postgresql-as-the-job-queue.md)`. Never write `[[wikilinks]]`: OKF doesn't define them, so other tools can't follow them. KnowledgeX does *read* wikilinks, so links the user makes in an editor such as Obsidian still count, and a relation can rely on one.
- **Links and relationships stay inside a notebook**, so a notebook still works when it is copied on its own.

## Note types

| Type | What it is | Goes stale after | Changing it |
|---|---|---|---|
| `Decision` | A choice, why, alternatives, reversal conditions | Never | Never edit. Supersede it. |
| `Preference` | A stable stance or constraint | 24 months | Update |
| `Principle` | A general rule someone lives or works by | Never | Update |
| `Lesson` | A general learning from an event | Never | Update |
| `Concept` | A definition or mental model | Never | Update |
| `Entity` | A product, service, organisation, or place | 12 months | Update its key facts |
| `Person` | Someone the user deals with | 12 months | Update |
| `Playbook` | A procedure or checklist that works | 6 months | Update |
| `Plan` | A goal and strategy in motion | 6 months | Update, or supersede |
| `Idea` | An idea not yet acted on | 6 months (then pursue or drop) | Update |
| `Source` | A book, article, or talk, with takeaways | Never | Update |
| `Timeline` | Dated entries about one subject | Never | Add entries only |

Creating a note sets `stale_after` from this table. Change it when a note's facts change faster or slower than usual.

## Frontmatter

```yaml
---
type: Entity
title: Acme Payments API
description: The payment provider behind checkout; known limits and support contacts.
tags: [payments, vendors]
status: stable
created: 2026-03-02
generated:
  by: my-agent/1.0
  at: 2026-03-02T10:15:00Z
verified:
  - by: my-agent/1.0
    at: 2026-03-02T10:20:00Z
stale_after: 2027-03-02T00:00:00Z
sources:
  - id: acme-docs
    resource: https://docs.example.com/payments
    title: Acme Payments API reference
aliases: [Acme, payment provider]
---
```

| Field | From | Rule |
|---|---|---|
| `type` | OKF (required) | One of the types above |
| `title` | OKF | Required. The display name. |
| `description` | OKF | Required. One sentence saying what this note is. Search and `index.md` rely on it. |
| `tags` | OKF | Optional. A few cross-cutting labels. |
| `status` | OKF | Required. `draft`, `stable`, or `deprecated`. |
| `generated` | OKF | Required. `by` who last meaningfully changed the content, and `at` when. |
| `verified` | OKF | Optional. A list of checks, each with `by` and `at`. |
| `stale_after` | OKF | When the note should be treated as out of date. |
| `sources` | OKF | Required when facts come from outside. Each has `id`, `resource` (URL or location), `title`, and optionally `author` and `last_modified`. |
| `resource` | OKF | Optional. The canonical URL when the note describes one specific thing. |
| `created` | KnowledgeX | The date the note was created. |
| `aliases` | KnowledgeX | Other names people use for the same thing. Add the old title when renaming. |
| `supersedes` | KnowledgeX | File names of notes this one replaces. Set by linking notes. |
| `contradicts` | KnowledgeX | File names of notes this one conflicts with. Set by linking notes. |

Don't add other keys. All dates and times are ISO 8601 in UTC.

## Relationships

- **Most relationships are links with a sentence around them.** "Checkout depends on the [Acme Payments API](acme-payments-api.md) for card capture." The sentence carries the meaning; the link carries the connection.
- **Two relationships get frontmatter keys**, because search and maintenance act on them:
    - `supersedes`: the other note is replaced. Search skips it and points to the newer note.
    - `contradicts`: there is a known conflict. Both sides must be shown until someone resolves it.
- **Every frontmatter relationship also needs a link in the body**, so plain OKF readers see it. Linking notes adds both.
- **Write each relationship once**, on the newer or more specific note. "Superseded by" is worked out automatically.

## Trust: who wrote it and who checked it

- **Identities.** Agents are `<agent>/<model>`. People are `human:<id>`. Scheduled jobs are `process:<name>`. The tools fill these in automatically.
- **`generated`** records who last meaningfully changed the content. Creating or changing a note updates it.
- **`verified`** records real checks only:
    - you compared the claims against their sources → record a check by you → **machine-confirmed**
    - the user confirmed the content in this conversation → record a check by the user → **human-reviewed**
    - no real check happened → leave it **unverified**
- **A check only counts if it happened after the last content change.** Changing a note after it was checked makes it unverified again, while the history of past checks stays in the file.
- **Footnote facts from outside** with the source's `id`: `Refunds settle in 5 business days[^acme-docs].`
- **Uncertain content** is saved as a draft.
- After creating or materially changing a note, ask the user once, in plain words: "Is this right? If so, I'll mark it as confirmed by you."

## Writing the body

- **Start with a one-line italic context sentence** that tells a reader with no background what this is and why it matters. For example: `_Chosen in March 2026 when job volume was under 1,000 per hour; revisit if that changes._`
- **Use `##` sections**, with short bullet points inside them. Indent nested bullets by 4 spaces.
- **Record reasoning, not just conclusions.** The *why* ages better than the *what*.
- **Put open loops in the note they belong to**, as `- [ ] TODO: action, owner, date`.
- **Keep volatile facts** in `## Key facts (as of YYYY-MM-DD)`, each with a footnote.
- **Stay plain.** No decorative headings, filler sections, or bold used for emphasis alone.
- **Fill in or delete every template hint** (`<!-- kx: ... -->`).
- **Split out a separate note only** when the idea is reusable, has a clear name, would derail this note, and has enough substance on its own. Otherwise keep it inline.

## Workflows

The steps name operations; see the operations table in the overview for the matching tool or command.

**Create**
1. **Search** to make sure the note doesn't exist yet.
2. **Create** the note with its type, title, one-sentence description, and body. Add sources for outside facts. Save it as a draft if unsure.
3. On the command line, `kx new` writes a template: fill in the body, replace the hints, then run `kx check`.

**Update**
1. **Read** the note. Merge the new knowledge into the right section; don't just append to the end.
2. **Change** the note, with a few words on what changed.

**Supersede** (a decision or belief changed)
1. **Create** the replacement, and explain in its body what changed and why.
2. **Link** it as superseding the old note. The old note is retired, and links are added both ways.

**Record a conflict**
1. **Link** the notes as contradicting each other.
2. Ask the user which is right. Once resolved, supersede the wrong note, or change the note to drop the conflict.

**Add to a timeline**
**Change** the Timeline note, adding a dated line at the top of `## Entries`.

## Without KnowledgeX tools

If you have neither the tools nor the `kx` command, you can still follow the format by hand:

- write the frontmatter shown above
- update `generated` whenever you change content
- add a line under today's date at the top of the notebook's `log.md`, like `* **Update**: Updated [Title](file.md).`
- add the note to `index.md` under its type's heading, like `* [Title](file.md) - description`
