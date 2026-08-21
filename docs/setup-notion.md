# Day 1 — Notion Workspace Setup Guide

This guide builds the Notion side of **Tiffin Butler** step by step. Follow it from
top to bottom. At the end, run `npm run check-setup` to verify everything is wired.

Estimated time: 30–40 minutes. Everything is on the free plan.

---

## 1. Create your Notion account (free)

1. Go to https://www.notion.com/students and sign up with your college email.
2. Claim **Notion Education Plus** (free while you study). This unlocks more
   blocks/pages — useful during the build, not strictly required.
3. Confirm your email, open your workspace.

---

## 2. Create the integration (this gives your code a key)

An "integration" is how our code talks to Notion. You create it once and share
the specific pages with it — it can only see what you grant it.

1. Go to https://www.notion.so/my-integrations
2. Click **+ New integration**
3. Name it: `Tiffin Butler`
4. Type: **Internal integration**
5. Associated workspace: your workspace
6. Capabilities (leave the default selections for the API):
   - `Read content` ✅
   - `Update content` ✅
   - `Insert content` ✅
   - `Delete content` — optional but keep it simple
   - Leave **User information** unchecked
7. Click **Submit**
8. Copy the **Internal Integration Secret** — it starts with `ntn_`.
   **This is your token. Treat it like a password — never commit it.**
9. Save it into your local `.env` file (copy from `.env.example`):

   ```
   NOTION_TOKEN=ntn_you_rsecret_token_here
   ```

If you lose the token, you can regenerate it from the same page.

---

## 3. Build the workspace structure

Inside your Notion workspace, create one **page** called `Tiffin Butler` — this is
our operations home. Everything lives inside it (so sharing one page shares all).

Structure:

```
Tiffin Butler (page)
├── Orders (database)
├── Run Log (database)
├── Menu (database)
└── Inbox (page)
```

> You don't have to build any of this by hand: `npm run bootstrap` creates the
> whole structure — including this Home page layout, the Menu schema + seed
> items, and the Needs You view — idempotently. This guide documents what it
> builds so you can also do it manually or verify it.

Create it:

1. In the sidebar, click **+ New page** → name it `Tiffin Butler`.
2. Inside it, type `/database`, choose **Table** or **Board** view → name it `Orders`.
3. Repeat for `Run Log` and `Menu`.
4. Type `/page` → name it `Inbox`.

---

## 4. Orders database schema

Open the **Orders** database → **•••** (top right) → **Properties**.

Create exactly these properties (name matters — the code auto-detects them):

| Property name | Type | Options / notes |
|---|---|---|
| `Summary` | Title (this is the default first column — rename it) | Human author fills `Customer — items` e.g. `Priya — 2× Idli set + 1× Dosa` |
| `Status` | Select | `New`, `Draft`, `Pending Approval`, `Needs Human`, `Confirmed`, `Rejected`, `Action Failed` |
| `Channel` | Text | Where the order came from: `webhook`, `inbox`, `whatsapp` |
| `Customer` | Text |    |
| `Phone` | Text | Mobile number |
| `Customer Email` | Text | Parsed or provided email — the receipt goes here |
| `Action Sent` | Checkbox | Ticked by code after the receipt/decline email — makes the watcher idempotent |
| `Items` | Text | Readable line items, e.g. `2× Idli set (₹40) · 1× Dosa (₹60)` |
| `Total` | Number | Format: **Currency ₹** |
| `Delivery` | Date | Pickup/delivery date (optionally time) |
| `Room` | Text | Hostel room / block, if any |
| `AI Summary` | Text | One short human-readable line of reasoning from the AI |
| `Raw Message` | Text | The original customer message (or voice transcript), preserved forever |
| `Confidence` | Select | `high`, `low` |
| `Language` | Text | Detected language |
| `Priority` | Select | `normal`, `urgent` |
| `Dedupe Hash` | Text | Internal — written by code to prevent duplicate orders |

> Tip: turn on **Kanban by Status** as a board view — it makes the workspace
> readable at a glance.

### Recommended views (the human's control panel)

1. **All** — table view, everything.
2. **Needs You** (filter): Status is any of `Pending Approval`, `Needs Human`,
   `Action Failed` — *this is the view the owner checks every morning.*
3. **Today** (filter): Delivery is `Today`.

---

## 5. Run Log database schema

Every run of the service writes a row here — **written by code only, never by
hand**. The judges check this, so keep it clean.

Open **Run Log** → **Properties** and create:

