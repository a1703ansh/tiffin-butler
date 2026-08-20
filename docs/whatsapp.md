# WhatsApp intake via Meta's Cloud API (day-of setup)

The code is already built and dormant: routes exist, but nothing happens until
the env vars below are set. This guide is the ~15 minutes of Meta dashboard
work to switch it on. Do it on hackathon day with a fresh access token (it
expires ~24h; the verify token and test number do not).

## 1. Create the Meta app (once)

1. Go to https://developers.facebook.com → **My Apps** → **Create App** →
   *Use cases* → **Other** → *Business* as app type.
2. In the app dashboard, add the **WhatsApp** product.
3. In WhatsApp → **API Setup**:
   - Connect a **test number** (instantly generated, e.g. `+15550145…`).
   - Note the **Temporary access token** (expires ~24h — the value to paste on
     the demo day, or re-copy it fresh).
   - Note the **Phone number ID** (`WHATSAPP_PHONE_NUMBER_ID`).
4. In the test number's settings add up to **5 recipient phone numbers**
   (your own first; a judge's can be added right before their test). The test
   number can only chat with these.

## 2. Point Meta at our webhook

1. WhatsApp → **Configuration** → **Webhook**:
   - Callback URL: `https://tiffin-butler.onrender.com/webhook/whatsapp`
   - Verify token: any string you choose — it must equal
     `WHATSAPP_VERIFY_TOKEN` in `.env`/Render env.
2. Click **Verify and save** — the server answers Meta's `hub.challenge`
   handshake automatically.
3. Subscribe to the **messages** field (under Webhook fields).

## 3. Env vars (local `.env` and Render)

```
WHATSAPP_VERIFY_TOKEN=your-random-string
WHATSAPP_ACCESS_TOKEN=EAAG...   # temporary token, refresh on demo day
WHATSAPP_PHONE_NUMBER_ID=10...  # the phone number ID from API Setup
WHATSAPP_REPLIES=false          # "true" to auto-reply "order received"
```

Without these (or with empty values) the server is dormant: the webhook
endpoints answer "WhatsApp not configured", and nothing else changes.

## 4. Verify

1. WhatsApp the test number from one of the recipient phones: *"2 idli and 1
   dosa kal 8am room 204"*.
2. Within seconds: `whatsapp · processInbox · <time>` in the Run Log, the
   order in **Orders** at **Pending Approval**, `Channel` = `whatsapp`.
3. Approve it in Notion — the receipt email flows exactly like webhook orders.
4. With `WHATSAPP_REPLIES=true` the customer gets a free-form reply (allowed
   inside the 24h window opened by their message).

## Troubleshooting

- **Webhook verify fails / 403**: the verify token in Meta's Configuration
  doesn't match `WHATSAPP_VERIFY_TOKEN`; or the deploy hasn't picked up the
  env var (restart the Render service after editing env vars).
- **Message arrives but no order**: watch the Run Log — a `failed` row
  explains (usually an LLM issue, never a WhatsApp issue).
- **Can't message the test number**: the recipient isn't in the test number's
  allowed list yet, or the number format is wrong (include country code).
- **Auto-reply error**: access token expired — re-copy the temporary token.