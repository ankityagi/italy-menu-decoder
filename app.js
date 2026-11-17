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

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  // OCR-tolerant word similarity (0..1). Short words must match exactly.
  function sim(a, b) {
    if (a === b) return 1;
    if (Math.min(a.length, b.length) <= 3) return 0;
    return 1 - lev(a, b) / Math.max(a.length, b.length);
  }
  const thresh = w => (w.length >= 7 ? 0.74 : 0.79);

  // ---------- glossary index ----------
  const INDEX = [];
  DISHES.forEach((d, i) => {
    const phrases = new Set();
    [d.n, ...(d.a || [])].forEach(p => p.replace(/\(.*?\)/g, '').split('/').forEach(x => phrases.add(x)));
    phrases.forEach(p => { const t = toks(p); if (t.length) INDEX.push({ i, t }); });
  });
  const TERM_LIST = Object.entries(TERMS).map(([k, v]) => ({ k: norm(k).split(' '), gloss: v[0], hint: v[1] }))
    .sort((x, y) => y.k.length - x.k.length);
  const HEADER_MAP = Object.fromEntries(Object.entries(HEADERS).map(([k, v]) => [norm(k), v]));

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
      if (!r) continue;
      const score = r.n + r.avg + 0.2 * (r.n / lt.length);
      const prev = best.get(e.i);
      if (!prev || score > prev.score) best.set(e.i, { i: e.i, score, used: r.used });
    }
    const hits = [...best.values()].sort((a, b) => b.score - a.score);
    if (!hits.length) return [];
    const out = [hits[0]];
    // a secondary match that explains different words (e.g. "Pici" + "Cacio e pepe")
    const sec = hits.slice(1).find(h => [...h.used].every(j => !hits[0].used.has(j)));
    if (sec) out.push(sec);
    return out.map(h => DISHES[h.i]);
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
        const ok = t.k.length === 1 ? sim(t.k[0], seg[0]) >= Math.max(0.8, thresh(t.k[0])) : t.k.every((k, j) => k === seg[j]);
        if (ok) { hit = t; break; }
      }
      if (hit) { glosses.push([w.slice(i, i + hit.k.length).join(' '), hit.gloss]); if (hit.hint) hints.push(hit.hint); i += hit.k.length; }
      else { if (!STOP.has(w[i]) && w[i].length > 2) unknown.push(w[i]); i++; }
    }
    const pri = ['primo', 'pizza', 'dolce', 'secondo', 'antipasto', 'contorno'];
    const hint = pri.find(p => hints.includes(p)) || null;
    return { glosses, unknown, hint };
  }

  function parsePrice(raw) {
    const s = raw.replace(/\b\d\s*\/\s*\d\b/g, ' '); // ignore 1/4, 1/2 (wine)
    const nums = [...s.matchAll(/(\d{1,3})(?:[.,](\d{1,2}))?/g)]
      .map(m => parseFloat(m[1] + (m[2] ? '.' + m[2] : '')))
      .filter(v => v >= 1 && v <= 250);
    const perWeight = /\b(s\s*\.?\s*q\b|etto|\/\s*hg|\bhg\b|al\s*kg|\/\s*kg|al\s*chilo|per\s*100\s*g)/i.test(raw);
    return { price: nums.length ? nums[nums.length - 1] : null, perWeight };
  }

  function cleanName(raw) {
    return raw.replace(/[€]|\beur(o)?\b/gi, ' ').replace(/\d+([.,]\d+)?/g, ' ')
      .replace(/[._–—=~*|]{2,}/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[-•·*.,:;]+|[-•·.,:;]+$/g, '').trim();
  }

  // OCR often mangles big underlined headers ("Dolci" → "Dole;"). Accept a loose match for short lines.
  function fuzzyHeader(n) {
    if (matchLine(n).length) return null; // it's a dish, not a header
    let best = null, bs = 0;
    for (const [k, v] of Object.entries(HEADER_MAP)) {
      if (k.length < 5 || Math.abs(k.length - n.length) > 3) continue;
      const s = 1 - lev(n, k) / Math.max(n.length, k.length);
      if (s > bs) { bs = s; best = v; }
    }
    return bs >= 0.6 ? best : null;
  }

  function analyse(text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let section = null; const items = [];
    for (const raw of lines) {
      const name = cleanName(raw);
      const n = norm(name);
      if ((n.match(/[a-z]/g) || []).length < 3) continue;
      const { price, perWeight } = parsePrice(raw);
      const hdr = HEADER_MAP[n] || (price == null && n.split(' ').length <= 2 && fuzzyHeader(n));
      if (hdr) { section = hdr; items.push({ type: 'header', course: section, raw: name }); continue; }
      const matches = matchLine(name);
      if (matches.length) items.push({ type: 'dish', raw: name, price, perWeight, dish: matches[0], also: matches[1], section });
      else {
        const dec = decodeWords(name);
        items.push({ type: 'unknown', raw: name, price, perWeight, ...dec, section, course: section || dec.hint });
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

  function priceLine(d, price, perWeight) {
    const unit = d.perKg ? ' / kg' : d.perEtto ? ' / etto (100 g)' : '';
    let s = `<span class="typ">Typical ${eur(d.p[0])}–${eur(d.p[1])}${unit}</span>`;
    if (price != null) {
      let v = 'fair', label = 'fair price';
      if (!unit && !perWeight) {
        if (price < d.p[0] * 0.8) { v = 'low'; label = 'cheap'; }
        else if (price > d.p[1] * 1.25) { v = 'high'; label = 'pricey'; }
      } else label = 'by weight';
      s = `<span class="menu-price p-${v}">Menu ${eur(price)}${perWeight ? ' (by weight)' : ''} · ${label}</span>` + s;
    } else if (perWeight) s = `<span class="menu-price p-fair">Priced by weight. Ask how much it weighs</span>` + s;
    return s;
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
      ${d.c !== 'altro' ? `<div class="price">${priceLine(d, opts.price ?? null, opts.perWeight)}</div>` : ''}
      ${also}
    </article>`;
  }

  function unknownCard(it) {
    const g = it.glosses.length
      ? `<p class="desc">≈ ${it.glosses.map(([w, e]) => `<b>${esc(w)}</b> ${esc(e)}`).join(' · ')}${it.unknown.length ? ` · <i class="muted">${esc(it.unknown.join(' '))}</i>` : ''}</p>`
      : `<p class="desc muted">No known words. Possibly an OCR misread. Tap ✏️ Edit text to fix it.</p>`;
    const pr = it.price != null ? `<div class="price"><span class="menu-price p-fair">Menu ${eur(it.price)}${it.perWeight ? ' (by weight)' : ''}</span></div>` : '';
    return `<article class="card unknown ${it.glosses.length ? '' : 'faint'}">
      <header><h3>${esc(it.raw)}</h3>${courseChip(it.course)}</header>
      <div class="badges"><span class="badge meh">Not in glossary · word-by-word</span></div>
      ${g}${pr}
    </article>`;
  }

  function render(items) {
    const out = $('#results');
    if (!items.length) { out.innerHTML = `<p class="empty">Nothing readable found. Try a closer, well-lit photo, or paste the text.</p>`; return; }
    const known = items.filter(i => i.type === 'dish').length, total = items.filter(i => i.type !== 'header').length;
    let html = `<p class="summary">${known} of ${total} lines matched the glossary.</p>`;
    for (const it of items) {
      if (it.type === 'header') html += `<h2 class="section">${esc(it.raw)} <span class="muted">· ${esc(COURSES[it.course].en)}</span></h2>`;
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
    const scale = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h), px = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) {
      const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
      px[i] = g; hist[g]++;
    }
    // contrast stretch between 2nd and 98th percentile
    const N = w * h; let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > N * 0.02) { lo = v; break; } }
    acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > N * 0.02) { hi = v; break; } }
    const k = 255 / Math.max(1, hi - lo);
    for (let i = 0; i < px.length; i += 4) { const g = Math.max(0, Math.min(255, (px[i] - lo) * k)); px[i] = px[i + 1] = px[i + 2] = g; }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  async function scan(file) {
    const status = $('#scan-status'), bar = $('#bar');
    status.hidden = false;
    const set = (msg, p) => { $('#scan-msg').textContent = msg; bar.style.width = Math.round((p || 0) * 100) + '%'; };
    try {
      set('Preparing photo…', 0.05);
      const canvas = await prepImage(file);
      $('#preview').src = canvas.toDataURL('image/jpeg', 0.7); $('#preview').hidden = false;
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