| Property name | Type | Notes |
|---|---|---|
| `Run` | Title (rename the default first column) | e.g. `webhook · processInbox · 13:04:22` |
| `Timestamp` | Date | Written by code from the server clock |
| `Trigger` | Select | `webhook`, `cron`, `manual`, `health`, `whatsapp`, `voice` |
| `Job` | Text | e.g. `processInbox`, `approvalWatcher`, `healthCheck`, `dailyDigest` |
| `Outcome` | Select | `success`, `failed`, `skipped`, `duplicate`, `needs_human`, `action` |
| `Duration` | Number | Milliseconds the run took |
| `Error` | Text | Error summary if it failed |
| `Meta` | Text | Short context (order reference, brief note) |
| `Order` | Relation | Relation → **Orders** database (link the order this run touched) |

To add the Relation property: ⚙️ **Properties** → **Add property** → type
**Relation** → select the `Orders` database.

---

## 6. Menu database

The live menu the pricer uses. **Notion is the source of truth**: change a
price here and every new order is priced at the new rate (~60s cache) — no
code deploy needed.

| Property name | Type | Notes |
|---|---|---|
| `Item` | Title (rename the default first column) | e.g. `Idli set` |
| `Price` | Number | Format: **Currency ₹** |
| `Aliases` | Text | Comma-separated alternate spellings customers use, e.g. `idli plate, idlies` |
| `Available` | Checkbox | Untick to take an item off the menu without deleting it |

Bootstrap creates this database and seeds the core items **add-only** — after
the first seed, your edits are never overwritten; re-running bootstrap only
adds items that are missing entirely.

---

## 7. Inbox page

A page where anyone can paste a stray WhatsApp message for the service to
process (the watcher picks it up automatically — this makes Notion a *usable*
input channel, not just an output).

1. Open the **Inbox** page inside `Tiffin Butler`.
2. Add one line of instructions as the first block:

   > Paste a customer's order message here, one per line. The service will
   > create the order draft automatically. Do not edit lines you did not write.

3. Leave the rest of the page empty — messages will be pasted as plain text
   lines.

---

## 8. Share everything with the integration

This is the step people forget — the token is useless until the integration is
granted access.

1. Open the **Tiffin Butler** page (the parent — sharing it shares the children).
2. Click **•••** (top right) → **Connections**.
3. In the search box, type your integration name **Tiffin Butler** → click it to
   add.
4. Repeat for **Orders**, **Run Log**, **Menu**, and **Inbox** individually if they are not
   already covered (children inherit when shared via the parent, but double-check
   each database's **Connections** menu shows `Tiffin Butler`).

---

## 9. Home page content (what a stranger reads first)

`npm run bootstrap` builds this for you — an icon + cover, a one-line pitch, a
"How it works" callout, live links to Orders / Run Log / Inbox / Menu, a stats
line refreshed by the hourly health ping, and a bookmark to the deployed
service. If you prefer building it manually, cover the same beats:

```
📦 TIFFIN BUTLER — WhatsApp order intake, run by code

How it works
· A customer's message arrives — webhook, WhatsApp text/voice, or pasted in Inbox.
· Code transcribes voice notes (Whisper), parses with AI, prices from the Menu database.
· The owner reviews it: Approve / Edit / Reject — all in Notion.
· On approval, code emails the customer a confirmation + PDF receipt.
· Every run is logged in the Run Log database with a timestamp.

Status legend
· Pending Approval — the owner must decide (see the "Needs You" view)
· Needs Human — the AI couldn't parse it; raw message is in Raw Message
· Confirmed — approval done, confirmation email sent
· Rejected — owner declined
· Action Failed — something crashed; a Run Log row explains what

Who does what
· The owner reads/should decide via the "Needs You" view.
· Menu prices are edited right here in the Menu database.
· The code writes Run Log rows and status transitions — never hand-edit the Run Log.
```

---

## 10. Verify your setup

Everything here is code-verifiable. From the repo root:

```bash
npm install
cp .env.example .env   # then paste your NOTION_TOKEN in .env
npm run check-setup
```

The script prints:

- ✅ / ❌ integration token found
- ✅ / ❌ `Orders` database resolved (by title) — shows its id
- ✅ / ❌ `Run Log` database resolved — shows its id
- ✅ / ❌ `Menu` database resolved — shows its id
- ✅ / ❌ each required property present on all three databases (missing ones listed)

**Expected output when done:** all checks pass. If a property is missing, add it
in Notion exactly as named in the tables above and re-run.

> If a check fails on "database not found": the integration was not shared with
> it (Section 8) — not the script's fault, that's the #1 cause.

---

## 11. Done — what Day 1 leaves you with

- A workspace a stranger can read and operate (`Tiffin Butler` home page)
- An integration token in `.env` (never in the repo)
- Verified schemas via `npm run check-setup`
- Commit 1 in git

Day 2 starts the service: server skeleton, Run Log writer, webhook + cron
endpoints, and the first deploy. The Run Log starts filling from Day 2 — that's
the spread-out proof the judges are looking for.