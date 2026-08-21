import { env } from "../config.js";
import { buildReceipt, toBase64, type ReceiptOrder } from "./receipt.js";

export type EmailResult = { ok: true; to: string } | { ok: false; error: string };

type OrderEmail = ReceiptOrder & { email?: string | null };

async function resendSend(payload: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!env.resendApiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set — email disabled" };
  }
  try {
    const res = await fetch(env.resendApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.resendApiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return { ok: false, error: `Resend HTTP ${res.status}: ${detail}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id ?? "unknown" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Where the email is delivered.
 * - sandbox mode (default, no verified Resend domain): always the owner's
 *   verified inbox so delivery works on the free tier. The customer's parsed
 *   email is surfaced in the subject/body instead.
 * - customer mode (after domain verification): the customer's parsed email,
 *   falling back to the owner's inbox when none was captured.
 */
function deliveryRecipient(order: OrderEmail): { to: string; customerNote: string } {
  const parsed = order.email?.trim().toLowerCase() ?? "";
  const validParsed = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed) ? parsed : "";

  if (env.emailDelivery === "customer") {
    return { to: validParsed || env.emailTo, customerNote: "" };
  }
  const note = validParsed && validParsed !== env.emailTo.toLowerCase() ? ` (customer email: ${validParsed})` : "";
  return { to: env.emailTo, customerNote: note };
}

/** Confirmed order → confirmation email with the PDF receipt attached. */
export async function sendReceiptEmail(order: OrderEmail): Promise<EmailResult> {
  const { to, customerNote } = deliveryRecipient(order);
  const pdf = await buildReceipt(order);

  const html = [
    `<div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">`,
    `<h2 style="color: #d97b19;">Order confirmed 🎉</h2>`,
    `<p>Hi${order.customerName ? " " + order.customerName : ""},</p>`,
    `<p>Your order has been <strong>confirmed</strong>:</p>`,
    `<p style="padding: 12px 16px; background: #f7f4ef; border-radius: 8px;">${order.summary}</p>`,
    order.deliveryDate ? `<p>📅 Delivery: <strong>${order.deliveryDate}</strong>${order.deliveryTime ? " at " + order.deliveryTime : ""}</p>` : "",
    order.total ? `<p>💰 Total: <strong>₹${order.total}</strong></p>` : "",
    `<p>Your receipt is attached as a PDF — served fresh from an automation, not a human.</p>`,
    customerNote ? `<p style="color: #777; font-size: 13px;">🔒 Sandbox demo: delivered to the owner's verified inbox${customerNote}.</p>` : "",
    `<p style="color: #777; font-size: 12px;">Tiffin Butler · WhatsApp orders, parsed by AI, approved by you · Notion hackathon</p>`,
    `</div>`,
  ].join("");

  return resendSend({
    from: env.emailFrom,
    to,
    subject: `Order confirmed — ${order.summary.slice(0, 60)}${customerNote}`,
    html,
    attachments: [{ filename: `receipt-${order.id.slice(-7)}.pdf`, content: toBase64(pdf) }],
  }).then((r) => (r.ok ? { ok: true, to } : r));
}

/** Daily owner digest — always to the owner's inbox (EMAIL_TO). */
export async function sendDigestEmail(subject: string, html: string): Promise<EmailResult> {
  if (!env.resendApiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set — email disabled" };
  }
  const r = await resendSend({ from: env.emailFrom, to: env.emailTo, subject, html });
  return r.ok ? { ok: true, to: env.emailTo } : { ok: false, error: r.error };
}

/** Rejected order → short decline email (no receipt). */
export async function sendRejectionEmail(order: OrderEmail): Promise<EmailResult> {
  const { to, customerNote } = deliveryRecipient(order);

  const html = [
    `<div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">`,
    `<h2 style="color: #c0392b;">Order declined</h2>`,
    `<p>Hi${order.customerName ? " " + order.customerName : ""},</p>`,
    `<p>We are sorry — your order could not be accepted:</p>`,
    `<p style="padding: 12px 16px; background: #f7f4ef; border-radius: 8px;">${order.summary}</p>`,
    `<p>Please contact the mess directly if you think this is a mistake.</p>`,
    customerNote ? `<p style="color: #777; font-size: 13px;">🔒 Sandbox demo: delivered to the owner's verified inbox${customerNote}.</p>` : "",
    `<p style="color: #777; font-size: 12px;">Tiffin Butler · Notion hackathon</p>`,
    `</div>`,
  ].join("");

  return resendSend({
    from: env.emailFrom,
    to,
    subject: `Order declined — ${order.summary.slice(0, 60)}${customerNote}`,
    html,
  }).then((r) => (r.ok ? { ok: true, to } : r));
}