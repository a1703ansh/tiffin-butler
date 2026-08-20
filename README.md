# Tiffin Butler

An AI order-intake assistant for tiffin/mess services, powered by Notion.

A customer texts something messy — “ek curd rice + 2 chappati set kal lunch pls” —
and it becomes a priced, dated order sitting in **Notion** waiting for a human
decision. Approve it and the customer gets a confirmation email with a PDF
receipt. Every single run is logged. Nothing about this is no-code.

> Built for the Notion hackathon: Notion is the interface, code is the engine.

---

## The problem

Tiffin and mess services run on WhatsApp forward-bombs: “2 idli + dosa tomoro
8am room 204” arrives with typos, Hinglish, and no structure. Delivery apps
(Swiggy/Zomato) don't serve monthly-mess dynamics, and the owner can't run a
human operator per message.

## What the system does

1. An order message arrives — webhook, a paste into the Inbox page, anything.
2. **AI (Groq)** parses the messy text into structured JSON: customer, phone,
   email, items, relative dates (“kal” → tomorrow), room, language, confidence.
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

## Architecture

```
                 ┌─────────────────────────────── Notion (interface) ───────┐
 customer text ──► webhook/order ─┐                                        │
 pasted in Inbox ─► cron/process ─┼─► AI parse ─► price ─► dedupe          │
                                  │      (Groq)   │        │               │
 cron-job.org ──► /cron/process ──┘               ▼        ▼               │
   (every min)                  ┌──────── order: Pending Approval / Needs Human
                                ▼                                        │
              human in Notion:  Confirmed ─► email + PDF receipt         │
                                Rejected  ─► decline email               │
                                fail       ─► Action Failed + Run Log row│
                                │                                        │
                                └──► Run Log row for every run ◄─────────┘
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
| Action Failed | automation crashed — Run Log row explains why |

Run Log outcomes: `success` · `needs_human` · `duplicate` · `action` · `failed` · `skipped`.

## Endpoints

| Endpoint | When | What it does |
|---|---|---|
| `POST /webhook/order` | an inbound message | intake (AI → price → dedupe → create) |
| `GET /cron/process` | every minute | scan Inbox page + run approval watcher |
| `GET /cron/health` | hourly | heartbeat → Run Log proof spread across days |

## Portability (“delete the repo and run it on a friend's Notion”)

Database and page IDs are never hard-coded — everything resolves by title
(with optional env overrides). A different tiffin run:

1. share their workspace with an internal integration,
2. `cp .env.example .env` + a fresh `NOTION_TOKEN`,
3. `npm run bootstrap && npm run check-setup`,
4. swap `src/business.config.ts` (menu + prices) and deploy.

## Docs

- `docs/setup-notion.md` — workspace design, schema, views, guide
- `docs/deploy.md` — Render + cron-job.org deployment
- `docs/demo-script.md` — the 5-minute judging walkthrough

## Repo layout

```
src/
  index.ts                 Fastify server + endpoints
  config.ts                env config
  business.config.ts       the business: menu, prices, currency, timezone
  runlog.ts                single Run Log writer
  ai/parseOrder.ts         LLM parse (zod-validated)
  pricing.ts               menu pricing (rules)
  dedupe.ts                fingerprint dedupe (rules)
  jobs/processInbox.ts     intake + Inbox scan
  jobs/approvalWatcher.ts  Confirmed/Rejected → email + Action Sent
  jobs/healthCheck.ts      heartbeat
  actions/receipt.ts       pdf-lib PDF receipt
  actions/email.ts         Resend sends (sandbox-safe delivery)
  notion/                  client + schema helpers (data sources API)
scripts/
  bootstrap-workspace.ts   idempotent workspace builder
  check-setup.ts           wiring verification
```