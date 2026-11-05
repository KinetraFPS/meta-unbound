/* Deadlock Meta Auditor dashboard — reads window.META written by src/build.js */
(() => {
  const M = window.META;
  if (!M) { document.body.innerHTML = '<p style="padding:24px">No data. Run <code>node src/build.js</code> first.</p>'; return; }

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (x, d = 1) => (x == null ? '–' : (x * 100).toFixed(d) + '%');
  const sgn = (x, d = 1) => (x == null ? '–' : (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(d));
  const ppS = (x, d = 1) => (x == null ? '–' : sgn(x * 100, d) + 'pp');
  const H = Object.fromEntries(M.heroes.map((h) => [h.id, h]));
  const byName = Object.fromEntries(M.heroes.map((h) => [h.name, h]));
  const initials = (n) => n.replace(/^The /, '').split(/[\s&]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2);
  const avatar = (h) => h.img
    ? `<img class="avatar" src="${esc(h.img)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'avatar',textContent:'${esc(initials(h.name))}'}))">`
    : `<span class="avatar">${esc(initials(h.name))}</span>`;
  const heroCell = (id) => `<span class="hero">${avatar(H[id])}${esc(H[id].name)}</span>`;
  const divClass = (v, t) => (v >= t[2] ? 'cell-pos-3' : v >= t[1] ? 'cell-pos-2' : v >= t[0] ? 'cell-pos-1' : v <= -t[2] ? 'cell-neg-3' : v <= -t[1] ? 'cell-neg-2' : v <= -t[0] ? 'cell-neg-1' : 'cell-mid');
  const tierOf = (ctx, id) => M.tiers[ctx].find((r) => r.id === id);
  const verdictPill = (p) => (p ? `<span class="pill ${p.verdict}">${{ buff: '▲ buff', nerf: '▼ nerf', mixed: '◆ mixed', rework: '? rework', fixes: '● fixes' }[p.verdict]}</span>` : '');

  // tooltip: any element with data-tip (HTML, pre-escaped)
  const tip = $('#tip');
  document.addEventListener('mousemove', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.classList.remove('on'); return; }
    tip.innerHTML = t.dataset.tip; tip.classList.add('on');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > innerHeight - 8) y = e.clientY - h - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
  const tipAttr = (html) => `data-tip="${esc(html)}"`;

  // ---------- header & tabs ----------
  const gen = new Date(M.generated);
  $('#subtitle').textContent = `${M.patch.title} · ${M.mode === 'live' ? 'live data' : M.mode === 'forecast' ? 'forecast from your patch notes (no post-patch games yet)' : 'replay'} · built ${gen.toLocaleString()} · data: deadlock-api.com`;
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
    try { localStorage.setItem('dma-tab', b.dataset.tab); } catch {}
  }));
  try { const t = localStorage.getItem('dma-tab'); if (t) document.querySelector(`#tabs [data-tab="${t}"]`)?.click(); } catch {}

  // ---------- tier list ----------
  let ctx = 'all';
  const seg = $('#ctx-seg');
  seg.innerHTML = Object.entries(M.contexts).map(([k, v]) => `<button data-k="${k}" class="${k === ctx ? 'on' : ''}">${esc(v.label)}</button>`).join('');
  seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; ctx = b.dataset.k; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); renderTiers(); });
  $('#hero-filter').addEventListener('input', renderTiers);

  function ciBar(r, lo, hi) {
    const W = 150, Hh = 18, x = (v) => ((v - lo) / (hi - lo)) * (W - 8) + 4;
    return `<svg width="${W}" height="${Hh}" aria-hidden="true">
      <line x1="${x(0.5)}" x2="${x(0.5)}" y1="2" y2="${Hh - 2}" class="gridline" stroke-dasharray="2 2"/>
      <line x1="${x(r.ci[0])}" x2="${x(r.ci[1])}" y1="${Hh / 2}" y2="${Hh / 2}" stroke="var(--pos-1)" stroke-width="6" stroke-linecap="round"/>
      <circle cx="${x(r.posterior)}" cy="${Hh / 2}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/></svg>`;
  }
  function renderTiers() {
    const q = $('#hero-filter').value.trim().toLowerCase();
    const rows = M.tiers[ctx].filter((r) => !q || r.name.toLowerCase().includes(q) || (M.tags[r.id] || []).some((t) => t.tag.toLowerCase().includes(q)));
    const lo = Math.min(...M.tiers[ctx].map((r) => r.ci[0])), hi = Math.max(...M.tiers[ctx].map((r) => r.ci[1]));
    $('#tier-table').innerHTML = `<thead><tr><th>Tier</th><th>Hero</th><th class="num">Win rate</th><th>95% interval <span class="muted">(${pct(lo, 0)}–${pct(hi, 0)})</span></th><th class="num">vs pre-patch</th><th>Patch</th><th>Tier range</th><th>Evidence mix</th><th class="num">Pick</th><th class="num">Ban</th><th>Tags</th></tr></thead><tbody>` +
      rows.map((r) => {
        const d = r.posterior - r.preWR;
        const tags = (M.tags[r.id] || []).filter((t) => t.group === 'situational' || t.group === 'archetype' || t.group === 'draft').slice(0, 4);
        const mix = `<svg width="80" height="10" ${tipAttr(`<b>Evidence weight</b><br>Prior (pre-patch + forecast + experts): ${pct(1 - r.wPost, 0)}<br>Post-patch games: ${pct(r.wPost, 0)} (${r.postN.toLocaleString()} hero-games)`)}><rect width="80" height="10" rx="2" fill="var(--surface-2)"/><rect width="${80 * r.wPost}" height="10" rx="2" fill="var(--series-3)"/></svg>`;
        return `<tr class="row" data-id="${r.id}">
          <td><span class="tier ${r.tier}">${r.tier}</span></td>
          <td>${heroCell(r.id)}</td>
          <td class="num"><b>${pct(r.posterior)}</b></td>
          <td ${tipAttr(`<b>${esc(r.name)}</b><br>${pct(r.posterior)} (95%: ${pct(r.ci[0])} – ${pct(r.ci[1])})<br><span class=r>pre-patch ${pct(r.preWR)} over ${r.preN.toLocaleString()} · post ${r.postWR == null ? '–' : pct(r.postWR)} over ${r.postN.toLocaleString()}</span>`)}>${ciBar(r, lo, hi)}</td>
          <td class="num ${d > 0.002 ? 'up' : d < -0.002 ? 'down' : ''}">${ppS(d)}</td>
          <td>${verdictPill(r.patch)}</td>
          <td class="range">${r.tierRange[0] === r.tierRange[1] ? 'locked' : r.tierRange.join(' – ')}</td>
          <td>${mix}</td>
          <td class="num">${pct(r.pickRate)}</td>
          <td class="num">${r.banRate == null ? '–' : pct(r.banRate)}</td>
          <td>${tags.map((t) => `<span class="tag ${t.group}" ${tipAttr(esc(t.why))}>${esc(t.tag)}</span>`).join('')}</td></tr>`;
      }).join('') + '</tbody>';
  }
  $('#tier-table').addEventListener('click', (e) => { const tr = e.target.closest('tr.row'); if (tr) openHero(+tr.dataset.id); });
  renderTiers();

  // ---------- pair lookups ----------
  const pairIdx = {};
  for (const k of ['counters', 'lane', 'synergy']) {
    pairIdx[k] = {};
    for (const p of M[k]) { pairIdx[k][`${p.a}|${p.b}`] = p; if (k === 'synergy') pairIdx[k][`${p.b}|${p.a}`] = p; }
  }
  const lift = (k, a, b) => pairIdx[k][`${a}|${b}`]?.lift ?? null;
  const pairsFor = (k, id) => M.heroes.filter((h) => h.id !== id).map((h) => ({ id: h.id, p: pairIdx[k][`${id}|${h.id}`] })).filter((x) => x.p);

  // ---------- hero drawer ----------
  const drawer = $('#drawer');
  $('#drawer-close').addEventListener('click', () => drawer.classList.remove('open'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') drawer.classList.remove('open'); });
  function evidenceRows(r) {
    const items = [
      ['Pre-patch record', r.evidence.prePatchPp, `${pct(r.preWR)} over ${r.preN.toLocaleString()} hero-games, weighted ${pct(1 - r.wPost, 0)}`],
      ['Patch forecast', r.evidence.patchPredPp, r.patch ? `parser score ${r.patch.score} × k → ${ppS(r.patchDelta, 2)} expected` : 'not changed this patch'],
      ['Expert claims', r.evidence.expertPp, M.experts[r.name] ? `${M.experts[r.name].claims.length} claims, avg rating ${M.experts[r.name].avgRating}` : 'no claims loaded'],
      ['Post-patch games', r.evidence.postPatchPp, r.postN ? `${pct(r.postWR)} over ${r.postN.toLocaleString()} hero-games, weighted ${pct(r.wPost, 0)}` : 'none yet'],
    ];
    const max = Math.max(1, ...items.map((i) => Math.abs(i[1])));
    return items.map(([l, v, why]) => {
      const w = (Math.abs(v) / max) * 45;
      return `<div style="display:grid;grid-template-columns:130px 1fr 60px;gap:8px;align-items:center;margin:4px 0" ${tipAttr(esc(why))}>
        <span>${l}</span>
        <svg viewBox="0 0 100 12" preserveAspectRatio="none" height="12" width="100%"><line x1="50" x2="50" y1="0" y2="12" stroke="var(--axis)"/>
          <rect x="${v >= 0 ? 50 : 50 - w}" y="2" width="${w}" height="8" rx="1" fill="${v >= 0 ? 'var(--pos-2)' : 'var(--neg-2)'}"/></svg>
        <span class="num ${v > 0 ? 'up' : v < 0 ? 'down' : 'muted'}" style="text-align:right">${sgn(v, 2)}pp</span></div>`;
    }).join('') + `<div style="display:grid;grid-template-columns:130px 1fr 60px;gap:8px;border-top:1px solid var(--grid);padding-top:4px"><b>= Final</b><span class="muted small">50% + contributions</span><b style="text-align:right">${pct(r.posterior)}</b></div>`;
  }
  function pairList(title, list, fmt) {
    return `<div><b>${title}</b><ol>${list.map((x) => `<li ${tipAttr(fmt(x))}>${heroCell(x.id)} <span class="${x.p.lift > 0 ? 'up' : 'down'}">${ppS(x.p.lift)}</span></li>`).join('') || '<li class="muted">not enough games</li>'}</ol></div>`;
  }
  function openHero(id) {
    const r = tierOf('all', id), h = H[id];
    const changes = M.patch.changes.filter((c) => c.target === h.name);
    const counters = pairsFor('counters', id).sort((a, b) => b.p.lift - a.p.lift);
    const syn = pairsFor('synergy', id).sort((a, b) => b.p.lift - a.p.lift);
    const fmt = (x) => `${esc(h.name)} vs ${esc(H[x.id].name)}: ${pct(x.p.wr)} over ${x.p.n.toLocaleString()} games<br><span class=r>expected ${pct(x.p.expected)} from overall strength</span>`;
    const fmtS = (x) => `${esc(h.name)} + ${esc(H[x.id].name)}: ${pct(x.p.wr)} over ${x.p.n.toLocaleString()} games<br><span class=r>expected ${pct(x.p.expected)}</span>`;
    const pm = r.perMatch;
    $('#drawer-body').innerHTML = `
      <div style="display:flex;gap:12px;align-items:center">${avatar(h).replace('class="avatar"', 'class="avatar" style="width:48px;height:48px"')}<div><h2>${esc(h.name)}</h2>
      <div class="muted"><span class="tier ${r.tier}" style="width:22px;height:22px">${r.tier}</span> ${pct(r.posterior)} · interval ${pct(r.ci[0])}–${pct(r.ci[1])} · tier range ${r.tierRange.join('–')}</div></div></div>
      <section><h3>Why this rating</h3>${evidenceRows(r)}</section>
      <section><h3>By situation</h3><div class="kv">${Object.entries(M.contexts).map(([k, v]) => { const x = tierOf(k, id); return `<div><span>${esc(v.label)}</span><b>${x ? pct(x.posterior) : '–'} <small class="tier ${x?.tier}" style="width:18px;height:18px;font-size:11px;vertical-align:1px">${x?.tier ?? ''}</small></b></div>`; }).join('')}</div></section>
      <section><h3>Tags</h3>${(M.tags[id] || []).map((t) => `<span class="tag ${t.group}" ${tipAttr(esc(t.group + ': ' + t.why))}>${esc(t.tag)}</span>`).join('')}</section>
      ${changes.length ? `<section><h3>This patch ${verdictPill(r.patch)}</h3>${changes.map(changeRow).join('')}</section>` : ''}
      <section><h3>Matchups (full game)</h3><div class="plist">${pairList('Strong against', counters.slice(0, 5), fmt)}${pairList('Weak against', counters.slice(-5).reverse(), fmt)}</div></section>
      <section><h3>Synergy</h3><div class="plist">${pairList('Best with', syn.slice(0, 5), fmtS)}${pairList('Worst with', syn.slice(-5).reverse(), fmtS)}</div></section>
      ${pm ? `<section><h3>Per match (pre-patch)</h3><div class="kv">
        <div><span>K / D / A</span><b>${pm.kills.toFixed(1)} / ${pm.deaths.toFixed(1)} / ${pm.assists.toFixed(1)}</b></div>
        <div><span>Hero damage</span><b>${Math.round(pm.damage).toLocaleString()}</b></div>
        <div><span>Net worth</span><b>${Math.round(pm.netWorth).toLocaleString()}</b></div>
        <div><span>Damage taken</span><b>${Math.round(pm.damageTaken).toLocaleString()}</b></div>
        <div><span>Objective dmg</span><b>${Math.round(pm.objDamage).toLocaleString()}</b></div>
        <div><span>Accuracy</span><b>${pct(pm.accuracy)}</b></div></div></section>` : ''}
      ${M.experts[h.name] ? `<section><h3>Expert claims</h3>${M.experts[h.name].claims.map((c) => `<div class="chg"><span class="m">${sgn(c.rating, 0)}</span><div>${esc(c.note || '')} <div class="meta">${esc(c.source)} · ${esc(c.date)} · weight ${c.effectiveWeight}${c.url ? ` · <a href="${esc(c.url)}" target="_blank" rel="noopener">source</a>` : ''}</div></div></div>`).join('')}</section>` : ''}`;
    drawer.classList.add('open');
  }

  // ---------- patch tab ----------
  function changeRow(c) {
    const k = c.direction === null ? 'unknown' : c.direction > 0 ? 'buff' : c.direction < 0 ? 'nerf' : 'neutral';
    const sym = { unknown: '?', buff: '▲', nerf: '▼', neutral: '●' }[k];
    const body = c.line.replace(/^[-•*]\s*[^:]+:\s*/, '');
    const dirWord = (d) => (d === 1 ? 'buff' : d === -1 ? 'nerf' : d === 0 ? 'neutral' : 'unsure');
    let src = '';
    if (c.source === 'llm') src = `<span class="pill llm" ${tipAttr(`Rules said: ${dirWord(c.rules.direction)} (${esc(c.rules.reason)}, confidence ${c.rules.confidence})`)}>LLM</span> `;
    else if (c.llm) src = c.disagree
      ? `<span class="pill unknown" ${tipAttr(`LLM says ${dirWord(c.llm.direction)}: ${esc(c.llm.reason)}`)}>LLM disagrees</span> `
      : `<span class="pill" ${tipAttr(`LLM: ${esc(c.llm.reason)}`)}>LLM agrees</span> `;
    return `<div class="chg"><span class="m ${k}">${sym}</span><div>${src}${esc(body)}<div class="meta">${esc(c.reason)} · magnitude ${(c.magnitude * 100).toFixed(0)}% · weight ${c.weight} · confidence ${c.confidence} · <code>${esc(c.id)}</code></div></div></div>`;
  }
  (function renderPatch() {
    const P = M.patch, S = Object.values(P.summary);
    const heroS = S.filter((s) => s.kind === 'hero');
    $('#patch-head').innerHTML = `<div class="stats">
      <div class="stat"><div class="l">Current patch</div><div class="v" style="font-size:16px">${esc(P.title)}</div><div class="h">${new Date(P.date).toLocaleString()} ${P.link ? `· <a href="${esc(P.link)}" target="_blank" rel="noopener">notes</a>` : ''}</div></div>
      <div class="stat"><div class="l">Heroes buffed</div><div class="v up">${heroS.filter((s) => s.verdict === 'buff').length}</div></div>
      <div class="stat"><div class="l">Heroes nerfed</div><div class="v down">${heroS.filter((s) => s.verdict === 'nerf').length}</div></div>
      <div class="stat"><div class="l">Mixed / rework</div><div class="v">${heroS.filter((s) => !['buff', 'nerf'].includes(s.verdict)).length}</div></div>
      <div class="stat"><div class="l">Lines needing review</div><div class="v" style="color:var(--warn)">${P.flagged.length}</div><div class="h">of ${P.changes.length} parsed</div></div>
      <div class="stat"><div class="l">Post-patch matches so far</div><div class="v">${Math.round(M.contexts.all.postGames).toLocaleString()}</div><div class="h">pre-window: ${esc(M.preNote)}</div></div></div>`;

    // dumbbell
    const rows = M.tiers.all.filter((r) => r.patch).sort((a, b) => b.patchDelta - a.patchDelta);
    if (!rows.length) { $('#patch-dumbbell').innerHTML = '<p class="muted">No hero changes in this patch.</p>'; }
    else {
      const vals = rows.flatMap((r) => [r.preWR, r.preWR + r.patchDelta, r.postWR ?? r.preWR]);
      const lo = Math.min(...vals) - 0.01, hi = Math.max(...vals) + 0.01;
      const L = 120, W = 560, rh = 30, Hh = rows.length * rh + 30, x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - 16);
      const ticks = []; for (let t = Math.ceil(lo * 100); t <= Math.floor(hi * 100); t++) ticks.push(t / 100);
      $('#patch-dumbbell').innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="Predicted versus observed win rate for changed heroes">
        ${ticks.map((t) => `<line class="gridline" x1="${x(t)}" x2="${x(t)}" y1="0" y2="${Hh - 22}"/><text x="${x(t)}" y="${Hh - 6}" text-anchor="middle">${(t * 100).toFixed(0)}%</text>`).join('')}
        ${rows.map((r, i) => { const y = i * rh + 14, pred = r.preWR + r.patchDelta;
          return `<g ${tipAttr(`<b>${esc(r.name)}</b> ${r.patch.verdict}<br>Pre-patch: ${pct(r.preWR)}<br>Forecast: ${pct(pred)} (${ppS(r.patchDelta, 2)})<br>Observed so far: ${r.postWR == null ? '–' : pct(r.postWR)} over ${r.postN.toLocaleString()} hero-games`)}>
          <rect x="0" y="${y - 13}" width="${W}" height="${rh}" fill="transparent"/>
          <text x="${L - 10}" y="${y + 4}" text-anchor="end" style="fill:var(--ink)">${esc(r.name)}</text>
          <line x1="${x(r.preWR)}" x2="${x(r.postWR ?? pred)}" y1="${y}" y2="${y}" stroke="var(--axis)" stroke-width="2"/>
          <circle cx="${x(r.preWR)}" cy="${y}" r="5" fill="var(--surface)" stroke="var(--muted)" stroke-width="2"/>
          <line x1="${x(pred)}" x2="${x(pred)}" y1="${y - 8}" y2="${y + 8}" stroke="var(--series-2)" stroke-width="3" stroke-linecap="round"/>
          ${r.postWR != null ? `<circle cx="${x(r.postWR)}" cy="${y}" r="5.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>` : ''}</g>`; }).join('')}
      </svg><div class="legend"><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="var(--muted)" stroke-width="2"/></svg>Pre-patch
        <svg width="10" height="16"><line x1="5" x2="5" y1="2" y2="14" stroke="var(--series-2)" stroke-width="3"/></svg>Model forecast
        <svg width="14" height="14"><circle cx="7" cy="7" r="5.5" fill="var(--accent)"/></svg>Observed so far</div>`;
    }

    // parsed lines grouped by target
    const groups = {};
    for (const c of P.changes) (groups[c.target] ??= []).push(c);
    const order = Object.keys(groups).sort((a, b) => (P.summary[b] ? 1 : 0) - (P.summary[a] ? 1 : 0));
    $('#patch-lines').innerHTML = `<div class="changes">${order.map((t) => `<div class="grouphead">${byName[t] ? avatar(byName[t]) : ''}${esc(t)} ${P.summary[t] ? verdictPill(P.summary[t]) : `<span class="pill">${esc(groups[t][0].kind)}</span>`}</div>${groups[t].map(changeRow).join('')}`).join('')}</div>`;

    $('#patch-history').innerHTML = `<div class="tablewrap" style="border:0"><table class="grid"><thead><tr><th>Date</th><th>Patch</th><th>Buffed</th><th>Nerfed</th></tr></thead><tbody>${[...M.timeline].reverse().map((p) => `<tr><td>${p.date.slice(0, 10)}</td><td>${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}</td>
      <td style="white-space:normal">${p.summary.filter((s) => s.v === 'buff').map((s) => `<span class="tag">${esc(s.t)}</span>`).join('')}</td>
      <td style="white-space:normal">${p.summary.filter((s) => s.v === 'nerf').map((s) => `<span class="tag">${esc(s.t)}</span>`).join('')}</td></tr>`).join('')}</tbody></table></div>`;
  })();

  // ---------- situations ----------
  let sitSort = 'all';
  function renderSituations() {
    const ctxs = Object.keys(M.contexts);
    const ids = M.tiers.all.map((r) => r.id);
    const val = (c, id) => tierOf(c, id)?.posterior;
    ids.sort((a, b) => (val(sitSort, b) ?? 0) - (val(sitSort, a) ?? 0));
    $('#sit-table').innerHTML = `<thead><tr><th>Hero</th>${ctxs.map((c) => `<th class="num sortable ${c === sitSort ? 'sorted' : ''}" data-c="${c}">${esc(M.contexts[c].label)} ${c === sitSort ? '▾' : ''}</th>`).join('')}<th>Situational lean</th></tr></thead><tbody>` +
      ids.map((id) => `<tr class="row" data-id="${id}"><td>${heroCell(id)}</td>${ctxs.map((c) => { const r = tierOf(c, id); if (!r) return '<td class="h">–</td>'; const d = (r.posterior - 0.5) * 100;
        return `<td class="h ${divClass(d, [1, 3, 5])}" ${tipAttr(`<b>${esc(H[id].name)}</b> · ${esc(M.contexts[c].label)}<br>${pct(r.posterior)} (tier ${r.tier})<br><span class=r>${(r.preN + r.postN).toLocaleString()} hero-games</span>`)}>${sgn(d)}</td>`; }).join('')}
        <td>${(M.tags[id] || []).filter((t) => t.group === 'situational').map((t) => `<span class="tag situational" ${tipAttr(esc(t.why))}>${esc(t.tag)}</span>`).join('')}</td></tr>`).join('') + '</tbody>';
  }
  $('#sit-table').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-c]'); if (th) { sitSort = th.dataset.c; renderSituations(); return; }
    const tr = e.target.closest('tr.row'); if (tr) openHero(+tr.dataset.id);
  });
  renderSituations();
  (function renderArch() {
    const names = [...new Set(M.archetypes.flatMap((a) => [a.a, a.b]))].sort();
    const get = (a, b) => M.archetypes.find((x) => x.a === a && x.b === b);
    $('#arch-matrix').innerHTML = `<div class="tablewrap" style="border:0"><table class="grid heat"><thead><tr><th>Row beats column →</th>${names.map((n) => `<th class="num">${esc(n)}</th>`).join('')}</tr></thead><tbody>${names.map((a) => `<tr><td><b>${esc(a)}</b></td>${names.map((b) => { const c = get(a, b); if (!c) return '<td class="h">–</td>'; const d = c.lift * 100;
      return `<td class="h ${divClass(d, [0.25, 0.6, 1.2])}" ${tipAttr(`<b>${esc(a)}</b> vs <b>${esc(b)}</b><br>${ppS(c.lift, 2)} vs expected<br><span class=r>${Math.round(c.n).toLocaleString()} hero-pair games</span>`)}>${sgn(d, 2)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="legend">Lift in pp: ${legendRamp(['−1.2', '−0.6', '−0.25', '0', '+0.25', '+0.6', '+1.2'])}</div>`;
  })();
  function legendRamp(labels) {
    return `<span class="ramp">${['neg-3', 'neg-2', 'neg-1', 'mid', 'pos-1', 'pos-2', 'pos-3'].map((c, i) => `<i class="cell-${c}" title="${labels[i]}"></i>`).join('')}</span> <span>${labels[0]}</span> … <span>${labels.at(-1)}</span>`;
  }

  // ---------- matchups ----------
  let pairK = 'counters';
  const order = M.tiers.all.map((r) => r.id);
  let focus = order[0];
  $('#pair-hero').innerHTML = order.map((id) => `<option value="${id}">${esc(H[id].name)}</option>`).join('');
  $('#pair-hero').addEventListener('change', (e) => { focus = +e.target.value; renderPairs(); });
  $('#pair-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; pairK = b.dataset.k; $('#pair-seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); renderPairs(); });
  function renderPairs() {
    const sym = pairK === 'synergy';
    $('#pair-explain').innerHTML = {
      counters: 'Cell = how much better the <b>row</b> hero does against the <b>column</b> hero than their overall strengths predict (whole match, any lane). Blue = row is favoured.',
      lane: 'Same as counters, but only games where both heroes started in the same lane — the laning-phase matchup.',
      synergy: 'Cell = how much better a team with <b>both</b> heroes does than their individual strengths predict. Blue = they work well together.',
    }[pairK] + ' Values are shrunk toward 0 for small samples; heroes sorted by current win rate.';
    const cs = 15, L = 104, T = 104, n = order.length, W = L + n * cs, Hh = T + n * cs;
    let cells = '';
    order.forEach((a, i) => order.forEach((b, j) => {
      if (a === b) return;
      const p = pairIdx[pairK][`${a}|${b}`]; if (!p) return;
      const d = p.lift * 100;
      cells += `<rect x="${L + j * cs + 1}" y="${T + i * cs + 1}" width="${cs - 2}" height="${cs - 2}" rx="2" class="${divClass(d, [0.5, 1.5, 3])}" style="fill:var(--${divClass(d, [0.5, 1.5, 3]).replace('cell-', '')})" ${tipAttr(`<b>${esc(H[a].name)}</b> ${sym ? '+' : 'vs'} <b>${esc(H[b].name)}</b><br>${ppS(p.lift, 2)} vs expected<br><span class=r>${pct(p.wr)} actual · ${pct(p.expected)} expected · ${p.n.toLocaleString()} games</span>`)}/>`;
    }));
    const fi = order.indexOf(focus);
    const labels = order.map((id, i) => `<text x="${L - 6}" y="${T + i * cs + cs - 4}" text-anchor="end" style="${id === focus ? 'fill:var(--ink);font-weight:700' : ''}">${esc(H[id].name)}</text>
      <text transform="translate(${L + i * cs + cs - 4},${T - 6}) rotate(-60)" style="${id === focus ? 'fill:var(--ink);font-weight:700' : ''}">${esc(H[id].name)}</text>`).join('');
    $('#heatmap').innerHTML = `<div class="heatwrap"><svg width="${W}" height="${Hh}" role="img" aria-label="${pairK} heatmap">
      <rect x="${L}" y="${T + fi * cs}" width="${n * cs}" height="${cs}" fill="none" stroke="var(--ink)" stroke-width="1.5" rx="2"/>
      ${labels}${cells}</svg></div>`;
    $('#heat-legend').innerHTML = `Lift (pp): ${legendRamp(['≤−3', '−1.5', '−0.5', '0', '+0.5', '+1.5', '≥+3'])} · outlined row = focus hero`;
    const list = pairsFor(pairK, focus).sort((a, b) => b.p.lift - a.p.lift);
    const fmt = (x) => `${pct(x.p.wr)} over ${x.p.n.toLocaleString()} games<br><span class=r>expected ${pct(x.p.expected)}</span>`;
    $('#pair-lists').innerHTML = `<h3>${heroCell(focus)}</h3><div class="plist">${pairList(sym ? 'Best partners' : 'Favoured against', list.slice(0, 10), fmt)}${pairList(sym ? 'Worst partners' : 'Struggles against', list.slice(-10).reverse(), fmt)}</div>`;
  }
  $('#heatmap').addEventListener('click', (e) => { /* click a row label to focus */ });
  renderPairs();

  // ---------- draft helper ----------
  const allies = new Set(), enemies = new Set();
  function picker(el, set, max, other) {
    el.innerHTML = order.slice().sort((a, b) => H[a].name.localeCompare(H[b].name)).map((id) => `<button data-id="${id}" class="${set.has(id) ? 'on' : ''}" ${other.has(id) || (!set.has(id) && set.size >= max) ? 'disabled' : ''}>${avatar(H[id])}${esc(H[id].name)}</button>`).join('');
  }
  function renderDraft() {
    picker($('#draft-allies'), allies, 5, enemies); picker($('#draft-enemies'), enemies, 6, allies);
    const cands = order.filter((id) => !allies.has(id) && !enemies.has(id)).map((id) => {
      const r = tierOf('all', id);
      const base = (r.posterior - 0.5) * 100;
      const vs = [...enemies].map((e) => ({ e, l: (lift('counters', id, e) ?? 0) * 100 }));
      const wi = [...allies].map((a) => ({ a, l: (lift('synergy', id, a) ?? 0) * 100 }));
      const vsS = vs.reduce((s, x) => s + x.l, 0), wiS = wi.reduce((s, x) => s + x.l, 0);
      return { id, base, vsS, wiS, total: base + vsS + wiS, vs, wi };
    }).sort((a, b) => b.total - a.total).slice(0, 15);
    const max = Math.max(...cands.map((c) => Math.abs(c.base) + Math.abs(c.vsS) + Math.abs(c.wiS)), 1);
    const seg = (v, color) => `<rect width="${(Math.abs(v) / max) * 100}" height="10" fill="${color}" ${v < 0 ? 'opacity=".45"' : ''}/>`;
    $('#draft-out').innerHTML = (enemies.size || allies.size ? '' : '<p class="muted small">No picks yet — showing raw strength. Select heroes above.</p>') +
      `<div class="tablewrap" style="border:0"><table class="grid"><thead><tr><th>#</th><th>Hero</th><th class="num">Score</th><th class="num">Strength</th><th class="num">vs enemies</th><th class="num">with allies</th><th>Breakdown</th><th>Key interactions</th></tr></thead><tbody>${cands.map((c, i) => {
        let x = 0; const parts = [[c.base, 'var(--series-1)'], [c.vsS, 'var(--series-2)'], [c.wiS, 'var(--series-3)']].map(([v, col]) => { const w = (Math.abs(v) / max) * 100; const s = `<rect x="${x}" width="${Math.max(w - 1, 0)}" height="10" rx="1" fill="${col}" ${v < 0 ? 'opacity=".35"' : ''}/>`; x += w; return s; }).join('');
        const keys = [...c.vs.map((v) => ({ n: 'vs ' + H[v.e].name, l: v.l })), ...c.wi.map((w) => ({ n: '+ ' + H[w.a].name, l: w.l }))].sort((a, b) => Math.abs(b.l) - Math.abs(a.l)).slice(0, 3);
        return `<tr class="row" data-id="${c.id}"><td>${i + 1}</td><td>${heroCell(c.id)}</td><td class="num"><b>${sgn(c.total, 2)}</b></td><td class="num">${sgn(c.base, 2)}</td><td class="num">${enemies.size ? sgn(c.vsS, 2) : '–'}</td><td class="num">${allies.size ? sgn(c.wiS, 2) : '–'}</td>
          <td><svg width="160" height="10">${parts}</svg></td><td>${keys.map((k) => `<span class="tag ${k.l > 0 ? 'up' : 'down'}">${esc(k.n)} ${sgn(k.l)}</span>`).join('')}</td></tr>`; }).join('')}</tbody></table></div>
      <div class="legend"><svg width="12" height="10"><rect width="12" height="10" fill="var(--series-1)"/></svg>Strength (pp vs 50%) <svg width="12" height="10"><rect width="12" height="10" fill="var(--series-2)"/></svg>Counter lift vs enemies <svg width="12" height="10"><rect width="12" height="10" fill="var(--series-3)"/></svg>Synergy lift with allies · faded = negative</div>`;
  }
  for (const [sel, set, other] of [['#draft-allies', allies, enemies], ['#draft-enemies', enemies, allies]])
    $(sel).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.disabled) return; const id = +b.dataset.id; set.has(id) ? set.delete(id) : set.add(id); renderDraft(); });
  $('#draft-out').addEventListener('click', (e) => { const tr = e.target.closest('tr.row'); if (tr) openHero(+tr.dataset.id); });
  renderDraft();

  // ---------- audit ----------
  (function renderAudit() {
    const B = M.backtest;
    const better = B.maeModelPp < B.maeNaivePp;
    $('#audit-stats').innerHTML = [
      ['Patch model k', `${(B.k * 100).toFixed(2)}pp`, B.fitted ? 'per unit of change score, fitted' : 'fallback (not enough history)'],
      ['Correlation (r)', B.r.toFixed(2), `${B.n} past hero changes`],
      ['Direction right', B.signAccuracy == null ? '–' : pct(B.signAccuracy, 0), 'buff → went up, nerf → went down'],
      ['Error vs "no change"', `${B.maeModelPp.toFixed(2)} vs ${B.maeNaivePp.toFixed(2)}pp`, better ? 'model beats naive baseline' : 'model does NOT beat naive'],
      ['Patches replayed', B.patches.length, B.patches.map((p) => p.id).join(', ')],
      ['Lines needing review', M.patch.flagged.length, 'in the current patch'],
      M.llm && M.backtestRules
        ? ['Rules vs rules + LLM', `r ${M.backtestRules.r.toFixed(2)} → ${B.r.toFixed(2)}`,
          `direction right ${pct(M.backtestRules.signAccuracy, 0)} → ${pct(B.signAccuracy, 0)} · error ${M.backtestRules.maeModelPp.toFixed(2)} → ${B.maeModelPp.toFixed(2)}pp`]
        : ['LLM pass', 'off', 'run node src/build.js --llm to classify vague lines with Claude'],
    ].map(([l, v, h]) => `<div class="stat"><div class="l">${l}</div><div class="v">${v}</div><div class="h">${esc(h)}</div></div>`).join('');

    const pts = B.points.filter((p) => p.score !== 0);
    if (pts.length) {
      const W = 520, Hh = 340, P = 40;
      const ext = Math.max(...pts.flatMap((p) => [Math.abs(p.predicted), Math.abs(p.observed)])) * 100 * 1.1;
      const x = (v) => P + ((v * 100 + ext) / (2 * ext)) * (W - P - 10), y = (v) => 10 + ((ext - v * 100) / (2 * ext)) * (Hh - P - 10);
      const ticks = []; const step = ext > 6 ? 2 : 1; for (let t = -Math.floor(ext / step) * step; t <= ext; t += step) ticks.push(t);
      $('#bt-scatter').innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="Backtest scatter of predicted vs observed win-rate change">
        ${ticks.map((t) => `<line class="gridline" x1="${x(t / 100)}" x2="${x(t / 100)}" y1="10" y2="${Hh - P}"/><line class="gridline" x1="${P}" x2="${W - 10}" y1="${y(t / 100)}" y2="${y(t / 100)}"/>
          <text x="${x(t / 100)}" y="${Hh - P + 14}" text-anchor="middle">${sgn(t, 0)}</text><text x="${P - 6}" y="${y(t / 100) + 4}" text-anchor="end">${sgn(t, 0)}</text>`).join('')}
        <line x1="${x(-ext / 100)}" y1="${y(-ext / 100)}" x2="${x(ext / 100)}" y2="${y(ext / 100)}" stroke="var(--muted)" stroke-dasharray="4 4"/>
        <line x1="${x(0)}" x2="${x(0)}" y1="10" y2="${Hh - P}" stroke="var(--axis)"/><line x1="${P}" x2="${W - 10}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>
        ${pts.map((p) => `<circle cx="${x(p.predicted)}" cy="${y(p.observed)}" r="5" fill="${Math.sign(p.predicted) === Math.sign(p.observed) ? 'var(--accent)' : 'var(--neg-2)'}" stroke="var(--surface)" stroke-width="2" ${tipAttr(`<b>${esc(p.hero)}</b> · ${esc(p.patch)}<br>Predicted ${ppS(p.predicted, 2)} · observed ${ppS(p.observed, 2)}<br><span class=r>${p.nPost.toLocaleString()} post-patch hero-games</span>`)}/>`).join('')}
        <text x="${(W + P) / 2}" y="${Hh - 6}" text-anchor="middle">Predicted change (pp)</text>
        <text transform="translate(12,${(Hh - P) / 2}) rotate(-90)" text-anchor="middle">Observed change (pp)</text></svg>
        <div class="legend"><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="var(--accent)"/></svg>Direction correct <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="var(--neg-2)"/></svg>Direction wrong <span class="muted">· dashed = perfect prediction</span></div>`;
    } else $('#bt-scatter').innerHTML = '<p class="muted">Not enough past patches with data to backtest.</p>';

    const dw = (d) => (d === 1 ? 'buff' : d === -1 ? 'nerf' : d === 0 ? 'neutral' : 'unsure');
    const all = [
      ...M.disagreements,
      ...(M.llm?.disagreements || []).map((d) => ({ hero: d.target, type: 'parser rules vs LLM', detail: `"${d.line.replace(/^[-•*]\s*[^:]+:\s*/, '')}" — rules: ${dw(d.rules.direction)}, LLM: ${dw(d.llm.direction)} (${d.llm.reason})` })),
    ];
    $('#disagree').innerHTML = (M.llm ? `<p class="muted small">LLM pass: ${esc(M.llm.model)}, mode "${esc(M.llm.mode)}" · ${M.llm.used} line(s) in this patch use the LLM verdict${M.llm.stats.failures.length ? ` · <span style="color:var(--warn)">${M.llm.stats.failures.length} request(s) failed: ${esc(M.llm.stats.failures[0])}</span>` : ''}</p>` : '') +
      (all.length
        ? all.map((d) => `<div class="chg"><span class="m unknown">!</span><div><b>${esc(d.hero)}</b> — ${esc(d.type)}<div class="meta">${esc(d.detail)}</div></div></div>`).join('')
        : '<p class="muted small">None right now. Shown when early post-patch data moves against the forecast, when expert consensus contradicts the data, or when the LLM and the parser rules read a line differently.</p>');
    const ex = Object.entries(M.experts);
    $('#experts').innerHTML = ex.length
      ? ex.map(([h, e]) => `<div class="chg"><span class="m">${sgn(e.avgRating, 1)}</span><div><b>${esc(h)}</b> · ${e.claims.length} claim(s) · prior shift ${sgn(e.shift, 2)}pp</div></div>`).join('')
      : `<p class="muted small">No expert claims loaded. Add coach/pro opinions to <code>data/experts/claims.json</code> (see <code>claims.example.json</code>): each claim is a hero, a rating from −2 to +2, a source, a date and an optional situation. They shift the prior by at most ±${M.config.expert.maxShiftPp}pp and fade with a ${M.config.expert.halfLifeDays}-day half-life, so data always wins in the end.</p>`;

    $('#coverage').innerHTML = `<table class="grid"><thead><tr><th>Situation</th><th class="num">Pre-patch matches</th><th class="num">Post-patch matches</th></tr></thead><tbody>${Object.entries(M.contexts).map(([k, c]) => `<tr><td>${esc(c.label)}</td><td class="num">${Math.round(c.preGames).toLocaleString()}</td><td class="num">${Math.round(c.postGames).toLocaleString()}</td></tr>`).join('')}</tbody></table>
      <p class="muted small">Pre-patch window: ${esc(M.preNote)}. Matchups & synergies use the pre-window through now. Rank filters only count matches where badge data exists for both teams.</p>`;
    const C = M.config;
    $('#assumptions').innerHTML = `<ul class="small" style="padding-left:18px;margin:0;color:var(--ink-2)">
      <li>Prior strength: unchanged heroes count as <b>${C.priorGames.unchanged.toLocaleString()}</b> games of evidence, patched heroes <b>${C.priorGames.changed.toLocaleString()}</b> (less for reworks/unclassified lines).</li>
      <li>Raw win rates shrunk toward 50% with <b>${C.shrinkGames}</b> pseudo-games; pair lifts toward 0 with <b>${C.pairShrinkGames}</b>.</li>
      <li>Patch forecast = k × Σ(direction × magnitude × weight × confidence). Base-stat changes weigh 1.6×, T1–T3 upgrades 0.6×.</li>
      <li>Matchup lift = observed − expected, where expected comes from both heroes' overall win rates (log-odds difference); synergy uses the log-odds sum.</li>
      <li>Tiers are z-scores of the final win rate: S ≥ +1.25σ, A ≥ +0.5σ, B ≥ −0.5σ, C ≥ −1.25σ.</li>
      <li>Archetype tags come from per-match quartiles (net worth, damage taken, assists, objective damage); add your own in <code>data/theory.json</code>.</li>
      <li>All knobs live in <code>config.js</code>.</li></ul>`;
  })();
})();
