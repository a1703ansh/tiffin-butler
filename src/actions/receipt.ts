import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { business } from "../business.config.js";

export type ReceiptLine = {
  name: string;
  quantity: number;
  lineTotal: number;
};

export type ReceiptOrder = {
  id: string;
  summary: string;
  items?: string;
  total?: number | null;
  deliveryDate?: string | null;
  deliveryTime?: string | null;
  room?: string | null;
  customerName?: string | null;
};

const CURRENCY = "Rs.";

function receiptRef(id: string): string {
  return id.replace(/[^0-9a-f]/gi, "").slice(-7).toUpperCase();
}

/**
 * The Items string is written by pricing.formatLineItems as
 * "2× Idli set (₹40) · 1× Dosa (₹60)". Convert it back to lines.
 */
function parseItems(items?: string | null): ReceiptLine[] {
  if (!items) return [];
  const out: ReceiptLine[] = [];
  for (const part of items.split("\u00B7")) {
    const m = part.trim().match(/^(\d+)\u00D7\s*(.+?)\s*\([^\d]*(\d+)\)$/);
    if (m) {
      const quantity = Number(m[1]);
      const unitPrice = Number(m[3]) || 0;
      out.push({ name: m[2], quantity, lineTotal: quantity * unitPrice });
    }
  }
  return out.filter((l) => l.quantity > 0 && l.lineTotal > 0);
}

/** Build a PDF receipt for a confirmed order. Returns raw PDF bytes. */
export async function buildReceipt(order: ReceiptOrder): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.13, 0.13, 0.15);
  const muted = rgb(0.45, 0.45, 0.48);
  const accent = rgb(0.85, 0.45, 0.1);
  const rule = rgb(0.9, 0.9, 0.92);

  const margin = 56;
  const right = 595 - margin;
  let y = 842 - margin;

  const lines = parseItems(order.items);
  const total = order.total ?? lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const when = [order.deliveryDate, order.deliveryTime].filter(Boolean).join(" ") || "as agreed";

  // Header
  page.drawText(business.name.toUpperCase(), { x: margin, y, size: 20, font: bold, color: accent });
  y -= 22;
  page.drawText(business.tagline, { x: margin, y, size: 9, font, color: muted });
  y -= 36;
  page.drawLine({ start: { x: margin, y }, end: { x: right, y }, thickness: 1, color: rule });
  y -= 30;

  // Title
  page.drawText("ORDER CONFIRMED", { x: margin, y, size: 16, font: bold, color: ink });
  y -= 20;
  page.drawText(
    `Receipt ${receiptRef(order.id)}  ·  ${new Date().toLocaleString("en-IN", { timeZone: business.timezone })}`,
    { x: margin, y, size: 9, font, color: muted },
  );
  y -= 34;

  // Item table
  page.drawText("ITEM", { x: margin, y, size: 10, font: bold, color: muted });
  page.drawText("AMOUNT", { x: right - 80, y, size: 10, font: bold, color: muted });
  y -= 18;

  const itemRows = lines.length > 0 ? lines : [{ name: order.summary, quantity: 1, lineTotal: total }];
  for (const row of itemRows) {
    page.drawText(`${row.quantity}\u00D7 ${row.name}`, { x: margin, y, size: 12, font, color: ink });
    page.drawText(`${CURRENCY} ${row.lineTotal}`, { x: right - 80, y, size: 12, font, color: ink });
    y -= 20;
  }

  page.drawLine({ start: { x: margin, y: y + 6 }, end: { x: right, y: y + 6 }, thickness: 0.5, color: rule });
  y -= 12;
  page.drawText("TOTAL", { x: right - 130, y, size: 12, font: bold, color: ink });
  page.drawText(`${CURRENCY} ${total}`, { x: right - 80, y, size: 12, font: bold, color: accent });
  y -= 40;

  // Delivery details
  if (order.customerName) {
    page.drawText(`Customer:  ${order.customerName}`, { x: margin, y, size: 11, font, color: ink });
    y -= 18;
  }
  page.drawText(`When:      ${when}`, { x: margin, y, size: 11, font, color: ink });
  y -= 18;
  if (order.room) {
    page.drawText(`Where:     Room ${order.room}`, { x: margin, y, size: 11, font, color: ink });
    y -= 18;
  }
  y -= 18;

  // Footer
  page.drawLine({ start: { x: margin, y }, end: { x: right, y }, thickness: 1, color: rule });
  y -= 28;
  page.drawText("Generated automatically by Tiffin Butler — powered by Notion, for the Notion hackathon.", {
    x: margin,
    y,
    size: 8,
    font,
    color: muted,
  });

  return doc.save();
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}