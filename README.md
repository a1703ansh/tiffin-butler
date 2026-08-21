# Tiffin Butler

An AI order-intake assistant for tiffin/mess services, powered by Notion.

A customer texts something messy — “ek curd rice + 2 chappati set kal lunch pls” —
and it becomes a priced, dated order sitting in **Notion** waiting for a human
decision. Approve it and the customer gets a confirmation email with a PDF
receipt. Every single run is logged. Nothing about this is no-code.

> Built for the Automate India hackathon: Notion is the interface, code is the engine.

---

## The problem

Tiffin and mess services run on WhatsApp forward-bombs: “2 idli + dosa tomoro
8am room 204” arrives with typos, Hinglish, and no structure. Delivery apps
(Swiggy/Zomato) don't serve monthly-mess dynamics, and the owner can't run a
human operator per message.

## What the system does

1. An order message arrives — **WhatsApp text or voice note**, webhook, or a
   paste into the Inbox page.
2. **AI (Groq)** parses the messy input into structured JSON: customer, phone,
   email, items, relative dates (“kal” → tomorrow), room, language, confidence.
   Voice notes are transcribed first (**Whisper**), then parsed the same way.
3. **Rules, not AI** — price it against the menu, fingerprint it for duplicates.
4. Clean orders land at **Pending Approval**; anything unclear lands at
   **Needs Human** with the raw message preserved.
5. **The human decides inside Notion** by moving the Status: `Confirmed` or
   `Rejected`.
6. On approval the watcher emails the customer a confirmation + **PDF receipt**
   (pdf-lib, attached). On rejection it emails a decline. `Action Sent`
   (checkbox) makes it idempotent under the 1-minute cron.
7. Every run — webhook, cron scan, health heartbeat, watcher action — gets a
   row in the **Run Log** database, written by code alone.
8. The **Menu database** lives in Notion: the owner edits items/prices there,
   and every new order is priced against it (~60s cache). A daily evening
   digest emails the owner today's orders, revenue, and anything stuck.

## Architecture

```
                 ┌─────────────────────────────── Notion (interface) ───────┐
 customer text ──► webhook/order ─┐                                        │
 voice note ─────► webhook/voice ─┤                                        │
 pasted in Inbox ─► cron/process ─┼─► Whisper ─► AI parse ─► price ─► dedupe
 WhatsApp text/voice ► /webhook/  │  (voice)    (Groq)      │        │      │
 cron-job.org ──► /cron/process ──┘            ▼           ▼        ▼      │
   (every min)                  ┌──────── order: Pending Approval / Needs Human
                                ▼                                        │
              human in Notion:  Confirmed ─► email + PDF receipt         │
                                Rejected  ─► decline email               │
                                fail       ─► Action Failed + Run Log row│
                                │                                        │
                                └──► Run Log row for every run ◄─────────┘

 Menu database (owner-edited prices) feeds the pricer; daily digest emails the owner.
```

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node + TypeScript + Fastify | simple, typed, fast dev loop |
| Notion | `@notionhq/client` v5 | databases as **data sources**, pages, blocks |
| AI | Groq, `openai/gpt-oss-120b` | free tier, fast JSON extraction |
| Pricing/dedupe | plain TypeScript rules | AI is only used where if-statements can't win |
| Email | Resend + pdf-lib | free tier, real delivery + generated PDF receipts |
| Hosting | Render + cron-job.org | free web service kept awake by free pings |

## Quickstart

```bash
cp .env.example .env       # add NOTION_TOKEN, LLM_API_KEY, RESEND_API_KEY
npm install
npm run check-setup        # verifies the Notion workspace wiring
npm run bootstrap          # (optional) creates the whole workspace idempotently
npm run dev                # local server on :3000
```

One real request:

```bash
curl -X POST http://localhost:3000/webhook/order \
  -H 'Content-Type: application/json' \
  -d '{"text":"2 idli sets + 1 dosa tomoro 8am room 204"}'
```

## Order lifecycle

