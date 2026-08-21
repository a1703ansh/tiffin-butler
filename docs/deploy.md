# Deploy Guide — runs without you (Day 2 milestone)

The service must run without anyone triggering it. This guide puts it on a free
Render web service, kept awake by free cron-job.org pings.

Prereqs: the repo is on GitHub, and you have a Render account (sign up at
render.com with GitHub).

---

## 1. Render web service

1. dashboard.render.com → **New** → **Web Service**
2. Connect your GitHub repo (the one containing this project)
3. Settings:
   - Name: `tiffin-butler`
   - Environment: **Node**
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Instance type: **Free**
4. Before creating, add these environment variables (Environment tab in the
   create form, or later under **Environment** in the service dashboard):

   ```
   NOTION_TOKEN=ntn_...
   APP_URL=https://tiffin-butler.onrender.com
   LLM_API_KEY=...
   RESEND_API_KEY=...
   EMAIL_FROM=Tiffin Butler <onboarding@resend.dev>
   EMAIL_TO=thakur71039@gmail.com
   EMAIL_DELIVERY=sandbox
   # WhatsApp Cloud API (dormant until set — see docs/whatsapp.md):
   WHATSAPP_VERIFY_TOKEN=
   WHATSAPP_ACCESS_TOKEN=
   WHATSAPP_PHONE_NUMBER_ID=
   WHATSAPP_REPLIES=false
   ```

   About email on Render: the free Resend sandbox (`onboarding@resend.dev`)
   can only deliver to the account owner's verified inbox — so in
   `EMAIL_DELIVERY=sandbox` mode every receipt/decline goes to `EMAIL_TO`
   with the customer's parsed address noted in the subject/body. That keeps
   the happy path demonstrable at zero cost. To send to real customers later,
   verify your own domain in the Resend dashboard, switch
   `EMAIL_FROM=Tiffin Butler <orders@yourdomain.com>` and
   `EMAIL_DELIVERY=customer`.

   Nothing else is needed — the database/page ids auto-resolve by title.
5. **Create Web Service.** First build takes a few minutes. When it is live,
   open `https://tiffin-butler.onrender.com` — you should see the JSON status
   page.
6. Free Render instances sleep after ~15 minutes idle and wake on a request
   (~30–60s cold start). The every-minute ping below keeps it warm.

## 2. cron-job.org (the alarm clock)

1. Go to cron-job.org → sign up (free, email verification)
2. **Create cron job**:
   - Name: `tiffin-butler process`
   - URL: `https://tiffin-butler.onrender.com/cron/process`
   - Schedule: `* * * * *` (every minute)
   - On failure/timeout, cron-job.org retries automatically on the next run
3. Create a second job:
   - Name: `tiffin-butler health`
   - URL: `https://tiffin-butler.onrender.com/cron/health`
   - Schedule: `0 * * * *` (hourly)
4. Create a third job:
   - Name: `tiffin-butler digest`
   - URL: `https://tiffin-butler.onrender.com/cron/digest`
   - Schedule: `30 15 * * *` (15:30 UTC = 21:00 IST daily — evening owner digest)
5. Enable all three jobs.

## 3. Verify it runs without you

- Wait a couple of minutes, then open the **Run Log** database in Notion.
- Expected rows (written only by your integration):
  - `health · healthCheck · <time>` — appears hourly from now on
  - `cron · scanInbox · <time>` — only when the Inbox has new lines
- Paste a message into the **Inbox** page; within a minute a draft order
  appears in Orders and the Inbox line gets a `[done]` prefix.
- Open the order in the **Needs You** view and set Status to **Confirmed**
  (or **Rejected**). Within a minute the approval watcher emails the customer
  a receipt (`Action Sent` checkbox gets ticked; a second run does nothing) or
  a decline email. A missing/bad `RESEND_API_KEY` instead flips the order to
  **Action Failed** — the Run Log row explains why.
- Shut your laptop. It still works — that is the demo.

## 4. Local run (development)

```bash
npm run dev        # tsx, auto-reload
npm run build      # tsc -> dist/
npm start          # run the compiled output
```

Local smoke test:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/webhook/order `
  -ContentType 'application/json' `
  -Body '{"text":"2 idli sets + 1 dosa tomoro 8am room 204"}'
```

## Slots summary

| Endpoint | Called by | What it does |
|---|---|---|
| `POST /webhook/order` | inbound messages (any sender) | Intake one order message |
| `POST /webhook/voice` | audio uploads (`curl -F file=@note.m4a …`) | Whisper transcribe → same intake pipeline |
| `GET/POST /webhook/whatsapp` | Meta Cloud API (day-of setup, docs/whatsapp.md) | WhatsApp webhook handshake + text/voice intake |
| `GET /cron/process` | cron-job.org every minute | Scan Inbox page + approval watcher |
| `GET /cron/health` | cron-job.org hourly | Heartbeat row → proof spread across days |
| `GET /cron/digest` | cron-job.org daily 21:00 IST | Owner digest email + Run Log row |