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

/**
 * Downloads an inbound media file (voice notes arrive as audio messages) via
 * Meta's Media API. Dormant-safe like the rest of the WhatsApp integration.
 */
export async function downloadWhatsAppMedia(
  mediaId: string,
): Promise<{ ok: true; buffer: Buffer; mime: string } | { ok: false; error: string }> {
  if (!env.whatsappAccessToken) return { ok: false, error: "WHATSAPP_ACCESS_TOKEN is not set" };

  try {
    const meta = await fetch(`${env.whatsappGraphUrl}/${mediaId}`, {
      headers: { Authorization: `Bearer ${env.whatsappAccessToken}` },
    });
    if (!meta.ok) {
      const detail = (await meta.text()).slice(0, 300);
      return { ok: false, error: `Media lookup HTTP ${meta.status}: ${detail}` };
    }
    const info = (await meta.json()) as { url?: string; mime_type?: string };
    if (!info.url) return { ok: false, error: "media metadata returned no url" };

    const bin = await fetch(info.url, {
      headers: { Authorization: `Bearer ${env.whatsappAccessToken}` },
    });
    if (!bin.ok) {
      return { ok: false, error: `Media download HTTP ${bin.status}` };
    }
    const buf = Buffer.from(await bin.arrayBuffer());
    return { ok: true, buffer: buf, mime: info.mime_type ?? "audio/ogg" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}