| Status | Meaning |
|---|---|
| New / Draft | initial states |
| Pending Approval | AI parsed + priced cleanly — owner must decide (Needs You view) |
| Needs Human | uncertain parse / off-menu items / no delivery date — raw kept |
| Confirmed | owner said yes — watcher emailed receipt + PDF |
| Rejected | owner said no — watcher emailed decline |
| Cancelled | customer asked to cancel — matched by phone/room, cancellation emailed |
| Action Failed | automation crashed — Run Log row explains why |

Run Log outcomes: `success` · `needs_human` · `duplicate` · `action` · `failed` · `skipped`.

Extras beyond the core loop: **customer memory** (a returning phone number
auto-fills name + room from past orders, receipts greet "Welcome back"),
**cancellation** ("cancel my order…" flips the matching order and emails
confirmation), and a **live public dashboard** at `/`.

## Endpoints

| Endpoint | When | What it does |
|---|---|---|
| `GET /` | anyone | live HTML dashboard: today's stats, menu, recent Run Log rows |
| `GET/POST /order` | a customer's phone/browser | mobile order widget → same intake pipeline |
| `GET /stats` | humans/curl | the dashboard numbers as JSON |
| `POST /webhook/order` | an inbound message | intake (AI → price → dedupe → create; detects cancel requests) |
| `POST /webhook/voice` | an audio upload (or Meta voice note on demo day) | Whisper transcribe → same intake |
| `GET/POST /webhook/whatsapp` | Meta Cloud API (dormant until envs set) | handshake + WhatsApp text/voice intake |
| `GET /cron/process` | every minute | scan Inbox page + run approval watcher |
| `GET /cron/health` | hourly | heartbeat → Run Log proof spread across days |
| `GET /cron/digest` | daily 21:00 IST | owner digest email: orders, revenue, stuck items |

## Portability (“delete the repo and run it on a friend's Notion”)

Database and page IDs are never hard-coded — everything resolves by title
(with optional env overrides). A different tiffin run:

1. share their workspace with an internal integration,
2. `cp .env.example .env` + a fresh `NOTION_TOKEN`,
3. `npm run bootstrap && npm run check-setup`,
4. deploy — bootstrap seeds the Menu database; the owner then edits
   items/prices directly in Notion (no code deploys for a price change).

## Docs

- `docs/setup-notion.md` — workspace design, schema, views, guide
- `docs/deploy.md` — Render + cron-job.org deployment
- `docs/demo-script.md` — the 5-minute judging walkthrough
- `docs/whatsapp.md` — Meta Cloud API day-of setup (text + voice intake)

## Repo layout

```
src/
  index.ts                 Fastify server + endpoints + HTML pages
  config.ts                env config
  business.config.ts       fallback menu, currency, timezone
  menu.ts                  live Menu loader from Notion (60s cache)
  customers.ts             customer memory (phone → past name/room)
  web/stats.ts             dashboard aggregation
  web/pages.ts             landing page + mobile order widget (HTML)
  runlog.ts                single Run Log writer
  ai/parseOrder.ts         LLM parse (zod-validated)
  ai/transcribe.ts         Whisper voice-note transcription (Groq)
  pricing.ts               menu pricing (rules, fuzzy item matching)
  dedupe.ts                fingerprint dedupe (rules)
  jobs/processInbox.ts     intake + Inbox scan
  jobs/cancelOrder.ts      cancellation flow (match → flip → email)
  jobs/approvalWatcher.ts  Confirmed/Rejected → email + Action Sent
  jobs/dailyDigest.ts      evening owner digest email
  jobs/healthCheck.ts      heartbeat
  actions/receipt.ts       pdf-lib PDF receipt
  actions/email.ts         Resend sends (sandbox-safe delivery + digest)
  actions/whatsapp.ts      WhatsApp replies + media download (dormant-safe)
  notion/                  client + schema helpers (data sources API)
scripts/
  bootstrap-workspace.ts   idempotent workspace builder
  check-setup.ts           wiring verification
```
