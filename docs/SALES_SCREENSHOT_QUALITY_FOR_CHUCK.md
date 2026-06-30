# AI Ranking Screenshots — What Changed (Plain-English Guide)

_For Chuck. No tech background needed._

---

## The big picture

When someone asks ChatGPT, Gemini, or Perplexity for a business like our client's
(e.g. _"sedation dentist near me"_), the AI gives back a ranked list. We take a
**screenshot** of that answer showing where the client lands, and we keep a
**"before"** (when we started) and an **"after"** (where they are now).

Those two pictures are what show up in the client's email — proof of their
improvement, side by side.

**You don't do anything technical for this.** The screenshots live on our server
and drop into the email automatically. You just use the email template.

---

## What we just improved

A client noticed a problem: an email said **"Rank: 1/3"** (great news!) — but in
the picture, you **couldn't actually see the client at #1**. The screenshot had
scrolled too far, so you only saw #2 and #3, and a line at the bottom _claiming_
they were #1.

That's not convincing proof. If we say they're #1, the client should **see
themselves sitting at #1** in the picture.

So we added a **quality check**. Before any screenshot is allowed into an email,
the system now confirms **two things**:

1. ✅ The rank label in the picture matches our records (they really are #1, #2, or #3).
2. ✅ The client's business name is **actually visible in the list** at that spot —
   not just mentioned in a sentence at the bottom.

If a screenshot fails either check, it **does not get used.** Better to show
nothing than to show shaky proof.

---

## What you'll notice

- **The screenshots you DO see are trustworthy.** When the email shows "they're
  #2," the client will be **clearly visible at #2** in the picture.
- **Some contacts will show fewer screenshots — or none — for now.** That's on
  purpose. If we don't yet have a clean, convincing screenshot for a client, the
  email simply leaves it out rather than showing a weak one.
- This is **temporary and self-healing.** We're continuously re-capturing
  screenshots with better framing. As good ones come in, they automatically start
  appearing again — this time, the real, convincing kind.

Think of it like a quality inspector on a production line: anything that doesn't
clearly show the client at their rank gets pulled, so only the good proof ships.

---

## How a screenshot gets into the email (you don't manage any of this)

1. Our system already knows each client's best before/after per AI platform.
2. When the email sends, it pulls those pictures **live from our server.**
3. The picture is labeled with the **keyword and platform**, e.g.
   _"Leaking foundation (ChatGPT)."_
   - Slot 1 = **ChatGPT**, Slot 2 = **Gemini**, Slot 3 = **Perplexity**.
4. The picture links **never expire**, so saved templates keep working.

You reference them in the email with simple tags (already set up in the template):
`{{contact.keyword_1}}`, `{{contact.keyword_1_before_url}}`,
`{{contact.keyword_1_after_url}}` — and the same for keyword 2 and 3.

---

## The one rule to remember

> **Only Keyword 1 is guaranteed** to be filled on a contact. Lead with it.
> Keywords 2 and 3 may be empty (no second/third clean result yet) — wrap those
> blocks in a **Conditional** element so an empty one doesn't show a broken image.

---

## Quick FAQ

**"A contact has no screenshots — is it broken?"**
No. It means we don't yet have a clean, verified screenshot for that client. It
will fill in automatically once we capture a good one. Don't manually add anything.

**"Can I see the rank numbers as text (like '#12 → #1')?"**
Right now the numbers are **inside the picture** (the `[RANK: x/y]` label), not as
separate text you can type into the email. If you want them as editable text too,
tell the dev team — it's a small addition.

**"Will this email a real client by accident during testing?"**
No — all test sends are routed to our own inbox, never to a client.

---

_TL;DR: We added an automatic quality check so every screenshot in a client email
actually shows the client at their rank. You'll see fewer but stronger proofs for
now; they refill automatically as better screenshots come in. Nothing changes in
how you build emails._
