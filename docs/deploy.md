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
   # LLM keys come on Day 3; email keys on Day 4:
   # LLM_API_KEY=...
   # RESEND_API_KEY=...
   ```

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
4. Enable both jobs.

## 3. Verify it runs without you

- Wait a couple of minutes, then open the **Run Log** database in Notion.
- Expected rows (written only by your integration):
  - `health · healthCheck · <time>` — appears hourly from now on
  - `cron · scanInbox · <time>` — only when the Inbox has new lines
- Paste a message into the **Inbox** page; within a minute a draft order
  appears in Orders and the Inbox line gets a `[done]` prefix.
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
| `GET /cron/process` | cron-job.org every minute | Scan Inbox page + (Day 4) approval watcher |
| `GET /cron/health` | cron-job.org hourly | Heartbeat row → proof spread across days |