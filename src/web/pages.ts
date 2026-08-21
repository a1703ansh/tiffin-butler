import type { Stats } from "./stats.js";

/** Server-rendered HTML for the public dashboard and the mobile order widget. */

const CSS = `
  :root { --brand:#d97b19; --ink:#2d2418; --paper:#faf6ef; --card:#ffffff; --line:#eadfce; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; background:var(--paper); color:var(--ink); line-height:1.5; }
  .wrap { max-width:760px; margin:0 auto; padding:20px 16px 48px; }
  header h1 { font-size:1.7rem; } header .tag { color:#8a7a63; margin-top:2px; }
  .pill { display:inline-block; padding:2px 10px; border-radius:99px; font-size:.78rem; font-weight:600; }
  .pill.ok { background:#e3f4e1; color:#256b2a; }
  a.btn, button.btn { display:inline-block; background:var(--brand); color:#fff; text-decoration:none; border:0;
    padding:10px 18px; border-radius:10px; font-size:1rem; cursor:pointer; }
  a.btn.ghost { background:#fff; color:var(--brand); border:1px solid var(--brand); }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:20px 0; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 16px; }
  .card .n { font-size:1.55rem; font-weight:700; } .card .l { color:#8a7a63; font-size:.82rem; }
  section { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; margin-top:14px; }
  section h2 { font-size:1rem; margin-bottom:10px; }
  table { width:100%; border-collapse:collapse; font-size:.92rem; }
  td, th { padding:6px 4px; border-bottom:1px solid var(--line); text-align:left; }
  tr:last-child td { border-bottom:0; }
  .price { text-align:right; white-space:nowrap; }
  .muted { color:#8a7a63; font-size:.8rem; }
  .run { display:flex; justify-content:space-between; gap:10px; padding:5px 0; border-bottom:1px dashed var(--line); font-family:ui-monospace,Consolas,monospace; font-size:.8rem; }
  .run:last-child { border-bottom:0; }
  .out { flex:none; } .success,.action{color:#256b2a} .needs_human,.duplicate{color:#a07414} .failed{color:#b3261e} .skipped{color:#777}
  form label { display:block; font-weight:600; font-size:.88rem; margin:12px 0 4px; }
  input, select { width:100%; padding:10px; border:1px solid var(--line); border-radius:10px; font-size:1rem; background:#fff; }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  #result { margin-top:14px; display:none; padding:14px; border-radius:12px; font-size:.95rem; }
  #result.ok { display:block; background:#e3f4e1; } #result.err { display:block; background:#fbe4e1; color:#8c1d18; }
  footer { margin-top:22px; color:#8a7a63; font-size:.8rem; text-align:center; }
`;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function landingPage(s: Stats): string {
  const menuRows = s.menu
    .map((m) => `<tr><td>${esc(m.name)}</td><td class="price">₹${m.price}</td></tr>`)
    .join("");
  const runBadge = (o: string) => `<span class="out ${esc(o)}">${esc(o)}</span>`;
  const runs = s.recentRuns.length
    ? s.recentRuns.map((r) => `<div class="run"><span>${esc(r.run)}</span>${runBadge(r.outcome)}</div>`).join("")
    : `<p class="muted">No runs logged yet.</p>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>Tiffin Butler — live dashboard</title><style>${CSS}</style></head>
<body><div class="wrap">
<header>
  <h1>🍛 Tiffin Butler <span class="pill ok">● running</span></h1>
  <p class="tag">Mess orders parsed by AI, approved by a human in Notion — this page is served by the code.</p>
</header>

<div class="cards">
  <div class="card"><div class="n">${s.today.orders}</div><div class="l">orders today</div></div>
  <div class="card"><div class="n">₹${s.today.revenue}</div><div class="l">confirmed revenue today</div></div>
  <div class="card"><div class="n">${s.today.pending}</div><div class="l">awaiting owner approval</div></div>
  <div class="card"><div class="n">${s.today.needsHuman}</div><div class="l">needs human review</div></div>
</div>

<section>
  <h2>Today's menu <span class="muted">(live from Notion · ${s.menuSource === "notion" ? "owner-editable" : "fallback config"})</span></h2>
  ${menuRows ? `<table><tr><th>Item</th><th class="price">Price</th></tr>${menuRows}</table>` : `<p class="muted">Menu unavailable right now.</p>`}
</section>

<section>
  <h2>Latest automation runs <span class="muted">(Run Log database)</span></h2>
  ${runs}
</section>

<section>
  <h2>Try it yourself</h2>
  <p style="margin-bottom:12px;">Place a real order from your phone — it goes through the exact same AI → pricing → human-approval pipeline as WhatsApp messages.</p>
  <a class="btn" href="/order">Order a tiffin →</a>
  <a class="btn ghost" href="/stats">JSON stats</a>
</section>

<footer>All-time orders: ${s.allTimeOrders} · updated ${esc(new Date(s.time).toLocaleTimeString("en-IN", { hour12: false }))} IST · refreshes every 60s · Notion hackathon build</footer>
</div></body></html>`;
}

