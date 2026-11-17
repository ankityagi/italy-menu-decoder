/* Menu Decoder — offline Italian menu explainer.
   OCR: Tesseract.js (on-device, WASM). Grounding: glossary.js. No network after first load. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- text normalisation ----------
  const STOP = new Set('di del della dello dei degli delle al alla alle allo ai agli e ed con in a da la il lo le i gli d l all dell nel nella sul sulla o su per un una'.split(' '));
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`´]/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const toks = s => norm(s).split(' ').filter(w => w && !STOP.has(w) && !/^\d+$/.test(w));

  // Letters that handwriting OCR commonly confuses cost half an edit.
  const CONF = new Set();
  ['ilt1j', 'iu', 'uv', 'un', 'aoe', 'ce', 'mn', 'rn', 'mr', 'gq9', 'hb'].forEach(g => {
    for (const x of g) for (const y of g) if (x !== y) CONF.add(x + y);
  });
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const x = a[i - 1], y = b[j - 1];
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x === y ? 0 : CONF.has(x + y) ? 0.5 : 1));
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  // OCR-tolerant word similarity (0..1): `ref` is a glossary word, `w` a word read from the menu.
  // Short words must match exactly, and a menu word that is itself a known Italian menu word
  // is never "corrected" into a different one (pollo must not become polpo).
  const VOCAB = new Set();
  function sim(ref, w) {
    if (ref === w) return 1;
    if (Math.min(ref.length, w.length) <= 3 || VOCAB.has(w)) return 0;
    return 1 - lev(ref, w) / Math.max(ref.length, w.length);
  }
  const thresh = w => (w.length >= 7 ? 0.74 : 0.79);

  // ---------- glossary index ----------
  const INGREDIENT = new Set(Object.keys(TERMS).map(norm));
  const INDEX = [];
  DISHES.forEach((d, i) => {
    const phrases = new Set();
    [d.n, ...(d.a || [])].forEach(p => p.replace(/\(.*?\)/g, '').split('/').forEach(x => phrases.add(x)));
    // A one-word alias that is just an ingredient ("patate", "funghi") only counts when it leads the line,
    // so "Pollo con patate" is not mistaken for the potato side dish. Signature words ("carbonara") match anywhere.
    phrases.forEach(p => { const t = toks(p); if (t.length) INDEX.push({ i, t, lead: t.length === 1 && INGREDIENT.has(t[0]) }); });
  });
  const TERM_LIST = Object.entries(TERMS).map(([k, v]) => ({ k: norm(k).split(' '), gloss: v[0], hint: v[1] }))
    .sort((x, y) => y.k.length - x.k.length);
  const HEADER_MAP = Object.fromEntries(Object.entries(HEADERS).map(([k, v]) => [norm(k), v]));
  INDEX.forEach(e => e.t.forEach(w => VOCAB.add(w)));
  TERM_LIST.forEach(t => t.k.forEach(w => VOCAB.add(w)));
  Object.keys(HEADER_MAP).forEach(k => k.split(' ').forEach(w => VOCAB.add(w)));

  function scorePhrase(pt, lt) {
    let total = 0; const used = new Set();
    for (const p of pt) {
      let best = 0, bj = -1;
      lt.forEach((l, j) => { if (!used.has(j)) { const s = sim(p, l); if (s > best) { best = s; bj = j; } } });
      if (best < thresh(p)) return null;
      used.add(bj); total += best;
    }
    return { n: pt.length, avg: total / pt.length, used };
  }

  function matchLine(text) {
    const lt = toks(text);
    if (!lt.length) return [];
    const best = new Map(); // dish index -> best hit
    for (const e of INDEX) {
      const r = scorePhrase(e.t, lt);
      if (!r || (e.lead && !r.used.has(0))) continue;
      const score = r.n + r.avg + 0.2 * (r.n / lt.length);
      const prev = best.get(e.i);
      if (!prev || score > prev.score) best.set(e.i, { i: e.i, score, used: r.used, pt: e.t });
    }
    const hits = [...best.values()].sort((a, b) => b.score - a.score);
    if (!hits.length) return [];
    const out = [hits[0]];
    // a secondary match that explains different words (e.g. "Pici" + "Cacio e pepe")
    const sec = hits.slice(1).find(h => [...h.used].every(j => !hits[0].used.has(j)));
    if (sec) out.push(sec);
    const res = out.map(h => DISHES[h.i]);
    res.usedWords = new Set(out.flatMap(h => [...h.used].map(j => lt[j]).concat(h.pt)));
    return res;
  }

  function decodeWords(text) {
    const w = norm(text).split(' ').filter(x => x && !/^\d+$/.test(x));
    const glosses = [], unknown = [], hints = [];
    let i = 0;
    while (i < w.length) {
      let hit = null;
      for (const t of TERM_LIST) {
        const seg = w.slice(i, i + t.k.length);
        if (seg.length !== t.k.length) continue;
        const ok = t.k.every((k, j) => k === seg[j] || (!STOP.has(k) && sim(k, seg[j]) >= (k.length >= 6 ? 0.74 : 0.8)));
        if (ok) { hit = t; break; }
      }
      if (hit) { glosses.push([w.slice(i, i + hit.k.length).join(' '), hit.gloss]); if (hit.hint) hints.push(hit.hint); i += hit.k.length; }
      else { if (!STOP.has(w[i]) && w[i].length > 2) unknown.push(w[i]); i++; }
    }
    const pri = ['primo', 'pizza', 'dolce', 'secondo', 'antipasto', 'contorno'];
    const hint = pri.find(p => hints.includes(p)) || null;
    return { glosses, unknown, hint };
  }

  const num = (a, b) => parseFloat(a + (b ? '.' + b : ''));
  function parsePrice(raw) {
    const s = raw.replace(/(^|[^\d,.])[13]\s*\/\s*[248]\b/g, '$1 '); // ignore 1/4, 1/2 (wine carafes)
    // "7/Hg", "4,5/hg", "55/kg": a price followed by a slash is priced by weight (OCR often garbles the unit)
    const slash = s.match(/(\d{1,3})(?:[.,](\d{1,2}))?\s*\/\s*([a-z0-9]{1,3})\b/i);
    const perWeight = !!slash || /\b(s\s*\.?\s*q\b|etto|\d\s*hg\b|al\s*kg|al\s*chilo|per\s*100\s*g)/i.test(raw);
    if (slash) return { price: num(slash[1], slash[2]), perWeight, perKg: /^k/i.test(slash[3]) };
    const range = s.match(/(\d{1,3})(?:[.,](\d{1,2}))?\s*[-–]\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*(?:€|$)/);
    if (range) return { price: num(range[1], range[2]), priceHi: num(range[3], range[4]), perWeight };
    const nums = [...s.matchAll(/(\d{1,3})(?:[.,](\d{1,2}))?/g)].map(m => num(m[1], m[2])).filter(v => v >= 1 && v <= 250);
    return { price: nums.length ? nums[nums.length - 1] : null, perWeight };
  }

  function cleanName(raw) {
    return raw.replace(/([a-zà-ù])[\/|\\!](?=[a-zà-ù]{2})/gi, '$1l') // "Sa/timbocca": a stroke read as a slash
      .replace(/[€]|\beur(o)?\b/gi, ' ').replace(/\/\s*[a-z0-9]{1,3}\s*$/i, ' ').replace(/\d+([.,]\d+)?/g, ' ')
      .replace(/[._–—=~*|]{2,}/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[-•·*.,:;]+|[-•·.,:;]+$/g, '').trim();
  }

  // OCR often mangles big underlined headers ("Dolci" → "Dole;"). Accept a loose match for short lines.
  const HEAD_WORDS = { antipasti: 'antipasto', primi: 'primo', secondi: 'secondo', contorni: 'contorno', dolci: 'dolce', dessert: 'dolce', pizze: 'pizza', bevande: 'bevanda' };
  const NEXT = { null: 'primo', antipasto: 'primo', primo: 'secondo', secondo: 'contorno' };
  function fuzzyHeader(n, section) {
    const words = n.split(' ');
    let best = null, bs = 0;
    // a short line that starts with a course word ("Secondi piatti") is a header even if the rest resembles a dish
    if (words.length <= 2 && words[0].length >= 4) {
      for (const [k, v] of Object.entries(HEAD_WORDS)) { const s = 1 - lev(words[0], k) / Math.max(words[0].length, k.length); if (s > bs) { bs = s; best = v; } }
      if (bs >= 0.8) return best;
      best = null; bs = 0;
    }
    if (matchLine(n).length) return null; // it's a dish, not a header
    const tryKey = (w, k, v) => { const s = 1 - lev(w, k) / Math.max(w.length, k.length); if (s > bs) { bs = s; best = v; } };
    for (const [k, v] of Object.entries(HEADER_MAP)) if (k.length >= 5 && Math.abs(k.length - n.length) <= 3) tryKey(n, k, v);
    for (const w of words) if (w.length >= 4) for (const [k, v] of Object.entries(HEAD_WORDS)) tryKey(w, k, v);
    if (bs >= 0.6) return best;
    // "… piatti" with an unreadable first word: assume the next course in the usual order
    if (words.some(w => w.length >= 5 && 1 - lev(w, 'piatti') / Math.max(w.length, 6) >= 0.6)) return NEXT[section] || null;
    return null;
  }

  function analyse(text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let section = null, lastDish = null; const items = [];
    for (const raw of lines) {
      const name = cleanName(raw);
      const n = norm(name);
      if ((n.match(/[a-z]/g) || []).length < 3) continue;
      const pr = parsePrice(raw);
      const hdr = HEADER_MAP[n] || (pr.price == null && n.split(' ').length <= 3 && fuzzyHeader(n, section));
      if (hdr) { section = hdr; lastDish = null; items.push({ type: 'header', course: section, raw: name }); continue; }
      const matches = matchLine(name);
      const dec = decodeWords(name);
      if (matches.length) {
        // words on the line that the matched dish doesn't already explain
        const extras = dec.glosses.filter(([w]) => !toks(w).every(t => [...matches.usedWords].some(u => u === t || sim(u, t) >= 0.74)));
        lastDish = matches[0];
        // a 3-digit price far above the usual range is a misread ("16" seen as "168"): drop the stray digit
        if (pr.price >= 100 && !pr.perWeight && !lastDish.perKg && pr.price > lastDish.p[1] * 4) pr.price = Math.floor(pr.price / 10);
        items.push({ type: 'dish', raw: name, ...pr, dish: matches[0], also: matches[1], extras, section });
      } else {
        // "● Chianina 7/hg" under a dish is a choice for that dish, not a dish of its own
        const parent = /^\s*[@©•●◦○*·\-–]/.test(raw) && lastDish ? lastDish : null;
        items.push({ type: 'unknown', raw: parent ? name.replace(/^[^a-zA-ZÀ-ù]+/, '') : name, ...pr, ...dec, section, parent, course: parent ? parent.c : section || dec.hint });
      }
    }
    return items;
  }

  // ---------- rendering ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = v => '€' + (Number.isInteger(v) ? v : v.toFixed(2).replace('.', ','));
  const TAGS = { pork: '🐖 pork', beef: '🐄 beef/veal', lamb: '🐑 lamb', game: '🦌 game', fish: '🐟 fish', shellfish: '🦐 shellfish',
    veg: '🌱 vegetarian', vegan: '🌿 vegan', offal: '🫀 offal', raw: '🥩 raw', nuts: '🥜 nuts' };
  let region = '';
  try { region = localStorage.getItem('md-region') || ''; } catch (e) {}

  function courseChip(c) {
    if (!c || !COURSES[c]) return '';
    return `<span class="chip c-${c}" title="${esc(COURSES[c].en)}">${COURSES[c].label}</span>`;
  }

  function localsBadge(d) {
    if (d.trap) return `<span class="badge trap">⚠️ Tourist dish</span>`;
    if (!d.l) return `<span class="badge meh">Locals rarely order</span>`;
    const regs = d.r || [];
    if (!region || !regs.length) return `<span class="badge locals">✔ Locals order this</span>`;
    if (regs.includes(region)) return `<span class="badge locals strong">★ Local specialty here</span>`;
    return `<span class="badge away">Specialty of ${esc(regs.map(r => REGIONS[r].split(' /')[0]).join(', '))}</span>`;
  }

  function priceLine(d, it = {}) {
    const { price = null, priceHi = null, perWeight = false } = it;
    const unit = d.perKg ? ' / kg' : d.perEtto ? ' / etto (100 g)' : '';
    const typ = `<span class="typ">Typical ${eur(d.p[0])}–${eur(d.p[1])}${unit}</span>`;
    if (price == null) return (perWeight ? `<span class="menu-price p-fair">Priced by weight. Ask how much it weighs</span>` : '') + typ;
    const verdict = v => v < d.p[0] * 0.8 ? ['low', 'cheap'] : v > d.p[1] * 1.25 ? ['high', 'pricey'] : ['fair', 'fair price'];
    let shown = eur(price) + (priceHi != null ? '–' + eur(priceHi).slice(1) : ''), cls = 'fair', label = '';
    const byWeight = perWeight || d.perKg || d.perEtto;
    if (!byWeight) [cls, label] = verdict(priceHi != null ? (price + priceHi) / 2 : price);
    else if (d.perKg) {
      // steak by weight: menus quote per etto (100 g) or per kg; small numbers are per etto
      const perEtto = !it.perKg && price <= 15, kg = perEtto ? price * 10 : price;
      shown = perEtto ? `${eur(price)} per etto = ${eur(kg)}/kg` : `${eur(price)}/kg`;
      [cls, label] = verdict(kg);
    } else if (d.perEtto) { shown += ' per etto (100 g)'; [cls, label] = verdict(price); }
    else { shown += it.perKg ? '/kg' : ' per etto (100 g)'; label = 'by weight, ask the portion size'; }
    return `<span class="menu-price p-${cls}">Menu ${shown}${label ? ' · ' + label : ''}</span>` + typ;
  }

  function dishCard(d, opts = {}) {
    const written = opts.raw && norm(opts.raw) !== norm(d.n) ? `<div class="written">“${esc(opts.raw)}”</div>` : '';
    const tags = (d.t || []).map(t => `<span class="tag">${TAGS[t] || t}</span>`).join('');
    const also = opts.also ? `<details class="also"><summary>Also mentions: ${esc(opts.also.n)}</summary><p>${esc(opts.also.d)}</p></details>` : '';
    const ctx = opts.section && opts.section !== d.c && COURSES[opts.section] ? `<span class="muted"> · listed under ${COURSES[opts.section].label}</span>` : '';
    return `<article class="card">
      ${written}
      <header><h3>${esc(d.n)}</h3>${courseChip(d.c)}</header>
      <div class="badges">${localsBadge(d)}${ctx}</div>
      <p class="desc">${esc(d.d)}</p>
      ${d.tip ? `<p class="tip">💡 ${esc(d.tip)}</p>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      ${opts.extras && opts.extras.length ? `<p class="extras">Also on this line: ${opts.extras.map(([w, e]) => `<b>${esc(w)}</b> ${esc(e)}`).join(' · ')}</p>` : ''}
      ${d.c !== 'altro' ? `<div class="price">${priceLine(d, opts)}</div>` : ''}
      ${also}
    </article>`;
  }

  function unknownCard(it) {
    const g = it.glosses.length
      ? `<p class="desc">≈ ${it.glosses.map(([w, e]) => `<b>${esc(w)}</b> ${esc(e)}`).join(' · ')}${it.unknown.length ? ` · <i class="muted">${esc(it.unknown.join(' '))}</i>` : ''}</p>`
      : `<p class="desc muted">No known words. Possibly an OCR misread. Tap ✏️ Edit text to fix it.</p>`;
    const range = it.priceHi != null ? '–' + eur(it.priceHi).slice(1) : '';
    const pr = it.parent ? `<div class="price">${priceLine(it.parent, it)}</div>`
      : it.price != null ? `<div class="price"><span class="menu-price p-fair">Menu ${eur(it.price)}${range}${it.perWeight ? (it.perKg ? '/kg' : ' per etto (100 g)') : ''}</span></div>`
      : it.perWeight ? `<div class="price"><span class="menu-price p-fair">Priced by weight. Ask how much it weighs</span></div>` : '';
    if (it.parent) return `<article class="card unknown option">
      <header><h3>${esc(it.raw)}</h3>${courseChip(it.course)}</header>
      <div class="badges"><span class="badge meh">Choice for ${esc(it.parent.n)}</span></div>
      ${it.glosses.length ? g : ''}${pr}
    </article>`;
    return `<article class="card unknown ${it.glosses.length ? '' : 'faint'}">
      <header><h3>${esc(it.raw)}</h3>${courseChip(it.course)}</header>
      <div class="badges"><span class="badge meh">Not in glossary · word-by-word</span></div>
      ${g}${pr}
    </article>`;
  }

  const PLURAL = { antipasto: 'Antipasti', primo: 'Primi', secondo: 'Secondi', contorno: 'Contorni', pizza: 'Pizze', dolce: 'Dolci', bevanda: 'Bevande' };
  function render(items) {
    const out = $('#results');
    if (!items.length) { out.innerHTML = `<p class="empty">Nothing readable found. Try a closer, well-lit photo, or paste the text.</p>`; return; }
    const known = items.filter(i => i.type === 'dish').length, total = items.filter(i => i.type !== 'header' && !i.parent).length;
    let html = `<p class="summary">${known} of ${total} lines matched the glossary.</p>`;
    for (const it of items) {
      if (it.type === 'header') html += `<h2 class="section">${PLURAL[it.course] || esc(it.raw)} <span class="muted">· ${esc(COURSES[it.course].en)}</span></h2>`;
      else if (it.type === 'dish') html += dishCard(it.dish, it);
      else html += unknownCard(it);
    }
    out.innerHTML = html;
  }

  function decode() {
    const text = $('#text').value;
    render(analyse(text));
    try {
      if (text.trim().length > 10) {
        const hist = JSON.parse(localStorage.getItem('md-history') || '[]').filter(h => h.text !== text);
        hist.unshift({ text, at: Date.now() });
        localStorage.setItem('md-history', JSON.stringify(hist.slice(0, 8)));
        renderHistory();
      }
    } catch (e) {}
  }

  function renderHistory() {
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem('md-history') || '[]'); } catch (e) {}
    const el = $('#history');
    if (!hist.length) { el.hidden = true; return; }
    el.hidden = false;
    $('#history-list').innerHTML = hist.map((h, i) => {
      const first = h.text.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 2).join(' · ');
      return `<li><button data-h="${i}">${esc(first.slice(0, 60))}<span class="muted"> · ${new Date(h.at).toLocaleDateString()}</span></button></li>`;
    }).join('');
    $$('#history-list button').forEach(b => b.onclick = () => {
      $('#text').value = hist[+b.dataset.h].text; showText(true); decode(); window.scrollTo({ top: $('#results').offsetTop - 70, behavior: 'smooth' });
    });
  }

  // ---------- OCR ----------
  let worker = null, progressCb = null;
  async function getWorker() {
    if (worker) return worker;
    worker = await Tesseract.createWorker('ita', 1, {
      workerPath: './vendor/worker.min.js', corePath: './vendor/core', langPath: './vendor/lang',
      gzip: true, workerBlobURL: false, logger: m => progressCb && progressCb(m)
    });
    return worker;
  }

  async function prepImage(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const long = Math.max(bmp.width, bmp.height);
    const scale = long > 2200 ? 2200 / long : long < 1600 ? Math.min(2, 1600 / long) : 1; // small images are enlarged
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const preview = c.toDataURL('image/jpeg', 0.6);
    const img = ctx.getImageData(0, 0, w, h), px = img.data;
    // Local-mean threshold (Bradley): turns ink black and paper white even under shadows and uneven light.
    const W1 = w + 1, I = new Float64Array(W1 * (h + 1)), g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, v = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
        g[y * w + x] = v; row += v; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row;
      }
    }
    const r = Math.round(Math.max(w, h) / 40);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const mean = (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
        const i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = g[y * w + x] < mean * 0.85 ? 0 : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    c.preview = preview;
    return c;
  }

  async function scan(file) {
    const status = $('#scan-status'), bar = $('#bar');
    status.hidden = false;
    const set = (msg, p) => { $('#scan-msg').textContent = msg; bar.style.width = Math.round((p || 0) * 100) + '%'; };
    try {
      set('Preparing photo…', 0.05);
      const canvas = await prepImage(file);
      $('#preview').src = canvas.preview; $('#preview').hidden = false;
      progressCb = m => {
        if (m.status === 'recognizing text') set('Reading menu on your phone…', 0.3 + m.progress * 0.7);
        else set('Loading reader…', 0.1 + (m.progress || 0) * 0.2);
      };
      const w = await getWorker();
      const { data } = await w.recognize(canvas, { rotateAuto: true });
      const lines = (data.text || '').split('\n').map(s => s.trim()).filter(s => s.length > 1);
      $('#text').value = lines.join('\n');
      set('Done', 1);
      setTimeout(() => (status.hidden = true), 600);
      showText(false);
      decode();
      $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      set('Could not read the photo: ' + (err && err.message || err), 0);
    }
  }

  // ---------- glossary browser ----------
  function renderBrowse() {
    const q = norm($('#q').value), c = $('#course-filter').value;
    const list = DISHES.filter(d => (!c || d.c === c) && (!q || norm([d.n, ...(d.a || []), d.d].join(' ')).includes(q)))
      .sort((a, b) => {
        const ra = region && a.r.includes(region) ? 0 : 1, rb = region && b.r.includes(region) ? 0 : 1;
        return ra - rb || COURSES[a.c].order - COURSES[b.c].order || a.n.localeCompare(b.n, 'it');
      });
    $('#browse-count').textContent = `${list.length} dish${list.length === 1 ? '' : 'es'}`;
    $('#browse-list').innerHTML = list.map(d => dishCard(d)).join('') ||
      `<p class="empty">Not in the glossary. Try the word-by-word decoder: paste it on the Menu tab.</p>`;
  }

  function renderTips() {
    $('#tips-list').innerHTML = TIPS.map(([h, t]) => `<article class="card"><h3>${esc(h)}</h3><p class="desc">${esc(t)}</p></article>`).join('') +
      `<article class="card"><h3>Courses at a glance</h3>${Object.entries(COURSES).filter(([k]) => k !== 'altro')
        .map(([k, v]) => `<p class="desc">${courseChip(k)} ${esc(v.en)}</p>`).join('')}</article>`;
  }

  // ---------- UI wiring ----------
  function showText(open) { $('#text-wrap').open = open; }

  function setTab(name) {
    $$('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
    $$('.panel').forEach(p => (p.hidden = p.id !== 'panel-' + name));
    if (name === 'browse') renderBrowse();
    try { localStorage.setItem('md-tab', name); } catch (e) {}
  }

  function init() {
    const sel = $('#region');
    sel.innerHTML = `<option value="">All of Italy</option>` + Object.entries(REGIONS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    sel.value = region;
    sel.onchange = () => {
      region = sel.value;
      try { localStorage.setItem('md-region', region); } catch (e) {}
      if ($('#text').value.trim()) decode();
      if (!$('#panel-browse').hidden) renderBrowse();
    };
    $('#course-filter').innerHTML = `<option value="">All courses</option>` +
      Object.entries(COURSES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

    $$('.tab').forEach(t => (t.onclick = () => setTab(t.dataset.tab)));
    $('#photo').onchange = e => { const f = e.target.files[0]; if (f) scan(f); e.target.value = ''; };
    $('#paste').onclick = async () => {
      showText(true);
      try { const t = await navigator.clipboard.readText(); if (t) { $('#text').value = t; decode(); return; } } catch (e) {}
      $('#text').focus();
    };
    $('#decode').onclick = decode;
    $('#clear').onclick = () => { $('#text').value = ''; $('#results').innerHTML = ''; $('#preview').hidden = true; };
    let t; $('#text').addEventListener('input', () => { clearTimeout(t); t = setTimeout(decode, 500); });
    $('#q').addEventListener('input', renderBrowse);
    $('#course-filter').onchange = renderBrowse;
    $('#demo').onclick = e => {
      e.preventDefault();
      $('#text').value = 'ANTIPASTI\nFiori di zucca fritti 7\nSuppli al telefono 2,50\nCarciofi alla giudia 9\nPRIMI\nTonnarelli cacio e pepe 12\nRigatoni carbonara 13\nBucatini amatriciana 12\nFettuccine Alfredo 16\nSECONDI\nSaltimbocca alla romana 17\nCoda alla vaccinara 18\nOrata al forno S.Q.\nFiletto di maiale al pepe verde 16\nCONTORNI\nCicoria ripassata 5\nPatate al forno 5\nDOLCI\nTiramisu della casa 6\nCrostata ricotta e visciole 6\nCoperto 2,50';
      showText(true); decode();
    };

    renderTips(); renderHistory();
    let tab = 'menu'; try { tab = localStorage.getItem('md-tab') || 'menu'; } catch (e) {}
    setTab(tab);
    offlineStatus();
  }

  // ---------- offline readiness ----------
  async function offlineStatus() {
    const pill = $('#offline');
    const set = (cls, txt) => { pill.className = 'pill ' + cls; pill.textContent = txt; };
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') { set('warn', 'Offline mode needs https'); return; }
    try {
      await navigator.serviceWorker.register('sw.js');
      const check = async () => {
        const keys = await caches.keys();
        for (const k of keys) {
          const c = await caches.open(k);
          if (await c.match('vendor/lang/ita.traineddata.gz')) { set('ok', '✓ Works offline'); return true; }
        }
        set('wait', 'Saving for offline…'); return false;
      };
      if (!(await check())) {
        navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'cached') check(); });
        const iv = setInterval(async () => { if (await check()) clearInterval(iv); }, 2000);
      }
    } catch (e) { set('warn', 'Offline cache unavailable'); }
  }

  window.MenuDecoder = { analyse, matchLine, decodeWords }; // for testing
  document.addEventListener('DOMContentLoaded', init);
})();
