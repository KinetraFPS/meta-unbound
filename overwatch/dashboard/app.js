/* Overwatch Meta Auditor dashboard — reads window.OW written by overwatch/build.js.
   Routes: #/meta  #/hero/<key>/<overview|maps|kit|history>  #/maps[/<map>]  #/patch  #/about */
(() => {
  const D = window.OW;
  const view = document.getElementById('view');
  if (!D) { view.innerHTML = '<p>No data. Run <code>node overwatch/build.js</code> first.</p>'; return; }

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p1 = (x) => (x == null || isNaN(x) ? '–' : x.toFixed(1) + '%');
  const sgn = (x, d = 1) => (x == null || isNaN(x) ? '–' : (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(d));
  const cls = (x, eps = 0.15) => (x > eps ? 'up' : x < -eps ? 'down' : '');
  const store = { get(k, d) { try { return JSON.parse(localStorage.getItem('owm-' + k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem('owm-' + k, JSON.stringify(v)); } catch {} } };
  const tipAttr = (html) => `data-tip="${esc(html)}"`;
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
  const help = (summary, html) => `<details class="help"><summary>${summary}</summary><div>${html}</div></details>`;
  const H = Object.fromEntries(D.heroes.map((h) => [h.key, h]));
  const ROLES = ['tank', 'damage', 'support'];
  const ROLE_LABEL = { tank: 'Tank', damage: 'Damage', support: 'Support' };
  const DIVS = ['all', ...D.config.divisions];
  const DIV_LABEL = (d) => (d === 'all' ? 'All ranks' : cap(d));
  const TIERS = [['S', 'Top pick'], ['A', 'Strong'], ['B', 'Solid'], ['C', 'Weak'], ['D', 'Struggling']];
  const MAP = Object.fromEntries(D.maps.map((m) => [m.key, m]));
  const initials = (n) => n.split(/[\s.:-]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const avatar = (h, extra = '') => h?.img ? `<img class="avatar ${extra}" src="${esc(h.img)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;avatar ${extra}&quot;>${esc(initials(h.name))}</span>'">` : `<span class="avatar ${extra}">${esc(initials(h?.name || '?'))}</span>`;
  const heroLink = (k, sub = 'overview') => `#/hero/${k}/${sub}`;
  const heroCell = (k, sub) => `<a class="hero" href="${heroLink(k, sub)}">${avatar(H[k])}<span>${esc(H[k].name)}</span></a>`;
  const divClass = (v, t) => (v >= t[2] ? 'cell-pos-3' : v >= t[1] ? 'cell-pos-2' : v >= t[0] ? 'cell-pos-1' : v <= -t[2] ? 'cell-neg-3' : v <= -t[1] ? 'cell-neg-2' : v <= -t[0] ? 'cell-neg-1' : 'cell-mid');
  const legendRamp = (a, b) => `<span class="ramp">${['neg-3', 'neg-2', 'neg-1', 'mid', 'pos-1', 'pos-2', 'pos-3'].map((c) => `<i class="cell-${c}"></i>`).join('')}</span><span>${a} … ${b}</span>`;
  // "This patch" = every balance patch within a week of the newest one (big patch + follow-up hotfixes);
  // a hero's verdict comes from the newest of those that touched them.
  const newest = D.patches.at(-1);
  const recent = newest ? D.patches.filter((p) => new Date(newest.date) - new Date(p.date) <= 7 * 864e5) : [];
  const latest = [...recent].sort((a, b) => b.changes.length - a.changes.length)[0]; // the main patch of the batch
  const patchOf = (k) => [...recent].reverse().find((p) => p.summary[k])?.summary[k];
  const verdictPill = (s) => (s ? `<span class="pill ${s.v}">${{ buff: '▲ buffed', nerf: '▼ nerfed', mixed: '◆ mixed', rework: '? rework', fixes: '● fixes' }[s.v]}</span>` : '');

  // ---------- selection state ----------
  const sel = { platform: store.get('platform', 'pc'), region: store.get('region', 'americas'), div: store.get('div', 'all') };
  const pk = () => `${sel.platform}|${sel.region}`;
  const fill = (el, opts, v) => { el.innerHTML = opts.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join(''); el.value = v; };
  fill($('#sel-platform'), Object.entries(D.config.platforms), sel.platform);
  fill($('#sel-region'), Object.entries(D.config.regions), sel.region);
  fill($('#sel-div'), DIVS.map((d) => [d, DIV_LABEL(d)]), sel.div);
  for (const [id, k] of [['#sel-platform', 'platform'], ['#sel-region', 'region'], ['#sel-div', 'div']])
    $(id).addEventListener('change', (e) => { sel[k] = e.target.value; store.set(k, sel[k]); render(); });
  const selLabel = () => `${D.config.platforms[sel.platform]} · ${D.config.regions[sel.region]} · ${DIV_LABEL(sel.div)}`;

  // ---------- tier model (computed live for any selection) ----------
  // Blizzard publishes no game counts, so pick rate stands in for sample size: win rate is pulled
  // toward 50% as if `shrinkPick` points of pick rate were played at exactly 50%.
  const k0 = D.config.shrinkPick;
  const cache = new Map();
  function table(raw) {
    const rows = Object.entries(raw || {}).filter(([k]) => H[k]).map(([k, [wr, pick, ban]]) => ({ k, role: H[k].role, wr, pick, ban, adj: (wr * pick + 50 * k0) / (pick + k0) }));
    for (const role of ROLES) {
      const rs = rows.filter((r) => r.role === role);
      const m = rs.reduce((s, r) => s + r.adj, 0) / (rs.length || 1);
      const sd = Math.sqrt(rs.reduce((s, r) => s + (r.adj - m) ** 2, 0) / (rs.length || 1)) || 1;
      rs.sort((a, b) => b.adj - a.adj).forEach((r, i) => { r.z = (r.adj - m) / sd; r.tier = D.config.tiers.find((t) => r.z >= t.z).tier; r.rank = i + 1; r.of = rs.length; r.lowPick = r.pick < 1; });
    }
    return rows;
  }
  function tiers(p = pk(), div = sel.div) {
    const key = `${p}|${div}`;
    if (!cache.has(key)) cache.set(key, table(D.stats[p]?.[div]));
    return cache.get(key);
  }
  const rowOf = (k, p, div) => tiers(p, div).find((r) => r.k === k);
  const mapRows = (map, p = pk()) => { const key = `${p}|map:${map}`; if (!cache.has(key)) cache.set(key, table(D.mapStats[p]?.[map])); return cache.get(key); };

  // ---------- header, tooltip, search, theme ----------
  $('#patch-chip').textContent = latest ? `${latest.title.replace(/^Overwatch Retail Patch Notes – /, 'Patch ')}` : '';
  $('#foot-info').textContent = `Built ${new Date(D.generated).toLocaleString()} · ${D.calls} stat queries`;
  const tip = $('#tip');
  document.addEventListener('mousemove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) { tip.classList.remove('on'); return; }
    if (tip.dataset.src !== t.dataset.tip) { tip.innerHTML = t.dataset.tip; tip.dataset.src = t.dataset.tip; }
    tip.classList.add('on');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > innerHeight - 8) y = e.clientY - h - 14;
    tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
  });
  document.addEventListener('scroll', () => tip.classList.remove('on'), { passive: true });
  $('#theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('dma-theme', document.documentElement.dataset.theme); } catch {}
  });
  const search = $('#hero-search'), list = $('#search-list');
  let si = 0, found = [];
  const openSearch = () => {
    const q = search.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    found = D.heroes.filter((h) => !q || h.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12);
    si = 0;
    list.innerHTML = found.map((h, i) => { const r = rowOf(h.key); return `<li role="option" data-k="${h.key}" aria-selected="${i === si}">${avatar(h)}<span style="flex:1">${esc(h.name)} <span class="muted small">${ROLE_LABEL[h.role]}</span></span>${r ? `<span class="tier ${r.tier}" style="width:20px;height:20px;font-size:11px">${r.tier}</span>` : ''}</li>`; }).join('') || '<li class="muted">No hero found</li>';
    list.hidden = false; search.setAttribute('aria-expanded', 'true');
  };
  const closeSearch = () => { list.hidden = true; search.setAttribute('aria-expanded', 'false'); };
  const goHero = (k) => { closeSearch(); search.value = ''; search.blur(); location.hash = heroLink(k); };
  search.addEventListener('input', openSearch); search.addEventListener('focus', openSearch);
  search.addEventListener('blur', () => setTimeout(closeSearch, 150));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); si = (si + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % Math.max(found.length, 1); $$('li', list).forEach((li, i) => li.setAttribute('aria-selected', i === si)); }
    else if (e.key === 'Enter' && found[si]) goHero(found[si].key);
    else if (e.key === 'Escape') { closeSearch(); search.blur(); }
  });
  list.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-k]'); if (li) goHero(li.dataset.k); });
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !/input|select|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); search.focus(); } });

  // ---------- router ----------
  const parse = () => { const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean); return { route: p[0] || 'meta', a: p[1], b: p[2] }; };
  let lastKey = '';
  function render() {
    const { route, a, b } = parse();
    $$('#tabs a').forEach((x) => x.classList.toggle('on', x.dataset.route === route));
    ({ meta: viewMeta, hero: () => viewHero(a, b || 'overview'), maps: () => viewMaps(a), patch: viewPatch, about: viewAbout }[route] || viewMeta)();
    const key = route + (a || '');
    if (key !== lastKey) { scrollTo(0, 0); lastKey = key; }
    document.title = route === 'hero' && H[a] ? `${H[a].name} — Overwatch Meta` : 'Overwatch Meta Auditor';
  }
  addEventListener('hashchange', render);

  // ========== META ==========
  const ms = { mode: store.get('mode', 'board'), roles: new Set(), status: null, q: '', sort: { k: 'adj', dir: -1 } };
  const passes = (r) => {
    if (ms.roles.size && !ms.roles.has(r.role)) return false;
    const s = patchOf(r.k);
    if (ms.status === 'buff' && s?.v !== 'buff') return false;
    if (ms.status === 'nerf' && s?.v !== 'nerf') return false;
    if (ms.status === 'changed' && !s) return false;
    if (ms.q && !H[r.k].name.toLowerCase().includes(ms.q.toLowerCase()) && !(H[r.k].subrole || '').includes(ms.q.toLowerCase())) return false;
    return true;
  };
  const trendOf = (k) => D.trend?.deltas?.[pk()]?.[k];
  function hcard(r) {
    const h = H[r.k], s = patchOf(r.k), t = trendOf(r.k);
    const mark = s ? `<span class="mark ${s.v}">${{ buff: '▲', nerf: '▼', mixed: '◆', rework: '?', fixes: '●' }[s.v]}</span>` : '';
    const tipHtml = `<b>${esc(h.name)}</b> · ${ROLE_LABEL[h.role]} tier ${r.tier} (#${r.rank} of ${r.of})<br>Win rate ${p1(r.wr)} · pick ${p1(r.pick)} · ban ${p1(r.ban)}${r.lowPick ? '<br><span class=r>Rarely picked: win rate is less reliable</span>' : ''}${s ? `<br>Latest patch: ${s.v}` : ''}${t ? `<br>${sgn(t[0])}pp win rate since the patch` : ''}`;
    return `<a class="hcard ${passes(r) ? '' : 'dim'}" href="${heroLink(r.k)}" ${tipAttr(tipHtml)}>${mark}${r.lowPick ? '<span class="move" aria-label="low pick rate">↕</span>' : ''}${avatar(h)}<div class="n">${esc(h.name)}</div><div class="w">${p1(r.wr)}</div><div class="d muted">${p1(r.pick)} pick</div></a>`;
  }
  function glance(rows) {
    const reliable = rows.filter((r) => r.pick >= 2);
    const top = [...reliable].sort((a, b) => b.wr - a.wr).slice(0, 5);
    const picked = [...rows].sort((a, b) => b.pick - a.pick).slice(0, 5);
    const banned = [...rows].sort((a, b) => b.ban - a.ban).slice(0, 5);
    const li = (r, v) => `<li>${heroCell(r.k)}<span class="num">${v}</span></li>`;
    const rising = D.trend && Object.entries(D.trend.deltas[pk()] || {}).sort((a, b) => b[1][0] - a[1][0]).slice(0, 5);
    return `<div class="glance">
      <div class="card"><h3><span>${rising ? 'Rising since the patch' : 'Highest win rate'}</span><span class="muted">${rising ? 'change' : 'pick ≥ 2%'}</span></h3><ol>${rising ? rising.map(([k, d]) => `<li>${heroCell(k)}<span class="num ${cls(d[0])}">${sgn(d[0])}pp</span></li>`).join('') : top.map((r) => li(r, p1(r.wr))).join('')}</ol></div>
      <div class="card"><h3><span>Most picked</span><span class="muted">pick rate</span></h3><ol>${picked.map((r) => li(r, p1(r.pick))).join('')}</ol></div>
      <div class="card"><h3><span>Most banned</span><span class="muted">ban rate</span></h3><ol>${banned.map((r) => li(r, p1(r.ban))).join('')}</ol></div></div>`;
  }
  function metaTable(rows) {
    const S = ms.sort;
    const val = { tier: (r) => r.z, name: (r) => H[r.k].name, role: (r) => r.role, wr: (r) => r.wr, adj: (r) => r.adj, pick: (r) => r.pick, ban: (r) => r.ban };
    const rs = rows.filter(passes).sort((a, b) => { const x = val[S.k](a), y = val[S.k](b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * S.dir; });
    const th = (k, l, r = '') => `<th class="sortable ${r} ${S.k === k ? 'sorted' : ''}" data-k="${k}">${l}${S.k === k ? (S.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`;
    return `<div class="tablewrap"><table class="grid" id="meta-table"><thead><tr>${th('tier', 'Tier')}${th('name', 'Hero')}${th('role', 'Role')}${th('adj', 'Rating', 'r')}${th('wr', 'Win rate', 'r')}${th('pick', 'Pick', 'r')}${th('ban', 'Ban', 'r')}<th>Latest patch</th></tr></thead><tbody>${rs.map((r) => `<tr class="row" data-k="${r.k}"><td><span class="tier ${r.tier}">${r.tier}</span></td><td>${heroCell(r.k)}</td><td><span class="role-dot ${r.role}"></span>${ROLE_LABEL[r.role]} <span class="muted small">${esc(H[r.k].subrole || '')}</span></td>
      <td class="r" ${tipAttr('Win rate pulled toward 50% for rarely picked heroes')}><b>${p1(r.adj)}</b></td><td class="r">${p1(r.wr)}</td><td class="r">${p1(r.pick)}</td><td class="r">${p1(r.ban)}</td><td>${verdictPill(patchOf(r.k))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function byRank() {
    const keys = tiers().filter(passes).sort((a, b) => b.adj - a.adj).map((r) => r.k);
    return `<div class="tablewrap"><table class="grid heat"><thead><tr><th>Hero</th>${DIVS.map((d) => `<th class="r">${DIV_LABEL(d)}</th>`).join('')}</tr></thead><tbody>${keys.map((k) => `<tr class="row" data-k="${k}"><td>${heroCell(k)}</td>${DIVS.map((d) => { const r = rowOf(k, pk(), d); if (!r) return '<td class="h">–</td>'; const v = r.wr - 50;
      return `<td class="h ${divClass(v, [1, 3, 5])}" ${tipAttr(`<b>${esc(H[k].name)}</b> · ${DIV_LABEL(d)}<br>Win rate ${p1(r.wr)} · pick ${p1(r.pick)} · tier ${r.tier}`)}>${sgn(v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="legend">Win rate vs 50% (pp): ${legendRamp('−5', '+5')} · ${esc(D.config.platforms[sel.platform])}, ${esc(D.config.regions[sel.region])}</div>`;
  }
  function viewMeta() {
    const rows = tiers();
    if (!rows.length) { view.innerHTML = `<div class="card"><p class="empty">No data for ${esc(selLabel())}.</p></div>`; return; }
    view.innerHTML = `
      <div class="section-head"><div><h1>Who's strong right now</h1><p>${esc(selLabel())} · competitive role queue. Tiers compare each hero with the other heroes <b>in the same role</b>. Click a hero for maps, kit and patch history.</p></div></div>
      ${glance(rows)}
      ${help('How are tiers worked out?', `Numbers are Blizzard's official win, pick and ban rates for the platform, region and rank you've chosen. Blizzard doesn't say how many games each number is based on, so heroes that are rarely picked (<b>↕</b>, under 1% pick rate) have their win rate pulled toward 50% before ranking. Tiers are relative within each role: S is well above the average tank/damage/support, D well below. <b>▲ ▼</b> mark heroes buffed or nerfed in the latest patch.`)}
      <div class="toolbar">
        <div class="seg" id="mode-seg">${[['board', 'Tier board'], ['table', 'Table'], ['rank', 'By rank']].map(([k, l]) => `<button data-k="${k}" class="${ms.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${ROLES.map((r) => `<button class="chip ${ms.roles.has(r) ? 'on' : ''}" data-role="${r}"><span class="role-dot ${r}"></span>${ROLE_LABEL[r]}</button>`).join('')}
        ${[['buff', '▲ Buffed'], ['nerf', '▼ Nerfed'], ['changed', 'Changed in latest patch']].map(([k, l]) => `<button class="chip ${ms.status === k ? 'on' : ''}" data-status="${k}">${l}</button>`).join('')}
        <input id="meta-q" type="search" placeholder="Filter by name or subrole (e.g. flanker)" value="${esc(ms.q)}" style="flex:1;min-width:200px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--ink)">
      </div><div id="meta-body"></div>`;
    const body = $('#meta-body');
    const draw = () => {
      if (ms.mode === 'board') body.innerHTML = `<div class="rboard"><div class="rh"></div>${ROLES.map((r) => `<div class="rh"><span class="role-dot ${r}"></span>${ROLE_LABEL[r]}</div>`).join('')}${TIERS.map(([t, l]) => `<div class="tl ${t}">${t}<small>${l}</small></div>${ROLES.map((role) => `<div class="cell" data-role="${ROLE_LABEL[role]}">${rows.filter((r) => r.tier === t && r.role === role).sort((a, b) => b.adj - a.adj).map(hcard).join('')}</div>`).join('')}`).join('')}</div>`;
      else if (ms.mode === 'table') body.innerHTML = metaTable(rows);
      else body.innerHTML = byRank();
    };
    draw();
    $('#mode-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; ms.mode = b.dataset.k; store.set('mode', ms.mode); viewMeta(); });
    $$('[data-role]', view).forEach((b) => b.addEventListener('click', () => { ms.roles.has(b.dataset.role) ? ms.roles.delete(b.dataset.role) : ms.roles.add(b.dataset.role); b.classList.toggle('on'); draw(); }));
    $$('[data-status]', view).forEach((b) => b.addEventListener('click', () => { ms.status = ms.status === b.dataset.status ? null : b.dataset.status; $$('[data-status]', view).forEach((x) => x.classList.toggle('on', x.dataset.status === ms.status)); draw(); }));
    $('#meta-q').addEventListener('input', (e) => { ms.q = e.target.value; draw(); });
    body.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-k]'); if (th) { const k = th.dataset.k; ms.sort = { k, dir: ms.sort.k === k ? -ms.sort.dir : (['name', 'role'].includes(k) ? 1 : -1) }; draw(); return; }
      const tr = e.target.closest('tr.row'); if (tr && !e.target.closest('a')) location.hash = heroLink(tr.dataset.k);
    });
  }

  // ========== HERO ==========
  function viewHero(k, sub) {
    const h = H[k];
    if (!h) { view.innerHTML = '<p>Unknown hero. <a href="#/meta">Back to the meta</a></p>'; return; }
    const r = rowOf(k);
    const roleRows = tiers().filter((x) => x.role === h.role).sort((a, b) => b.adj - a.adj);
    const i = roleRows.findIndex((x) => x.k === k), n = roleRows.length;
    const prev = roleRows[(i - 1 + n) % n]?.k, next = roleRows[(i + 1) % n]?.k;
    const s = patchOf(k), t = trendOf(k);
    const subs = [['overview', 'Overview'], ['maps', 'Best maps'], ['counters', 'Counters'], ['kit', 'Kit & perks'], ['history', 'Patch history']];
    view.innerHTML = `
      <div class="card"><div class="hero-head">${avatar(h, 'portrait')}
        <div><h1>${esc(h.name)} ${r ? `<span class="tier ${r.tier}" style="vertical-align:3px">${r.tier}</span>` : ''}</h1>
          <div class="meta">${r ? `<span><span class="big">${p1(r.wr)}</span> win rate</span><span>#${r.rank} of ${r.of} ${ROLE_LABEL[h.role].toLowerCase()}${h.role === 'damage' ? ' heroes' : 's'}</span><span>Pick ${p1(r.pick)}</span><span>Ban ${p1(r.ban)}</span>` : '<span class="muted">No stats for this selection</span>'}
            ${t ? `<span class="${cls(t[0])}">${sgn(t[0])}pp since patch</span>` : ''}${verdictPill(s)}<span class="tag"><span class="role-dot ${h.role}"></span>${ROLE_LABEL[h.role]}${h.subrole ? ' · ' + esc(h.subrole) : ''}</span></div></div>
        ${prev ? `<div class="hero-nav"><a href="${heroLink(prev, sub)}">← ${esc(H[prev].name)}</a><a href="${heroLink(next, sub)}">${esc(H[next].name)} →</a></div>` : ''}</div>
        <div class="ctx-strip" aria-label="Tier at each rank">${DIVS.map((d) => { const x = rowOf(k, pk(), d); return `<button data-d="${d}" class="${d === sel.div ? 'on' : ''}" ${tipAttr(`Switch every view to ${DIV_LABEL(d)}`)}><span class="tier ${x?.tier || ''}">${x?.tier ?? '–'}</span>${DIV_LABEL(d)} · ${x ? p1(x.wr) : '–'}</button>`; }).join('')}</div></div>
      <div class="subtabs">${subs.map(([s2, l]) => `<a href="${heroLink(k, s2)}" class="${s2 === sub ? 'on' : ''}">${l}</a>`).join('')}</div>
      <div id="hero-body"></div>`;
    $$('.ctx-strip button', view).forEach((b) => b.addEventListener('click', () => { sel.div = b.dataset.d; $('#sel-div').value = sel.div; store.set('div', sel.div); render(); }));
    ({ overview: heroOverview, maps: heroMaps, counters: heroCounters, kit: heroKit, history: heroHistory }[sub] || heroOverview)($('#hero-body'), k);
  }
  function heroCounters(body, k) {
    const slug = D.cwLinks?.[k], name = esc(H[k].name);
    body.innerHTML = `<div class="card"><h3>Who counters ${name}, and who ${name} counters</h3>
      <p style="margin-top:0;color:var(--ink-2);max-width:760px">Blizzard doesn't publish hero-vs-hero data. The only public source is <b>Counterwatch</b>, which builds matchups from kill feeds in games played by its app users. Their terms only allow personal, non-commercial use, so their data isn't copied here. Open ${name}'s page on their site instead:</p>
      ${slug ? `<div class="ext-links"><a href="https://www.counterwatch.gg/stats/overwatch/counters/${esc(slug)}" target="_blank" rel="noopener">${name} counters on Counterwatch ↗</a><a class="alt" href="https://www.counterwatch.gg/stats/overwatch/best-duos/${esc(slug)}" target="_blank" rel="noopener">Best duos with ${name} ↗</a></div>`
        : `<div class="ext-links"><a href="https://www.counterwatch.gg/stats/overwatch" target="_blank" rel="noopener">Counterwatch hero stats ↗</a></div><p class="muted small">No dedicated Counterwatch page found for ${name} yet.</p>`}
      <p class="muted small" style="margin-bottom:0">How to read their numbers: a counter rating of 0 is an even matchup; positive means the first hero wins the duels; around ±7 is already a strong counter.</p></div>`;
  }
  function dotChart(points, label) { // points: [{label, v, sub}]
    if (!points.length) return '<p class="empty">No data.</p>';
    const vals = points.map((p) => p.v);
    const lo = Math.min(45, ...vals) - 1, hi = Math.max(55, ...vals) + 1;
    const W = 520, L = 120, rh = 28, Hh = points.length * rh + 26, x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - 14);
    const ticks = []; for (let t = Math.ceil(lo / 2) * 2; t <= hi; t += 2) ticks.push(t);
    return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="${esc(label)}">
      ${ticks.map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="${Hh - 20}" stroke="${t === 50 ? 'var(--axis)' : 'var(--grid)'}"/><text x="${x(t)}" y="${Hh - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${t}%</text>`).join('')}
      ${points.map((p, i) => { const y = i * rh + 14; return `<g ${tipAttr(p.tip)}><rect x="0" y="${y - 13}" width="${W}" height="${rh}" fill="transparent"/><text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="var(--ink)" font-weight="${p.on ? 700 : 400}">${esc(p.label)}</text>
        <line x1="${x(50)}" x2="${x(p.v)}" y1="${y}" y2="${y}" stroke="${p.v >= 50 ? 'var(--pos-1)' : 'var(--neg-1)'}" stroke-width="4" stroke-linecap="round"/>
        <circle cx="${x(p.v)}" cy="${y}" r="${p.r || 5.5}" fill="${p.on ? 'var(--ink)' : 'var(--accent)'}" stroke="var(--surface)" stroke-width="2"/></g>`; }).join('')}</svg>`;
  }
  function heroOverview(body, k) {
    const byDiv = DIVS.map((d) => ({ d, r: rowOf(k, pk(), d) })).filter((x) => x.r).map(({ d, r }) => ({ label: DIV_LABEL(d), v: r.wr, on: d === sel.div, r: 3 + Math.min(r.pick, 30) / 5, tip: `<b>${DIV_LABEL(d)}</b><br>Win ${p1(r.wr)} · pick ${p1(r.pick)} · ban ${p1(r.ban)} · tier ${r.tier}` }));
    const combos = [];
    for (const p of Object.keys(D.config.platforms)) for (const g of Object.keys(D.config.regions)) { const r = rowOf(k, `${p}|${g}`, sel.div); if (r) combos.push({ p, g, r }); }
    const wrs = DIVS.slice(1).map((d) => rowOf(k, pk(), d)?.wr).filter((v) => v != null);
    const lean = wrs.length > 3 ? (wrs.slice(-3).reduce((s, v) => s + v, 0) / 3) - (wrs.slice(0, 3).reduce((s, v) => s + v, 0) / 3) : 0;
    body.innerHTML = `<div class="cols">
      <div class="card"><h3>Win rate by rank</h3><p class="muted small" style="margin-top:0">${esc(D.config.platforms[sel.platform])}, ${esc(D.config.regions[sel.region])} · dot size = pick rate · ${Math.abs(lean) >= 2 ? `<b>${lean > 0 ? 'Gets stronger at higher ranks' : 'Strongest at lower ranks'}</b> (${sgn(lean)}pp top vs bottom ranks)` : 'Similar across ranks'}</p>${dotChart(byDiv, 'Win rate by rank')}</div>
      <div class="card"><h3>By platform &amp; region</h3><p class="muted small" style="margin-top:0">${esc(DIV_LABEL(sel.div))}. Your current selection is in bold.</p>
        <div class="tablewrap"><table class="grid"><thead><tr><th>Platform</th><th>Region</th><th class="r">Win</th><th class="r">Pick</th><th class="r">Ban</th><th>Tier</th></tr></thead><tbody>${combos.map(({ p, g, r }) => `<tr style="${p === sel.platform && g === sel.region ? 'font-weight:700' : ''}"><td>${esc(D.config.platforms[p])}</td><td>${esc(D.config.regions[g])}</td><td class="r">${p1(r.wr)}</td><td class="r">${p1(r.pick)}</td><td class="r">${p1(r.ban)}</td><td><span class="tier ${r.tier}" style="width:22px;height:22px;font-size:12px">${r.tier}</span></td></tr>`).join('')}</tbody></table></div></div></div>
      ${(() => { const p = [...D.patches].reverse().find((x) => x.dev?.[k]); return p ? `<div class="card"><h3>Blizzard's latest note on ${esc(H[k].name)}</h3><div class="dev"><b>${esc(p.title.replace(/^Overwatch Retail Patch Notes – /, ''))}:</b> ${esc(p.dev[k])}</div><a href="${heroLink(k, 'history')}">See all changes →</a></div>` : ''; })()}`;
  }
  function heroMaps(body, k) {
    const base = rowOf(k);
    const list = D.maps.map((m) => ({ m, r: mapRows(m.key).find((x) => x.k === k) })).filter((x) => x.r && base).map((x) => ({ ...x, d: x.r.adj - base.adj })).sort((a, b) => b.d - a.d);
    if (!list.length) { body.innerHTML = '<div class="card"><p class="empty">No map data for this selection.</p></div>'; return; }
    const max = Math.max(1, ...list.map((x) => Math.abs(x.d)));
    const bars = (xs) => `<div class="bars">${xs.map((x) => { const w = (Math.abs(x.d) / max) * 48; return `<div class="b" ${tipAttr(`<b>${esc(x.m.name)}</b> (${esc(x.m.mode)})<br>Win ${p1(x.r.wr)} · pick ${p1(x.r.pick)}<br>${sgn(x.d)}pp vs ${esc(H[k].name)}'s overall rating`)}><a class="hero" href="#/maps/${x.m.key}"><span>${esc(x.m.name)}</span></a><svg viewBox="0 0 100 12" preserveAspectRatio="none"><line x1="50" x2="50" y1="0" y2="12" stroke="var(--axis)"/><rect x="${x.d >= 0 ? 50 : 50 - w}" y="2" width="${w}" height="8" rx="1.5" fill="${x.d >= 0 ? 'var(--pos-2)' : 'var(--neg-2)'}"/></svg><span class="r num ${cls(x.d)}">${sgn(x.d)}pp</span></div>`; }).join('')}</div>`;
    body.innerHTML = `<p class="muted small">How ${esc(H[k].name)} does on each map compared with their overall rating (${esc(D.config.platforms[sel.platform])}, ${esc(D.config.regions[sel.region])}, all ranks — Blizzard doesn't split maps by rank).</p>
      <div class="cols"><div class="card"><h3>Best maps</h3>${bars(list.filter((x) => x.d > 0).slice(0, 12))}</div><div class="card"><h3>Worst maps</h3>${bars(list.filter((x) => x.d < 0).reverse().slice(0, 12))}</div></div>`;
  }
  function heroKit(body, k) {
    const kit = D.kits[k];
    if (!kit) { body.innerHTML = '<div class="card"><p class="empty">No kit details available.</p></div>'; return; }
    const ab = (a) => `<div class="ab">${a.icon ? `<img src="${esc(a.icon)}" alt="" loading="lazy">` : '<span></span>'}<div><b>${esc(a.name)}</b><p>${esc(a.desc)}</p></div></div>`;
    body.innerHTML = `<div class="card"><h3>Abilities</h3>${kit.hp ? `<p class="muted small" style="margin-top:0">Health ${kit.hp.health}${kit.hp.armor ? ` · armor ${kit.hp.armor}` : ''}${kit.hp.shields ? ` · shields ${kit.hp.shields}` : ''} · total ${kit.hp.total}</p>` : ''}<div class="kit">${kit.abilities.map(ab).join('')}</div></div>
      <div class="cols"><div class="card"><h3>Minor perks</h3><p class="muted small" style="margin-top:0">Pick one mid-match.</p><div class="kit">${kit.perks.minor.map(ab).join('') || '<p class="empty">None listed</p>'}</div></div>
      <div class="card"><h3>Major perks</h3><p class="muted small" style="margin-top:0">Pick one later in the match.</p><div class="kit">${kit.perks.major.map(ab).join('') || '<p class="empty">None listed</p>'}</div></div></div>
      <p class="muted small">Blizzard doesn't publish perk pick or win rates, so there's no perk recommendation here.</p>`;
  }
  const mk = (d) => (d === 1 ? ['buff', '▲'] : d === -1 ? ['nerf', '▼'] : d === 0 ? ['neutral', '●'] : ['unknown', '?']);
  const changeRow = (c) => { const [cl, s] = mk(c.d); return `<div class="chg"><span class="m ${cl}">${s}</span><div>${c.a ? `<b>${esc(c.a)}</b> — ` : ''}${esc(c.l.replace(/^[^-]+ - /, (x) => (c.a && x.startsWith(c.a) ? '' : x)))}<div class="meta">${esc(c.r)} · confidence ${c.c}</div></div></div>`; };
  function heroHistory(body, k) {
    const ps = [...D.patches].reverse().filter((p) => p.changes.some((c) => c.t === k));
    body.innerHTML = ps.length ? ps.map((p) => { const s = p.summary[k]; return `<div class="card"><h3>${esc(p.title.replace(/^Overwatch Retail Patch Notes – /, ''))} ${verdictPill(s)}</h3>${p.dev?.[k] ? `<div class="dev"><b>Blizzard:</b> ${esc(p.dev[k])}</div>` : ''}${p.changes.filter((c) => c.t === k).map(changeRow).join('')}</div>`; }).join('')
      : '<div class="card"><p class="empty">No balance changes for this hero in the patches we track.</p></div>';
  }

  // ========== MAPS ==========
  let mapMode = '';
  function viewMaps(mapKey) {
    const avail = D.maps.filter((m) => D.mapStats[pk()]?.[m.key]);
    if (!avail.length) { view.innerHTML = '<div class="card"><p class="empty">No map data for this platform/region.</p></div>'; return; }
    const m = MAP[mapKey] && D.mapStats[pk()]?.[mapKey] ? MAP[mapKey] : avail[0];
    const rows = mapRows(m.key);
    const base = Object.fromEntries(tiers(pk(), 'all').map((r) => [r.k, r]));
    const scored = rows.map((r) => ({ ...r, d: base[r.k] ? r.adj - base[r.k].adj : 0 }));
    const best = (role, n) => scored.filter((r) => r.role === role && r.pick >= 1).sort((a, b) => b.adj - a.adj).slice(0, n);
    const lineup = [...best('tank', 1), ...best('damage', 2), ...best('support', 2)];
    const modes = [...new Set(avail.map((x) => x.mode))].sort();
    const roleTable = (role) => `<div class="card"><h3><span class="role-dot ${role}"></span>${ROLE_LABEL[role]}</h3><div class="tablewrap"><table class="grid"><thead><tr><th>Hero</th><th class="r">Win</th><th class="r">Pick</th><th class="r" ${tipAttr('Rating on this map minus the hero\'s overall rating')}>vs usual</th></tr></thead><tbody>${scored.filter((r) => r.role === role).sort((a, b) => b.adj - a.adj).map((r) => `<tr class="row" data-k="${r.k}"><td>${heroCell(r.k, 'maps')}</td><td class="r">${p1(r.wr)}</td><td class="r">${p1(r.pick)}</td><td class="r ${cls(r.d, 0.3)}">${sgn(r.d)}</td></tr>`).join('')}</tbody></table></div></div>`;
    view.innerHTML = `
      <div class="card map-picker">
        <div class="toolbar" style="margin-bottom:10px">
          <label class="ctx-pick"><span><b>Map</b></span><select id="map-sel" aria-label="Choose a map">${modes.map((mode) => `<optgroup label="${esc(cap(mode))}">${avail.filter((x) => x.mode === mode).sort((a, b) => a.name.localeCompare(b.name)).map((x) => `<option value="${x.key}" ${x.key === m.key ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
          <div class="seg" id="mode-filter"><button data-m="" class="${!mapMode ? 'on' : ''}">All modes</button>${modes.map((mode) => `<button data-m="${mode}" class="${mapMode === mode ? 'on' : ''}">${esc(cap(mode))}</button>`).join('')}</div>
        </div>
        <div class="map-strip" id="map-strip">${avail.filter((x) => !mapMode || x.mode === mapMode).sort((a, b) => a.mode.localeCompare(b.mode) || a.name.localeCompare(b.name)).map((x) => `<a class="map-card ${x.key === m.key ? 'on' : ''}" href="#/maps/${x.key}" style="background-image:url('${esc(x.img)}')" ${x.key === m.key ? 'aria-current="true"' : ''}><span>${esc(x.name)}<small>${esc(x.mode)}</small></span></a>`).join('')}</div>
      </div>
      <div class="section-head"><div><h1>${esc(m.name)}</h1><p>${esc(cap(m.mode))}${m.location ? ' · ' + esc(m.location) : ''} · ${esc(D.config.platforms[sel.platform])}, ${esc(D.config.regions[sel.region])}, all ranks (Blizzard doesn't split maps by rank).</p></div></div>
      <div class="card"><h3>Strongest lineup on ${esc(m.name)}</h3><p class="muted small" style="margin-top:0">The highest-rated tank, two damage and two supports on this map. This doesn't account for how heroes work together, since no public data covers that.</p>
        <div class="lineup">${lineup.map((r) => `<a class="slot" href="${heroLink(r.k, 'maps')}" ${tipAttr(`Win ${p1(r.wr)} · pick ${p1(r.pick)} on ${esc(m.name)}<br>${sgn(r.d)}pp vs their usual rating`)}>${avatar(H[r.k])}<span class="rl"><span class="role-dot ${r.role}"></span>${ROLE_LABEL[r.role]}</span><b>${esc(H[r.k].name)}</b><span class="small">${p1(r.wr)}</span></a>`).join('')}</div></div>
      <div class="cols3" style="margin-top:16px">${ROLES.map(roleTable).join('')}</div>`;
    $('#map-sel').addEventListener('change', (e) => { location.hash = `#/maps/${e.target.value}`; });
    $('#mode-filter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; mapMode = b.dataset.m; viewMaps(m.key); });
    $('#map-strip .map-card.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    $$('.cols3 tbody', view).forEach((tb) => tb.addEventListener('click', (e) => { const tr = e.target.closest('tr.row'); if (tr && !e.target.closest('a')) location.hash = heroLink(tr.dataset.k, 'maps'); }));
  }

  // ========== PATCH ==========
  function viewPatch() {
    if (!latest) { view.innerHTML = '<div class="card"><p class="empty">No balance patches found.</p></div>'; return; }
    const pick = new URLSearchParams(location.hash.split('?')[1] || '').get('p');
    const P = D.patches.find((p) => p.id === pick) || latest;
    const heroesIn = [...new Set(P.changes.map((c) => c.t))].sort((a, b) => H[a].role.localeCompare(H[b].role) || H[a].name.localeCompare(H[b].name));
    const S = Object.values(P.summary);
    view.innerHTML = `
      <div class="section-head"><div><h1>${esc(P.title)}</h1><p>Blizzard's patch notes, read line by line into buffs and nerfs. Stadium-only changes are left out.</p></div>
        <label class="ctx-pick">Patch <select id="patch-sel">${[...D.patches].reverse().map((p) => `<option value="${p.id}" ${p.id === P.id ? 'selected' : ''}>${esc(p.title.replace(/^Overwatch Retail Patch Notes – /, ''))}</option>`).join('')}</select></label></div>
      <div class="stats">
        <div class="stat"><div class="l">Heroes buffed</div><div class="v up">${S.filter((s) => s.v === 'buff').length}</div></div>
        <div class="stat"><div class="l">Heroes nerfed</div><div class="v down">${S.filter((s) => s.v === 'nerf').length}</div></div>
        <div class="stat"><div class="l">Mixed / rework</div><div class="v">${S.filter((s) => !['buff', 'nerf'].includes(s.v)).length}</div></div>
        <div class="stat"><div class="l">Lines needing judgement</div><div class="v" style="color:var(--warn)">${P.changes.filter((c) => c.d === null).length}</div><div class="h">of ${P.changes.length} · reworks, perk swaps</div></div>
        <div class="stat"><div class="l">Since this patch</div><div class="v" style="font-size:16px">${D.trend && D.trend.patch === P.id ? 'Tracking' : 'Not tracked yet'}</div><div class="h">${D.trend && D.trend.patch === P.id ? `snapshots ${D.trend.from} → ${D.trend.to}` : 'needs a snapshot from before the patch'}</div></div></div>
      ${heroesIn.map((k) => { const r = rowOf(k); const t = trendOf(k); return `<div class="card"><h3 style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${heroCell(k, 'history')} ${verdictPill(P.summary[k])} <span class="tag"><span class="role-dot ${H[k].role}"></span>${ROLE_LABEL[H[k].role]}</span>${r ? `<span class="muted small">now ${p1(r.wr)} win · tier ${r.tier}${t && D.trend.patch === P.id ? ` · <span class="${cls(t[0])}">${sgn(t[0])}pp since patch</span>` : ''}</span>` : ''}</h3>
        ${P.dev?.[k] ? `<div class="dev"><b>Blizzard:</b> ${esc(P.dev[k])}</div>` : ''}${P.changes.filter((c) => c.t === k).map(changeRow).join('')}</div>`; }).join('')}`;
    $('#patch-sel').addEventListener('change', (e) => { location.hash = `#/patch?p=${e.target.value}`; });
  }

  // ========== ABOUT / AUDIT ==========
  function viewAbout() {
    const allLines = D.patches.flatMap((p) => p.changes);
    view.innerHTML = `
      <div class="section-head"><div><h1>Data &amp; audit</h1><p>Where the numbers come from and what this tool can and can't tell you.</p></div></div>
      <div class="stats">
        <div class="stat"><div class="l">Heroes</div><div class="v">${D.heroes.length}</div></div>
        <div class="stat"><div class="l">Stat queries</div><div class="v">${D.calls}</div><div class="h">2 platforms × 3 regions × 9 ranks, plus maps</div></div>
        <div class="stat"><div class="l">Maps with data</div><div class="v">${Object.keys(D.mapStats[pk()] || {}).length}</div><div class="h">${esc(D.config.platforms[sel.platform])}, ${esc(D.config.regions[sel.region])}</div></div>
        <div class="stat"><div class="l">Patches parsed</div><div class="v">${D.patches.length}</div><div class="h">${allLines.length} hero lines · ${allLines.filter((c) => c.d === null).length} need judgement</div></div>
        <div class="stat"><div class="l">Daily snapshots</div><div class="v">${D.snapshots.length}</div><div class="h">${D.snapshots[0] ? 'since ' + D.snapshots[0] : ''}</div></div></div>
      <div class="cols">
        <div class="card"><h3>Sources</h3><ul class="small" style="padding-left:18px;margin:0;color:var(--ink-2)">
          <li><b>Win, pick and ban rates</b>: Blizzard's official <a href="https://overwatch.blizzard.com/en-us/rates/" target="_blank" rel="noopener">Hero Statistics</a> page, read through the community <a href="https://overfast-api.tekrop.fr" target="_blank" rel="noopener">OverFast API</a>. Competitive role queue, split by platform, region, rank and map.</li>
          <li><b>Hero kits and perks</b>: OverFast API (from Blizzard's hero pages).</li>
          <li><b>Patch notes and developer comments</b>: Blizzard's <a href="https://overwatch.blizzard.com/en-us/news/patch-notes/" target="_blank" rel="noopener">patch notes</a>, read by this tool's parser (shared with the Deadlock site).</li></ul></div>
        <div class="card"><h3>What's worked out here</h3><ul class="small" style="padding-left:18px;margin:0;color:var(--ink-2)">
          <li>Tiers: each hero's win rate is compared with the others in their role (S ≥ +1.25σ, A ≥ +0.5σ, B ≥ −0.5σ, C ≥ −1.25σ).</li>
          <li>Rarely picked heroes are pulled toward 50% (as if ${D.config.shrinkPick} point of pick rate were at 50%), because Blizzard publishes no game counts.</li>
          <li>Map ratings and the suggested lineup use the same rating, on that map only.</li>
          <li>Patch lines are classed as buff/nerf/neutral by number direction and wording; uncertain lines are marked “?”.</li></ul></div></div>
      <div class="card"><h3>Limits (and how they'll improve)</h3><ul class="small" style="padding-left:18px;margin:0;color:var(--ink-2)">
        <li><b>No matchups, synergies or perk stats.</b> No public source publishes hero-vs-hero or perk data for Overwatch, so those parts of the Deadlock site don't exist here.</li>
        <li><b>No confidence ranges.</b> Blizzard doesn't publish game counts. Treat small differences (under ~1pp) as noise.</li>
        <li><b>No history from Blizzard.</b> The tool saves a daily snapshot each time it's rebuilt (${D.snapshots.length} so far). Once there are snapshots from before and after a patch, the site shows “since the patch” changes, and over a few patches it can test how well the buff/nerf reading predicts real changes, like the Deadlock audit.</li>
        <li><b>Maps aren't split by rank</b> in Blizzard's data.</li></ul></div>`;
  }

  render();
})();
