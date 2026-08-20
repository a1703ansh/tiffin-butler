import { env } from "../config.js";

/**
 * Sends a WhatsApp text message via Meta's Cloud API (free-form messages are
 * allowed inside the 24h customer-service window opened by an inbound message).
 * Dormant when WHATSAPP_REPLIES is not "true" or credentials are missing.
 */
export async function replyToWhatsApp(
  to: string,
  body: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!env.whatsappReplies) return { ok: false, error: "WHATSAPP_REPLIES is not enabled" };
  if (!env.whatsappAccessToken) return { ok: false, error: "WHATSAPP_ACCESS_TOKEN is not set" };
  if (!env.whatsappPhoneNumberId) return { ok: false, error: "WHATSAPP_PHONE_NUMBER_ID is not set" };

  try {
    const res = await fetch(`${env.whatsappGraphUrl}/${env.whatsappPhoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.whatsappAccessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return { ok: false, error: `WhatsApp HTTP ${res.status}: ${detail}` };
    }
    const data = (await res.json()) as { messages?: Array<{ id?: string }> };
    return { ok: true, id: data.messages?.[0]?.id ?? "unknown" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}