export function orderFormPage(menu: { name: string; price: number }[]): string {
  const options = menu.map((m) => `<option value="${esc(m.name)}">${esc(m.name)} — ₹${m.price}</option>`).join("");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Order a tiffin</title><style>${CSS}</style></head>
<body><div class="wrap">
<header><h1>🍛 Order a tiffin</h1>
<p class="tag">Same pipeline as WhatsApp: AI parses it, prices it from the Notion menu, and the owner approves it in Notion.</p></header>

<section>
<form id="f">
  <label>Your name</label><input name="name" placeholder="Ravi" required>
  <label>Phone (10 digits)</label><input name="phone" placeholder="98765 00000" required>
  <div class="row">
    <div><label>Item 1</label><select name="item1">${options}<option value="">— none —</option></select></div>
    <div><label>Qty</label><input name="qty1" type="number" min="1" value="1"></div>
  </div>
  <div class="row">
    <div><label>Item 2 (optional)</label><select name="item2">${options}<option value="" selected>— none —</option></select></div>
    <div><label>Qty</label><input name="qty2" type="number" min="1" value="1"></div>
  </div>
  <div class="row">
    <div><label>When</label>
      <select name="when"><option value="today">Today</option><option value="tomorrow" selected>Tomorrow</option></select>
    </div>
    <div><label>Time</label><select name="time"><option>8am</option><option>12:30pm</option><option selected>1pm</option><option>8pm</option></select></div>
  </div>
  <label>Room / block</label><input name="room" placeholder="214">
  <br><br><button class="btn" type="submit">Send order</button>
</form>
<div id="result"></div>
</section>

<footer>Nothing is charged here — the owner still approves every order inside Notion before it's confirmed. · <a href="/">← dashboard</a></footer>
</div>
<script>
const f = document.getElementById('f'), r = document.getElementById('result');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(f);
  const items = [];
  for (const i of ['1','2']) {
    const item = fd.get('item'+i), qty = parseInt(fd.get('qty'+i) || '1', 10);
    if (item && qty > 0) items.push(qty + ' ' + item);
  }
  if (!items.length) { r.className='err'; r.textContent='Pick at least one item.'; return; }
  const msg = [
    fd.get('name') + ', phone ' + fd.get('phone'),
    items.join(' and '),
    fd.get('when'),
    fd.get('time'),
    fd.get('room') ? 'room ' + fd.get('room') : ''
  ].filter(Boolean).join(', ');
  r.className=''; r.textContent='Sending…';
  try {
    const res = await fetch('/order', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: msg }) });
    const data = await res.json();
    if (data.ok) {
      r.className='ok';
      r.textContent = data.status === 'created'
        ? '✅ Order received! It is now waiting for the owner\\u2019s approval in Notion' + (data.orderId ? ' (' + data.orderId.slice(0,8) + ')' : '') + '.'
        : 'ℹ️ Received — status: ' + data.status + '.';
    } else { r.className='err'; r.textContent='⚠️ ' + (data.error || 'Something went wrong.'); }
  } catch (err) { r.className='err'; r.textContent='⚠️ Network error — try again.'; }
});
</script>
</body></html>`;
}
