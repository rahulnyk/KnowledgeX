# Walkthrough

This guide takes you from nothing to a working KnowledgeX setup in about five minutes. No technical knowledge is needed.

**What you'll end up with:** Claude remembering what matters from your conversations, such as decisions, preferences, lessons, and people, in a folder of notes on your computer that you control.

---

## 1. The idea in one minute

Imagine a careful assistant who sits in on your meetings. They don't write down everything. At the end, they say:

> "I'd keep two things: you decided to review liability clauses before payment terms, and why; and the client prefers updates by email. I'm skipping the draft wording, since it'll change. OK?"

Months later, when you ask "how do we review supplier contracts?", they find the note, tell you, and add: "you confirmed this in March."

KnowledgeX teaches Claude to be that assistant.

---

## 2. Install

You need **Claude Desktop** for Mac or Windows. If you don't have it, download it from [claude.ai/download](https://claude.ai/download) and sign in.

1. **Download** [KnowledgeX.mcpb](https://github.com/rahulnyk/KnowledgeX/releases/latest/download/KnowledgeX.mcpb).
2. **Double-click the file.** Claude Desktop opens an install screen. (If double-clicking doesn't work, drag the file into the Claude Desktop window instead.)
3. **Review the settings on the install screen**, then click **Install**:
    - **Notes folder:** where your notes are kept. The default is a `KnowledgeX` folder in your Documents. Leave it unless you want them somewhere else.
    - **Your name:** optional. It's recorded when you confirm a note is correct.

To check it's working, open Claude Desktop's **Settings → Extensions**. KnowledgeX should be listed and turned on.

---

## 3. Your first notes

Start a new chat and talk about something real, like a plan, a choice you're weighing, or a problem you solved.

At a natural stopping point, Claude may offer something like:

> I'd keep one thing: your decision to send client updates by email every Friday, since the client finds calls disruptive. I'd skip the draft email itself. Save this?

- Say **yes** to save it.
- Say **"only the first one"** or **"no"** if you disagree. You're always in charge.
- If Claude doesn't offer, you can ask: *"Is anything from this conversation worth keeping?"*
- Or say it directly: *"Remember that I always want contracts reviewed by two people."*

The first time Claude uses KnowledgeX, Claude Desktop may ask for permission to use its tools. Choose to allow it.

**Don't expect many notes.** Most conversations have nothing worth keeping, and that's by design. A small set of notes you can trust beats a big pile you can't.

---

## 4. Ask Claude to remember

In a later chat, ask:

> How do I usually send client updates?

Claude looks through your notes and answers with where the answer came from:

> By email every Friday, because the client finds calls disruptive. That's from your note "Client update routine", which hasn't been confirmed yet.

**Make this automatic.** Claude doesn't always think to check your notes first, especially when you don't mention them. Open **Settings → Profile** in Claude Desktop and add this to your personal preferences, which apply to every chat:

```
I use KnowledgeX as my knowledge library. Before answering anything that depends on my earlier decisions, preferences, people, plans or lessons, search my notes first. At the end of a substantial conversation, tell me what's worth keeping, and save only what I approve.
```

---

## 5. Confirm the notes you trust

After saving a note, Claude asks whether it's right. When you say yes, the note is marked as **confirmed by you**. You can also say, at any time, *"that note about client updates is correct."*

Why it matters:

- Claude tells you whether a note was confirmed, so you know how far to rely on it.
- If a note is changed later, it goes back to **unconfirmed** until you check it again.
- Claude only acts on its own, rather than just answering, when the guidance is confirmed by you. Otherwise it asks first.

---

## 6. When things change

**You changed your mind.** Say *"we're moving client updates to a call every other Monday."* Claude saves the new decision and marks the old one as replaced. The old one stays for history, but Claude won't treat it as current.

**Something is wrong.** Say *"that note is out of date, the client now wants weekly calls."* Claude suggests the fix and makes it once you agree.

**Two notes disagree.** Claude points it out and asks you which one is right.

---

## 7. Keep your notes healthy

Facts go stale: people change roles, policies change, vendors change terms. Every so often, ask:

> Do any of my notes need attention?

Claude lists notes that may be out of date, notes that conflict, and notes you've never confirmed, and suggests what to do. Nothing changes until you agree.

---

## 8. Notebooks

Your notes live in **notebooks**. Everything goes in one called **general** until you want more. (If you've heard of the Open Knowledge Format: each notebook is an OKF bundle, a standard folder of notes that other tools can read.)

- **Start a notebook for a client or project.** Say *"start a notebook for the Acme case."* Claude may also suggest one, and always asks before creating it.
- **Claude tells you where each note goes.** Once you have more than one notebook, every suggestion names the notebook, such as *"I'd keep this in your Acme notebook."* If Claude isn't sure, it asks you which one.
- **Keep a Claude Project's chats in its notebook.** Add a line to the project's instructions, such as: *Use the KnowledgeX notebook acme-case.*
- **Share a notebook.** Each notebook is a folder inside your notes folder. Zip that folder and send it.
- **Add a notebook someone sent you.** Unzip it and drag the folder into your notes folder. Claude finds it in your next chat.
- **Notes you receive start unconfirmed.** Even if the sender confirmed them, that doesn't count for you. Claude tells you who confirmed a note before, and asks before relying on it. Confirm the ones you agree with.

---

## 9. Where your notes are, and privacy

- **Your notes are in the folder you chose**, by default `Documents/KnowledgeX`, with one folder inside it per notebook. Open it like any folder. Each note is a plain text file you can read.
- **You can back it up**, sync it with your usual cloud storage, or delete notes you don't want.
- **KnowledgeX itself never connects to the internet.** When Claude uses a note in a conversation, the note's text becomes part of that conversation, like anything else you type.
- **Claude is instructed never to save passwords or account numbers**, and to ask before saving confidential client or personal information.

> **Tip:** to browse your notes in a friendlier way, open the folder in a free notes app such as [Obsidian](https://obsidian.md) (choose "Open folder as vault").

**Editing notes yourself is fine.** A note you edit counts as confirmed by you, since you wrote it. Afterwards, ask Claude for a check-up now and then, so it can tidy up the list of your notes.

---

## 10. Troubleshooting

| Problem | What to do |
|---|---|
| Double-clicking the file does nothing | Open Claude Desktop, then drag `KnowledgeX.mcpb` into its window. Or use **Settings → Extensions → Advanced settings → Install Extension**. |
| Claude doesn't seem to use KnowledgeX | Check **Settings → Extensions**: KnowledgeX should be turned on. Start a new chat after installing. |
| Claude never offers to save anything | Ask directly: "Is anything worth keeping?" Most conversations genuinely have nothing to keep. |
| Claude saves things you don't want | Say no when it proposes them. To remove a saved note, ask Claude to retire it, or delete the file from your notes folder. |
| I want my notes in a different folder | Quit Claude Desktop and move your whole notes folder to the new place. Then, in **Settings → Extensions → KnowledgeX**, choose it as **Notes folder**. Moving the whole folder keeps a hidden file that remembers your confirmations. |
| My notes suddenly show as unconfirmed | The hidden file that remembers your confirmations was lost, for example because the notebook folders were copied without it. Ask Claude for a check-up and confirm the notes again. |

---

## Where next

- Curious what Claude is told? Read the [agent guides](../guides/).
- Using another AI app or the command line? See the [technical guide](technical.md).
- Interested in the reasoning behind KnowledgeX? Read the [design document](design.md).
