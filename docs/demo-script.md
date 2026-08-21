# Demo Script — 5 minutes for the judges

Tiffin Butler: *“WhatsApp orders, parsed by AI, approved by you.”*

Everything below works headless — the system has been running since Day 1 with
Run Log rows written by code only.

---

## Before the demo (2 minutes of prep)

- Open two tabs: the **Tiffin Butler** Notion workspace and your email inbox
  (thakur71039@gmail.com). Keep the Run Log database open and sorted by
  Timestamp descending.
- Have [tiffin-butler.onrender.com](https://tiffin-butler.onrender.com) ready
  (`/` is a live dashboard: today's orders, revenue, the Notion-edited menu,
  and the latest automation runs).
- Optionally paste two messages into the **Inbox** now so the first minute of
  the demo shows the cron intake happening live.

## The demo

### 1. The problem (30s)
Point at a real WhatsApp message on your phone (or paste one):
> “yes ek curd rice + 2 chappati set kal lunch room 310 this is revati”

Nobody wants to type that into a spreadsheet. Swiggy/Zomato don't serve tiffin
services. Today that message is read by a human and retyped.

### 2. The intake (60s)
Paste the message as a new line in **Inbox** (or call the webhook with curl —
faster):
```bash
curl -X POST https://tiffin-butler.onrender.com/webhook/order \
  -H 'Content-Type: application/json' \
  -d '{"text":"yes ek curd rice + 2 chappati set kal lunch room 310 this is revati"}'
```
Show what code just did in Notion:
- a new **Orders** row, Status **Pending Approval**, priced:
  `1× Curd rice (₹50) · 2× Chapati set (₹70) = ₹120` with the right delivery
  date, room, customer, and a Run Log `success` row beside it.

Message: *AI did the parsing, rules did the pricing, and it paused for a human
— that's the whole point.*

### 3. The human decision in Notion (30s)
In the **Needs You** view (filters Pending Approval / Needs Human / Action
Failed), drag the order to **Confirmed**.

### 4. The real action happens outside Notion (60s)
Stay in the email tab. Within a minute (cron-job.org → `/cron/process`), the
confirmation email lands — with a **PDF receipt** attached. Show it: order
ref, items, total, delivery, timestamp.

Back in Notion: `Action Sent` is ticked (idempotency — the next cron run does
nothing) and the Run Log shows `cron · approvalWatcher · action`.

### 5. The unhappy paths (30s each, optional)
- **Needs Human**: paste garbage (`asjdfajfasof`) — order lands at Needs Human
  with the raw message preserved, Run Log `needs_human`. The system refuses to
  invent a price (“1 chicken biryani” → `⚠️ off-menu` on a menu that has no
  chicken).
- **Duplicate**: paste the same message again → Run Log `duplicate`, no new
  order (sha-256 fingerprint of message + phone + date).
- **Action Failed**: (skip in live demo, mention it) a broken email key flips
  the order to Action Failed with the Run Log row explaining why — the
  automation reports its own failures instead of hiding them.

### 6. The showstopper: a voice note becomes an order (45s)
On your phone, record a voice note the way a real customer would:
> “bhaiya, kal do idli set aur ek dosa chahiye, room 214”

Upload it straight into the pipeline — no WhatsApp needed:
```bash
curl -X POST https://tiffin-butler.onrender.com/webhook/voice -F file=@note.m4a
```
The response shows what Whisper heard, and Notion shows the parsed, priced,
Pending Approval order. Same AI, same rules, one extra step: audio → text.

### 7. Judge participation beats (60s, pick any)
- **Live dashboard**: open [tiffin-butler.onrender.com](https://tiffin-butler.onrender.com)
  — today's orders, confirmed revenue, waiting-on-owner counts, the live menu,
  and the last automation runs. Refreshes itself.
- **Order from their phone**: judges open `/order` on their phones and place a
  real order; it lands in Notion seconds later (Channel = `web`).
- **It remembers customers**: place a second order with the same phone but no
  name/room — the order fills them in from history ("welcome back").
- **Cancellation**: send "please cancel my order, phone <number>" → the order
  flips to **Cancelled**, a cancellation email goes out, Run Log logs it. Two
  live orders match? It refuses to guess and asks a human instead.
- **The audit trail**: click an order in Notion → its **Order** relation on
  every Run Log row shows the full automation trail for that single tiffin:
  intake → parse → price → approval → receipt sent.

Bonus beat: open the **Menu** database on Home and change Dosa ₹60 → ₹65 live;
the next order prices at the new rate. *The owner runs this business from
Notion — prices included.*

### 8. Close (30s)
Run Log is full of rows from Day 1 onward — timestamps prove the system ran
without anyone touching it. And the whole workspace is re-creatable: the repo
builds it idempotently (`npm run bootstrap` + `npm run check-setup`) on any
Notion workspace — no copy-pasting of database IDs, everything resolves by
title.

---

## Judging-criteria mapping

| Criterion | Where it's proven |
|---|---|
| Notion is the interface | owner decides entirely in Notion (Needs You view); Run Log lives in Notion; Menu is owner-editable in Notion |
| Code is the engine | API-accessed databases, AI parse, pricing, dedupe, watcher, emails — no no-code platform |
| Real action outside Notion | customer emails with PDF receipts via Resend + pdf-lib; daily owner digest |
| Human approval | nothing sends without a human moving Status to Confirmed |
| Run Log proof | rows written by code since Day 1 across webhook/cron/health/watcher/voice/digest |
| Portability | `npm run bootstrap` re-creates the workspace anywhere; IDs resolve by title |
| AI vs rules | AI for messy text + voice transcription; pricing/dedupe are plain functions |

## Likely judge questions — 1-line answers

- **“Why tiffin?”** Delivery apps skip the mess market — daily cadence, tiny
  margins, chaotic WhatsApp orders. Perfect automation demo, real business.
- **“Does it do real WhatsApp?”** Yes — Meta Cloud API integration is built and
  dormant: text *and* voice notes. It's activated with four env vars on demo
  day (docs/whatsapp.md); today's demo uses the same pipeline via webhook.
- **“Why an LLM at all?”** Because the input is unbounded human text in
  Hinglish (“tomoro”, “kal”, “parso”). If-statements can't parse that; they
  *can* price and dedupe — so that's where they live.
- **“What if the AI mishears a voice note?”** Same safety net as text: fuzzy
  menu matching first, and anything uncertain goes to Needs Human with the
  transcript preserved — never silently priced.
- **“Is it actually running?”** Open the live dashboard — orders today,
  revenue, menu, latest Run Log rows, refreshed every minute by cron-job.org.
  Rows go back to Day 1; the owner also gets an evening digest email.
- **“What if a customer wants to cancel?”** They just say so — “cancel my
  order” matches their most recent live order by phone (or room), flips it to
  Cancelled, emails confirmation, and logs everything. Ambiguous requests go
  to Needs Human instead of guessing.
- **“Where does the money come from?”** Free tiers end-to-end: Groq (chat +
  Whisper), Resend sandbox, Render, cron-job.org.
- **“Can it send to real customers?”** Yes — verify a domain in Resend and set
  `EMAIL_DELIVERY=customer`; the sandbox demo mode (default) delivers to the
  owner's inbox with the customer's parsed address in the subject.