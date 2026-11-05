/* Deadlock Meta Auditor dashboard — reads window.META written by src/build.js.
   Hash routes (shareable): #/meta  #/hero/<id>/<build|overview|matchups|synergy|history>
                            #/patch  #/matchups  #/draft  #/audit                      */
(() => {
  const M = window.META;
  const view = document.getElementById('view');
  if (!M) { view.innerHTML = '<p>No data. Run <code>node src/build.js</code> first.</p>'; return; }

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (x, d = 1) => (x == null || isNaN(x) ? '–' : (x * 100).toFixed(d) + '%');
  const sgn = (x, d = 1) => (x == null || isNaN(x) ? '–' : (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(d));
  const ppS = (x, d = 1) => (x == null || isNaN(x) ? '–' : sgn(x * 100, d) + 'pp');
  const cls = (x, eps = 0.002) => (x > eps ? 'up' : x < -eps ? 'down' : '');
  const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const store = { get(k, d) { try { return JSON.parse(localStorage.getItem('dma-' + k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem('dma-' + k, JSON.stringify(v)); } catch {} } };
  const tipAttr = (html) => `data-tip="${esc(html)}"`;

  const H = Object.fromEntries(M.heroes.map((h) => [h.id, h]));
  const byName = Object.fromEntries(M.heroes.map((h) => [h.name, h]));
  const CTX = Object.keys(M.contexts);
  let ctx = store.get('ctx', 'all'); if (!CTX.includes(ctx)) ctx = 'all';
  const rows = () => M.tiers[ctx];
  const tierOf = (c, id) => M.tiers[c]?.find((r) => r.id === id);
  const initials = (n) => n.replace(/^The /, '').split(/[\s&]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2);
  const avatar = (h, extra = '') => h.img
    ? `<img class="avatar ${extra}" src="${esc(h.img)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;avatar ${extra}&quot;>${esc(initials(h.name))}</span>'">`
    : `<span class="avatar ${extra}">${esc(initials(h.name))}</span>`;
  const heroLink = (id, sub = 'build') => `#/hero/${id}/${sub}`;
  const heroCell = (id, sub) => `<a class="hero" href="${heroLink(id, sub)}">${avatar(H[id])}<span>${esc(H[id].name)}</span></a>`;
  const verdictPill = (p) => (p ? `<span class="pill ${p.verdict}">${{ buff: '▲ buffed', nerf: '▼ nerfed', mixed: '◆ mixed', rework: '? rework', fixes: '● fixes' }[p.verdict]}</span>` : '');
  const divClass = (v, t) => (v >= t[2] ? 'cell-pos-3' : v >= t[1] ? 'cell-pos-2' : v >= t[0] ? 'cell-pos-1' : v <= -t[2] ? 'cell-neg-3' : v <= -t[1] ? 'cell-neg-2' : v <= -t[0] ? 'cell-neg-1' : 'cell-mid');
  const legendRamp = (labels) => `<span class="ramp">${['neg-3', 'neg-2', 'neg-1', 'mid', 'pos-1', 'pos-2', 'pos-3'].map((c) => `<i class="cell-${c}"></i>`).join('')}</span><span>${labels[0]} … ${labels[1]}</span>`;
  const TIERS = [['S', 'Top pick'], ['A', 'Strong'], ['B', 'Solid'], ['C', 'Weak'], ['D', 'Struggling']];
  const help = (summary, html) => `<details class="help"><summary>${summary}</summary><div>${html}</div></details>`;

  // tooltip
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

  // ---------- header: patch chip, context, theme, search ----------
  $('#patch-chip').textContent = `${M.patch.title} · ${M.mode === 'forecast' ? 'forecast' : 'live data'}`;
  $('#foot-info').textContent = `Built ${new Date(M.generated).toLocaleString()} · ${Math.round(M.contexts.all.postGames).toLocaleString()} post-patch matches`;
  const ctxSel = $('#ctx-select');
  ctxSel.innerHTML = CTX.map((k) => `<option value="${k}">${esc(M.contexts[k].label)}</option>`).join('');
  ctxSel.value = ctx;
  const setCtx = (k) => { ctx = k; ctxSel.value = k; store.set('ctx', k); render(); };
  ctxSel.addEventListener('change', () => setCtx(ctxSel.value));
  $('#theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('dma-theme', document.documentElement.dataset.theme); } catch {}
  });

  const search = $('#hero-search'), list = $('#search-list');
  let sel = 0, matches = [];
  function openSearch() {
    const q = search.value.trim().toLowerCase();
    matches = M.heroes.filter((h) => !q || h.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12);
    sel = 0;
    list.innerHTML = matches.map((h, i) => { const r = tierOf(ctx, h.id); return `<li role="option" data-id="${h.id}" aria-selected="${i === sel}">${avatar(h)}<span style="flex:1">${esc(h.name)}</span>${r ? `<span class="tier ${r.tier}" style="width:20px;height:20px;font-size:11px">${r.tier}</span>` : ''}</li>`; }).join('') || '<li class="muted">No hero found</li>';
    list.hidden = false; search.setAttribute('aria-expanded', 'true');
  }
  const closeSearch = () => { list.hidden = true; search.setAttribute('aria-expanded', 'false'); };
  const goHero = (id) => { closeSearch(); search.value = ''; search.blur(); location.hash = heroLink(id); };
  search.addEventListener('input', openSearch);
  search.addEventListener('focus', openSearch);
  search.addEventListener('blur', () => setTimeout(closeSearch, 150));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % Math.max(matches.length, 1); $$('li', list).forEach((li, i) => li.setAttribute('aria-selected', i === sel)); }
    else if (e.key === 'Enter' && matches[sel]) goHero(matches[sel].id);
    else if (e.key === 'Escape') { closeSearch(); search.blur(); }
  });
  list.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-id]'); if (li) goHero(+li.dataset.id); });
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !/input|select|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); search.focus(); } });

  // ---------- router ----------
  function parse() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    return { route: parts[0] || 'meta', a: parts[1], b: parts[2] };
  }
  let lastRoute = '';
  function render() {
    const { route, a, b } = parse();
    $$('#tabs a').forEach((x) => x.classList.toggle('on', x.dataset.route === route));
    const fn = { meta: viewMeta, hero: () => viewHero(+a, b || 'build'), patch: viewPatch, matchups: viewMatchups, draft: viewDraft, audit: viewAudit }[route] || viewMeta;
    fn();
    const key = route + (a || '');
    if (key !== lastRoute) { scrollTo(0, 0); lastRoute = key; }
    document.title = route === 'hero' && H[+a] ? `${H[+a].name} — Deadlock Meta` : 'Deadlock Meta Auditor';
  }
  addEventListener('hashchange', render);

  // ========== META ==========
  const metaState = { mode: store.get('meta-mode', 'board'), roles: new Set(), status: null, q: '', sort: { k: 'posterior', dir: -1 }, sitSort: 'all' };
  const roles = [...new Set(M.heroes.map((h) => h.type).filter(Boolean))].sort();
  const matchFilter = (r) => {
    const h = H[r.id];
    if (metaState.roles.size && !metaState.roles.has(h.type)) return false;
    if (metaState.status === 'buff' && r.patch?.verdict !== 'buff') return false;
    if (metaState.status === 'nerf' && r.patch?.verdict !== 'nerf') return false;
    if (metaState.status === 'changed' && !r.patch) return false;
    const q = metaState.q.toLowerCase();
    if (q && !h.name.toLowerCase().includes(q) && !(M.tags[r.id] || []).some((t) => t.tag.toLowerCase().includes(q))) return false;
    return true;
  };

  function glance() {
    const R = M.tiers.all.filter((r) => r.postN > 1500 && r.postWR != null).map((r) => ({ ...r, d: r.postWR - r.preWR }));
    const up = [...R].sort((a, b) => b.d - a.d).slice(0, 5), down = [...R].sort((a, b) => a.d - b.d).slice(0, 5);
    const bans = [...M.tiers.all].filter((r) => r.banRate != null).sort((a, b) => b.banRate - a.banRate).slice(0, 5);
    const li = (r, v, c) => `<li>${heroCell(r.id)}<span class="num ${c}">${v}</span></li>`;
    return `<div class="glance">
      <div class="card"><h3><span>Rising since the patch</span><span class="muted">win rate</span></h3><ol>${up.map((r) => li(r, ppS(r.d), cls(r.d))).join('')}</ol></div>
      <div class="card"><h3><span>Falling since the patch</span><span class="muted">win rate</span></h3><ol>${down.map((r) => li(r, ppS(r.d), cls(r.d))).join('')}</ol></div>
      <div class="card"><h3><span>Most banned</span><span class="muted">ban rate</span></h3><ol>${bans.map((r) => li(r, pct(r.banRate), '')).join('')}</ol></div></div>`;
  }

  function hcard(r) {
    const h = H[r.id], d = r.posterior - r.preWR;
    const moves = r.tierRange[0] !== r.tierRange[1];
    const mark = r.patch ? `<span class="mark ${r.patch.verdict}">${{ buff: '▲', nerf: '▼', mixed: '◆', rework: '?', fixes: '●' }[r.patch.verdict]}</span>` : '';
    const t = `<b>${esc(h.name)}</b> · tier ${r.tier}<br>Win rate ${pct(r.posterior)} (95%: ${pct(r.ci[0])}–${pct(r.ci[1])})<br>${ppS(d)} vs before the patch${r.patch ? ` · ${r.patch.verdict}` : ''}<br><span class=r>Pick ${pct(r.pickRate)}${r.banRate != null ? ` · ban ${pct(r.banRate)}` : ''}${moves ? `<br>Could still move: ${r.tierRange.join('–')} tier` : ''}</span>`;
    return `<a class="hcard ${matchFilter(r) ? '' : 'dim'}" href="${heroLink(r.id)}" ${tipAttr(t)}>${mark}${moves ? '<span class="move" aria-label="tier not settled">↕</span>' : ''}${avatar(h)}<div class="n">${esc(h.name)}</div><div class="w">${pct(r.posterior)}</div><div class="d ${cls(d)}">${ppS(d)}</div></a>`;
  }

  function ciBar(r, lo, hi) {
    const W = 140, Hh = 16, x = (v) => ((v - lo) / (hi - lo)) * (W - 8) + 4;
    return `<svg width="${W}" height="${Hh}" aria-hidden="true"><line x1="${x(0.5)}" x2="${x(0.5)}" y1="1" y2="${Hh - 1}" stroke="var(--axis)" stroke-dasharray="2 2"/>
      <line x1="${x(r.ci[0])}" x2="${x(r.ci[1])}" y1="${Hh / 2}" y2="${Hh / 2}" stroke="var(--pos-1)" stroke-width="6" stroke-linecap="round"/>
      <circle cx="${x(r.posterior)}" cy="${Hh / 2}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/></svg>`;
  }

  function metaTable() {
    const S = metaState.sort;
    const val = { tier: (r) => r.z, name: (r) => H[r.id].name, posterior: (r) => r.posterior, delta: (r) => r.posterior - r.preWR, pick: (r) => r.pickRate, ban: (r) => r.banRate ?? -1, games: (r) => r.preN + r.postN };
    const rs = rows().filter(matchFilter).sort((a, b) => { const x = val[S.k](a), y = val[S.k](b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * S.dir; });
    const lo = Math.min(...rows().map((r) => r.ci[0])), hi = Math.max(...rows().map((r) => r.ci[1]));
    const th = (k, l, r = '') => `<th class="sortable ${r} ${S.k === k ? 'sorted' : ''}" data-k="${k}">${l}${S.k === k ? (S.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`;
    return `<div class="tablewrap"><table class="grid" id="meta-table"><thead><tr>${th('tier', 'Tier')}${th('name', 'Hero')}${th('posterior', 'Win rate', 'r')}<th>95% interval</th>${th('delta', 'Since patch', 'r')}<th>Patch</th>${th('pick', 'Pick', 'r')}${th('ban', 'Ban', 'r')}${th('games', 'Games', 'r')}<th>Tags</th></tr></thead><tbody>${rs.map((r) => {
      const d = r.posterior - r.preWR;
      return `<tr class="row" data-id="${r.id}"><td><span class="tier ${r.tier}">${r.tier}</span></td><td>${heroCell(r.id)}</td><td class="r"><b>${pct(r.posterior)}</b></td>
        <td ${tipAttr(`${pct(r.ci[0])} – ${pct(r.ci[1])}<br><span class=r>${(r.preN + r.postN).toLocaleString()} hero-games</span>`)}>${ciBar(r, lo, hi)}</td>
        <td class="r ${cls(d)}">${ppS(d)}</td><td>${verdictPill(r.patch)}</td><td class="r">${pct(r.pickRate)}</td><td class="r">${r.banRate == null ? '–' : pct(r.banRate)}</td><td class="r">${(r.preN + r.postN).toLocaleString()}</td>
        <td>${(M.tags[r.id] || []).filter((t) => ['situational', 'archetype'].includes(t.group)).slice(0, 3).map((t) => `<span class="tag ${t.group}">${esc(t.tag)}</span>`).join('')}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function metaSituations() {
    const k = metaState.sitSort;
    const ids = rows().filter(matchFilter).map((r) => r.id).sort((a, b) => (tierOf(k, b)?.posterior ?? 0) - (tierOf(k, a)?.posterior ?? 0));
    return `<div class="tablewrap"><table class="grid heat" id="sit-table"><thead><tr><th>Hero</th>${CTX.map((c) => `<th class="r sortable ${c === k ? 'sorted' : ''}" data-c="${c}">${esc(M.contexts[c].label)}${c === k ? ' ▾' : ''}</th>`).join('')}<th>Lean</th></tr></thead><tbody>${ids.map((id) => `<tr class="row" data-id="${id}"><td>${heroCell(id)}</td>${CTX.map((c) => { const r = tierOf(c, id); if (!r) return '<td class="h">–</td>'; const d = (r.posterior - 0.5) * 100;
      return `<td class="h ${divClass(d, [1, 3, 5])}" ${tipAttr(`<b>${esc(H[id].name)}</b> · ${esc(M.contexts[c].label)}<br>${pct(r.posterior)} · tier ${r.tier}<br><span class=r>${(r.preN + r.postN).toLocaleString()} hero-games</span>`)}>${sgn(d)}</td>`; }).join('')}
      <td>${(M.tags[id] || []).filter((t) => t.group === 'situational').map((t) => `<span class="tag situational" ${tipAttr(esc(t.why))}>${esc(t.tag)}</span>`).join('')}</td></tr>`).join('')}</tbody></table></div>
      <div class="legend">Win rate vs 50% (pp): ${legendRamp(['−5', '+5'])}</div>`;
  }

  function viewMeta() {
    const S = metaState;
    view.innerHTML = `
      <div class="section-head"><div><h1>Who's strong right now</h1><p>${esc(M.contexts[ctx].label)} · ${esc(M.patch.title)}. Click any hero for their meta build, matchups and why they're rated where they are.</p></div></div>
      ${glance()}
      ${help('How are tiers worked out?', `Each hero's win rate blends four things: their record before the patch, a forecast of what the patch changes will do (tested against past patches — see Audit), any expert opinions you've added, and real games played since the patch. As more post-patch games come in, the real results take over. Tiers compare heroes to each other: S is well above the average hero, D well below. <b>↕</b> means there isn't enough data yet to be sure of the tier; <b>▲ ▼</b> mark heroes buffed or nerfed this patch.`)}
      <div class="toolbar">
        <div class="seg" id="mode-seg">${[['board', 'Tier board'], ['table', 'Table'], ['situations', 'By situation']].map(([k, l]) => `<button data-k="${k}" class="${S.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${roles.map((r) => `<button class="chip ${S.roles.has(r) ? 'on' : ''}" data-role="${r}">${esc(r[0].toUpperCase() + r.slice(1))}</button>`).join('')}
        ${[['buff', '▲ Buffed'], ['nerf', '▼ Nerfed'], ['changed', 'Changed this patch']].map(([k, l]) => `<button class="chip ${S.status === k ? 'on' : ''}" data-status="${k}">${l}</button>`).join('')}
        <input id="meta-q" type="search" placeholder="Filter by name or tag (e.g. late scaler)" value="${esc(S.q)}" style="flex:1;min-width:200px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--ink)">
      </div>
      <div id="meta-body"></div>`;
    const body = $('#meta-body');
    const draw = () => {
      if (S.mode === 'board') body.innerHTML = `<div class="board">${TIERS.map(([t, l]) => { const rs = rows().filter((r) => r.tier === t); return `<div class="tier-row ${t}"><div class="label">${t}<small>${l}</small></div><div class="cards">${rs.map(hcard).join('') || '<span class="empty">No heroes</span>'}</div></div>`; }).join('')}</div>`;
      else if (S.mode === 'table') body.innerHTML = metaTable();
      else body.innerHTML = metaSituations();
    };
    draw();
    $('#mode-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.mode = b.dataset.k; store.set('meta-mode', S.mode); viewMeta(); });
    view.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', () => { S.roles.has(b.dataset.role) ? S.roles.delete(b.dataset.role) : S.roles.add(b.dataset.role); b.classList.toggle('on'); draw(); }));
    view.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => { S.status = S.status === b.dataset.status ? null : b.dataset.status; view.querySelectorAll('[data-status]').forEach((x) => x.classList.toggle('on', x.dataset.status === S.status)); draw(); }));
    $('#meta-q').addEventListener('input', (e) => { S.q = e.target.value; draw(); });
    body.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-k]'); if (th) { const k = th.dataset.k; S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : (k === 'name' ? 1 : -1) }; draw(); return; }
      const tc = e.target.closest('th[data-c]'); if (tc) { S.sitSort = tc.dataset.c; draw(); return; }
      const tr = e.target.closest('tr.row'); if (tr && !e.target.closest('a')) location.hash = heroLink(+tr.dataset.id);
    });
  }

  // ========== HERO PAGE ==========
  const pairIdx = {};
  for (const k of ['counters', 'lane', 'synergy']) { pairIdx[k] = {}; for (const p of M[k]) { pairIdx[k][`${p.a}|${p.b}`] = p; if (k === 'synergy') pairIdx[k][`${p.b}|${p.a}`] = p; } }
  const lift = (k, a, b) => pairIdx[k][`${a}|${b}`]?.lift ?? null;
  const pairsFor = (k, id) => M.heroes.filter((h) => h.id !== id).map((h) => ({ id: h.id, p: pairIdx[k][`${id}|${h.id}`] })).filter((x) => x.p);
  let buildCtx = 'all', heroPairMode = 'counters';

  function viewHero(id, sub) {
    const h = H[id];
    if (!h) { view.innerHTML = '<p>Unknown hero. <a href="#/meta">Back to the meta</a></p>'; return; }
    const r = tierOf(ctx, id) || tierOf('all', id);
    const order = rows().map((x) => x.id), i = order.indexOf(id);
    const prev = order[(i - 1 + order.length) % order.length], next = order[(i + 1) % order.length];
    const d = r.posterior - r.preWR;
    const subs = [['build', 'Meta build'], ['overview', 'Why this rating'], ['matchups', 'Matchups'], ['synergy', 'Synergy'], ['history', 'Patch history']];
    view.innerHTML = `
      <div class="card">
        <div class="hero-head">
          ${avatar(h, 'portrait')}
          <div>
            <h1>${esc(h.name)} <span class="tier ${r.tier}" style="vertical-align:3px">${r.tier}</span></h1>
            <div class="meta">
              <span><span class="big">${pct(r.posterior)}</span> win rate</span>
              <span class="${cls(d)}" ${tipAttr('Change in win rate vs. before the patch')}>${ppS(d)} since patch</span>
              <span>#${i + 1} of ${order.length}</span>
              <span>Pick ${pct(r.pickRate)}</span>${r.banRate != null ? `<span>Ban ${pct(r.banRate)}</span>` : ''}
              ${verdictPill(r.patch)}
              ${h.type ? `<span class="tag">${esc(h.type)}</span>` : ''}
            </div>
          </div>
          <div class="hero-nav"><a href="${heroLink(prev, sub)}" ${tipAttr('Previous hero in the ranking')}>← ${esc(H[prev].name)}</a><a href="${heroLink(next, sub)}" ${tipAttr('Next hero in the ranking')}>${esc(H[next].name)} →</a></div>
        </div>
        <div class="ctx-strip" aria-label="Tier in each situation">${CTX.map((c) => { const x = tierOf(c, id); return `<button data-c="${c}" class="${c === ctx ? 'on' : ''}" ${tipAttr(`Switch every view to: ${esc(M.contexts[c].label)}`)}><span class="tier ${x?.tier || ''}">${x?.tier ?? '–'}</span>${esc(M.contexts[c].label)} · ${x ? pct(x.posterior) : '–'}</button>`; }).join('')}</div>
      </div>
      <div class="subtabs">${subs.map(([k, l]) => `<a href="${heroLink(id, k)}" class="${k === sub ? 'on' : ''}">${l}</a>`).join('')}</div>
      <div id="hero-body"></div>`;
    view.querySelectorAll('.ctx-strip button').forEach((b) => b.addEventListener('click', () => setCtx(b.dataset.c)));
    const body = $('#hero-body');
    ({ build: heroBuild, overview: heroOverview, matchups: heroMatchups, synergy: heroSynergy, history: heroHistory }[sub] || heroBuild)(body, id, r);
  }

  // ----- build -----
  const SLOT_LABEL = { weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit' };
  function itemEl(id, st, kind = '') {
    const it = M.items[id] || { name: `#${id}` };
    const tierWord = st ? `tier ${st.tier}` : '';
    const t = `<b>${esc(it.name)}</b>${it.cost ? ` · ${it.cost.toLocaleString()} souls` : ''}${it.slot ? ` · ${SLOT_LABEL[it.slot] || it.slot}` : ''}${it.active ? ' · active' : ''}` +
      (st ? `<br>Bought in <b>${pct(st.pick, 0)}</b> of games, on average at ${fmtT(st.buyS)}<br>Win rate ${pct(st.wr)} · <b>${ppS(st.lift)}</b> vs other ${tierWord} items<br><span class=r>${st.n.toLocaleString()} games · sold later in ${pct(st.sold, 0)}</span>` : '');
    return `<div class="item ${kind}" data-slot="${esc(it.slot || '')}" ${tipAttr(t)}>
      <div class="ic">${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;fallback&quot;>${esc(initials(it.name))}</span>'">` : `<span class="fallback">${esc(initials(it.name))}</span>`}</div>
      <div class="nm">${esc(it.name)}</div>${st ? `<div class="st">${pct(st.pick, 0)} · <span class="${cls(st.lift, 0.005)}">${sgn(st.lift * 100)}</span></div>` : ''}</div>`;
  }

  function buyTimeline(b, stats) {
    const ids = b.phases.flatMap((p) => p.core);
    if (!ids.length) return '<p class="empty">Not enough games for a build.</p>';
    const items = ids.map((id) => ({ id, s: stats[id] })).sort((a, b2) => a.s.buyS - b2.s.buyS);
    const maxS = Math.max(...items.map((x) => x.s.buyS)) + 120;
    const W = 620, L = 10, R = 24, icon = 36, x = (s) => L + (s / maxS) * (W - L - R);
    const rowsEnd = [];
    for (const it of items) { const px = x(it.s.buyS); let row = rowsEnd.findIndex((e) => px - e >= icon + 6); if (row < 0) { row = rowsEnd.length; rowsEnd.push(0); } rowsEnd[row] = px; it.px = px; it.row = row; }
    const Hh = rowsEnd.length * (icon + 10) + 34;
    const ticks = []; for (let m = 0; m * 60 <= maxS; m += 5) ticks.push(m);
    return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Core items placed at their average buy time">
      ${ticks.map((m) => `<line x1="${x(m * 60)}" x2="${x(m * 60)}" y1="0" y2="${Hh - 22}" stroke="var(--grid)"/><text x="${x(m * 60)}" y="${Hh - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${m}m</text>`).join('')}
      ${items.map((it) => { const im = M.items[it.id] || {}; const y = it.row * (icon + 10) + 4; const cx = Math.min(it.px, W - R - icon / 2) - icon / 2;
        return `<g ${tipAttr(`<b>${esc(im.name)}</b> · ${(im.cost || 0).toLocaleString()} souls<br>Avg buy ${fmtT(it.s.buyS)} · bought in ${pct(it.s.pick, 0)} of games<br>${ppS(it.s.lift)} vs other tier ${it.s.tier} items`)}>
          <rect x="${cx}" y="${y}" width="${icon}" height="${icon}" rx="8" fill="var(--surface-3)"/>
          ${im.img ? `<image href="${esc(im.img)}" x="${cx + 4}" y="${y + 4}" width="${icon - 8}" height="${icon - 8}"/>` : ''}
          <rect x="${cx}" y="${y + icon - 3}" width="${icon}" height="3" fill="var(--slot-${esc(im.slot)}, var(--muted))"/></g>`; }).join('')}
    </svg>
    <div class="legend"><span><i class="sw" style="background:var(--slot-weapon)"></i>Weapon</span><span><i class="sw" style="background:var(--slot-vitality)"></i>Vitality</span><span><i class="sw" style="background:var(--slot-spirit)"></i>Spirit</span><span class="muted">· position = average time bought</span></div>`;
  }

  function slotMix(b) {
    const gold = { weapon: 0, vitality: 0, spirit: 0 };
    for (const id of b.phases.flatMap((p) => p.core)) { const it = M.items[id]; if (it?.slot in gold) gold[it.slot] += it.cost || 0; }
    const tot = Object.values(gold).reduce((s, v) => s + v, 0) || 1;
    const top = Object.entries(gold).sort((a, b2) => b2[1] - a[1])[0];
    const label = top[1] / tot > 0.5 ? `${SLOT_LABEL[top[0]]}-heavy` : 'Hybrid';
    return `<h3>Build identity: ${label}</h3><div class="slotbar" role="img" aria-label="Share of core-build souls by slot">${Object.entries(gold).filter(([, v]) => v).map(([k, v]) => `<i style="width:${(v / tot) * 100}%;background:var(--slot-${k})" ${tipAttr(`${SLOT_LABEL[k]}: ${pct(v / tot, 0)} of core-build souls`)}></i>`).join('')}</div>
      <div class="legend">${Object.entries(gold).map(([k, v]) => `<span><i class="sw" style="background:var(--slot-${k})"></i>${SLOT_LABEL[k]} ${pct(v / tot, 0)}</span>`).join('')}</div>`;
  }

  function abilityGrid(o, title, note) {
    if (!o) return '';
    const seen = [];
    for (const a of o.order) if (!seen.includes(a)) seen.push(a);
    seen.sort((a, b2) => (M.items[a]?.abilityType === 'ultimate') - (M.items[b2]?.abilityType === 'ultimate'));
    const counts = {};
    const cells = o.order.map((a, i) => { counts[a] = (counts[a] || 0) + 1; return { a, k: counts[a], t: o.times[i] }; });
    return `<div class="abil"><h3>${title} <span class="muted small">${pct(o.share, 0)} of games · ${o.n.toLocaleString()} games · win rate ${ppS(o.lift)} vs other orders</span></h3>${note ? `<p class="muted small" style="margin:0 0 6px">${note}</p>` : ''}
      <table><thead><tr><th></th>${cells.map((_, i) => `<th>${i + 1}</th>`).join('')}</tr></thead><tbody>${seen.map((a) => { const it = M.items[a] || {}; return `<tr><td class="lab">${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy">` : ''}${esc(it.name || a)}</td>${cells.map((c) => c.a === a
        ? `<td class="on ${c.k === 1 ? 'u' : ''}" ${tipAttr(`Step ${cells.indexOf(c) + 1}: ${c.k === 1 ? 'unlock' : 'upgrade to tier ' + (c.k - 1)} <b>${esc(it.name)}</b>${c.t != null ? `<br><span class=r>on average at ${fmtT(c.t)}</span>` : ''}`)}>${c.k === 1 ? '●' : c.k - 1}</td>`
        : '<td class="off"></td>').join('')}</tr>`; }).join('')}</tbody></table>
      <div class="legend"><span>● unlock</span><span>1–3 upgrade tier</span><span class="muted">· hover a step for its average timing</span></div></div>`;
  }

  let itemSort = { k: 'pick', dir: -1 }, itemSlot = null;
  function heroBuild(body, id) {
    const all = M.builds[id] || {};
    if (!all[buildCtx]) buildCtx = 'all';
    const b = all[buildCtx];
    if (!b) { body.innerHTML = '<div class="card"><p class="empty">Not enough recent games to build a meta build for this hero.</p></div>'; return; }
    const stats = Object.fromEntries(b.items.map((x) => [x.id, x]));
    const phaseCard = (p) => `<div class="card phase"><h3>${p.label}</h3>
      <div class="sub">Core, in buy order</div><div class="row">${p.core.map((iid, k) => (k ? '<span class="arrow" aria-hidden="true">›</span>' : '') + itemEl(iid, stats[iid])).join('') || '<span class="empty">No clear core items</span>'}</div>
      ${p.gems.length ? `<div class="sub">★ Hidden gems <span class="muted" style="text-transform:none;letter-spacing:0">— less common, but win more than similar items</span></div><div class="row">${p.gems.map((iid) => itemEl(iid, stats[iid], 'gem')).join('')}</div>` : ''}
      ${p.traps.length ? `<div class="sub">Traps <span class="muted" style="text-transform:none;letter-spacing:0">— popular but underperform similar items</span></div><div class="row">${p.traps.map((iid) => itemEl(iid, stats[iid], 'trap')).join('')}</div>` : ''}</div>`;
    const S = itemSort;
    const val = { name: (x) => M.items[x.id]?.name || '', pick: (x) => x.pick, lift: (x) => x.lift, wr: (x) => x.wr, buy: (x) => x.buyS, cost: (x) => M.items[x.id]?.cost || 0, n: (x) => x.n };
    const list = b.items.filter((x) => !itemSlot || M.items[x.id]?.slot === itemSlot).sort((p, q) => { const a = val[S.k](p), c = val[S.k](q); return (typeof a === 'string' ? a.localeCompare(c) : a - c) * S.dir; });
    const th = (k, l, r = '') => `<th class="sortable ${r} ${S.k === k ? 'sorted' : ''}" data-k="${k}">${l}${S.k === k ? (S.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`;
    const roleLabel = { core: 'Core', gem: '★ Gem', trap: 'Trap', other: '' };
    body.innerHTML = `
      <div class="toolbar"><div class="seg" id="bctx">${[['all', 'All ranks'], ['high', 'Oracle+']].map(([k, l]) => `<button data-k="${k}" class="${buildCtx === k ? 'on' : ''}" ${all[k] ? '' : 'disabled title="Not enough high-rank games"'}>${l}</button>`).join('')}</div>
        <span class="muted small">${b.games.toLocaleString()} games since ${new Date(M.buildWindow).toLocaleDateString()} · hero win rate ${pct(b.wr)} in these games</span></div>
      ${help('How are builds picked?', `Items are judged against the hero's other items <b>of the same price tier</b>, because teams that are already winning have more souls and buy more items, which makes raw item win rates misleading. <b>Core</b> = bought in a large share of games and holds up against similar items. <b>Hidden gems</b> = bought less often but clearly win more than similar items. <b>Traps</b> = popular but clearly underperform. Numbers on each item: % of games it's bought in · win-rate difference vs. similar items (pp). Hover for timing and sample size.`)}
      <div class="build-top">
        <div class="card"><h3>Core build timeline</h3>${buyTimeline(b, stats)}</div>
        <div class="card">${slotMix(b)}
          <h3 style="margin-top:16px">At a glance</h3>
          <div class="kv"><div><span>Early core</span><b>${b.phases[0].core.length} items</b></div><div><span>Hidden gems</span><b>${b.phases.reduce((s, p) => s + p.gems.length, 0)}</b></div><div><span>Traps to avoid</span><b>${b.phases.reduce((s, p) => s + p.traps.length, 0)}</b></div><div><span>Items tracked</span><b>${b.items.length}</b></div></div></div>
      </div>
      <div class="cols3">${b.phases.map(phaseCard).join('')}</div>
      <div class="card">${abilityGrid(b.abilities?.popular, 'Ability order — most played', '')}
        ${b.abilities?.best ? `<div style="margin-top:18px">${abilityGrid(b.abilities.best, 'Alternative order — highest win rate', 'Win rates for ability orders mostly reflect how the game went (e.g. getting your ultimate early happens more when you are already ahead), so treat this as a curiosity rather than advice.')}</div>` : ''}
        ${!b.abilities ? '<p class="empty">No ability-order data for this hero yet.</p>' : ''}</div>
      <div class="card"><details ${store.get('items-open', false) ? 'open' : ''} id="items-details"><summary><b>All items for ${esc(H[id].name)}</b> <span class="muted small">(${b.items.length} items bought in ≥2% of games)</span></summary>
        <div class="toolbar" style="margin-top:10px">${['weapon', 'vitality', 'spirit'].map((s) => `<button class="chip ${itemSlot === s ? 'on' : ''}" data-slot="${s}"><i class="sw" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--slot-${s});margin-right:4px"></i>${SLOT_LABEL[s]}</button>`).join('')}</div>
        <div class="tablewrap"><table class="grid" id="items-table"><thead><tr>${th('name', 'Item')}${th('cost', 'Cost', 'r')}${th('pick', 'Bought in', 'r')}${th('buy', 'Avg buy', 'r')}${th('wr', 'Win rate', 'r')}${th('lift', 'vs similar items', 'r')}${th('n', 'Games', 'r')}<th>Verdict</th></tr></thead><tbody>
        ${list.map((x) => { const it = M.items[x.id] || {}; return `<tr><td><span class="hero">${it.img ? `<img class="avatar" src="${esc(it.img)}" alt="" loading="lazy" style="object-fit:contain;border-bottom:2px solid var(--slot-${esc(it.slot)})">` : ''}<span>${esc(it.name)}</span></span></td><td class="r">${(it.cost || 0).toLocaleString()}</td><td class="r">${pct(x.pick, 0)}</td><td class="r">${fmtT(x.buyS)}</td><td class="r">${pct(x.wr)}</td><td class="r ${cls(x.lift, 0.005)}">${ppS(x.lift)}</td><td class="r">${x.n.toLocaleString()}</td><td>${roleLabel[x.role] ? `<span class="pill ${x.role === 'trap' ? 'nerf' : x.role === 'gem' ? 'rework' : ''}">${roleLabel[x.role]}</span>` : ''}</td></tr>`; }).join('')}
        </tbody></table></div></details></div>`;
    $('#bctx', body).addEventListener('click', (e) => { const btn = e.target.closest('button'); if (!btn || btn.disabled) return; buildCtx = btn.dataset.k; heroBuild(body, id); });
    $('#items-details', body).addEventListener('toggle', (e) => store.set('items-open', e.target.open));
    body.querySelectorAll('[data-slot]').forEach((btn) => btn.addEventListener('click', () => { if (btn.classList.contains('item')) return; itemSlot = itemSlot === btn.dataset.slot ? null : btn.dataset.slot; heroBuild(body, id); }));
    $('#items-table', body).addEventListener('click', (e) => { const th2 = e.target.closest('th[data-k]'); if (!th2) return; const k = th2.dataset.k; itemSort = { k, dir: itemSort.k === k ? -itemSort.dir : (k === 'name' ? 1 : -1) }; heroBuild(body, id); });
  }

  // ----- overview -----
  function evidence(r) {
    const items = [
      ['Pre-patch record', r.evidence.prePatchPp, `${pct(r.preWR)} over ${r.preN.toLocaleString()} hero-games · weight ${pct(1 - r.wPost, 0)}`],
      ['Patch forecast', r.evidence.patchPredPp, r.patch ? `Patch-note score ${r.patch.score} → ${ppS(r.patchDelta, 2)} expected` : 'Not changed this patch'],
      ['Expert claims', r.evidence.expertPp, M.experts[r.name] ? `${M.experts[r.name].claims.length} claim(s), avg rating ${M.experts[r.name].avgRating}` : 'No claims loaded'],
      ['Post-patch games', r.evidence.postPatchPp, r.postN ? `${pct(r.postWR)} over ${r.postN.toLocaleString()} hero-games · weight ${pct(r.wPost, 0)}` : 'None yet'],
    ];
    const max = Math.max(1, ...items.map((x) => Math.abs(x[1])));
    return items.map(([l, v, why]) => { const w = (Math.abs(v) / max) * 48;
      return `<div class="ev" ${tipAttr(esc(why))}><span>${l}</span><svg viewBox="0 0 100 12" preserveAspectRatio="none"><line x1="50" x2="50" y1="0" y2="12" stroke="var(--axis)"/><rect x="${v >= 0 ? 50 : 50 - w}" y="2" width="${w}" height="8" rx="1.5" fill="${v >= 0 ? 'var(--pos-2)' : 'var(--neg-2)'}"/></svg><span class="r num ${v > 0 ? 'up' : v < 0 ? 'down' : 'muted'}">${sgn(v, 2)}pp</span></div>`; }).join('') +
      `<div class="ev total"><span>Final win rate</span><span class="muted small">50% + the bars above</span><span class="r num">${pct(r.posterior)}</span></div>`;
  }
  function situationDots(id) {
    const pts = CTX.map((c) => ({ c, r: tierOf(c, id) })).filter((x) => x.r);
    const vals = pts.flatMap((x) => x.r.ci);
    const lo = Math.min(0.45, ...vals) - 0.005, hi = Math.max(0.55, ...vals) + 0.005;
    const W = 520, L = 150, rh = 30, Hh = pts.length * rh + 26, x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - 12);
    const ticks = []; for (let t = Math.ceil(lo * 100); t <= Math.floor(hi * 100); t += 2) ticks.push(t / 100);
    return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="Win rate by situation">
      ${ticks.map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="${Hh - 20}" stroke="${t === 0.5 ? 'var(--axis)' : 'var(--grid)'}"/><text x="${x(t)}" y="${Hh - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${Math.round(t * 100)}%</text>`).join('')}
      ${pts.map((p, i) => { const y = i * rh + 14; return `<g ${tipAttr(`<b>${esc(M.contexts[p.c].label)}</b><br>${pct(p.r.posterior)} (${pct(p.r.ci[0])}–${pct(p.r.ci[1])}) · tier ${p.r.tier}`)}><rect x="0" y="${y - 13}" width="${W}" height="${rh}" fill="transparent"/>
        <text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="var(--ink)">${esc(M.contexts[p.c].label)}</text>
        <line x1="${x(p.r.ci[0])}" x2="${x(p.r.ci[1])}" y1="${y}" y2="${y}" stroke="var(--pos-1)" stroke-width="6" stroke-linecap="round"/>
        <circle cx="${x(p.r.posterior)}" cy="${y}" r="5.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/></g>`; }).join('')}</svg>`;
  }
  function heroOverview(body, id, r) {
    const pm = r.perMatch;
    body.innerHTML = `<div class="cols">
      <div class="card"><h3>Why ${esc(H[id].name)} is rated ${pct(r.posterior)}</h3><p class="muted small" style="margin-top:0">Each bar is how much that source moves the rating away from 50%. Hover for details.</p>${evidence(r)}</div>
      <div class="card"><h3>By situation</h3><p class="muted small" style="margin-top:0">Dot = win rate, bar = 95% range. Wide bars mean few games.</p>${situationDots(id)}</div></div>
      <div class="cols">
      <div class="card"><h3>Playstyle tags</h3>${(M.tags[id] || []).map((t) => `<span class="tag ${t.group}" ${tipAttr(esc(t.group + ': ' + t.why))}>${esc(t.tag)}</span>`).join('') || '<p class="empty">No tags.</p>'}
        ${M.experts[H[id].name] ? `<h3 style="margin-top:16px">Expert claims</h3>${M.experts[H[id].name].claims.map((c) => `<div class="chg"><span class="m">${sgn(c.rating, 0)}</span><div>${esc(c.note || '')}<div class="meta">${esc(c.source)} · ${esc(c.date)}${c.url ? ` · <a href="${esc(c.url)}" target="_blank" rel="noopener">source</a>` : ''}</div></div></div>`).join('')}` : ''}</div>
      <div class="card"><h3>Average match (before the patch)</h3>${pm ? `<div class="kv">
        <div><span>K / D / A</span><b>${pm.kills.toFixed(1)} / ${pm.deaths.toFixed(1)} / ${pm.assists.toFixed(1)}</b></div>
        <div><span>Hero damage</span><b>${Math.round(pm.damage).toLocaleString()}</b></div>
        <div><span>Net worth</span><b>${Math.round(pm.netWorth).toLocaleString()}</b></div>
        <div><span>Damage taken</span><b>${Math.round(pm.damageTaken).toLocaleString()}</b></div>
        <div><span>Objective damage</span><b>${Math.round(pm.objDamage).toLocaleString()}</b></div>
        <div><span>Accuracy</span><b>${pct(pm.accuracy)}</b></div>
        <div><span>Last hits</span><b>${Math.round(pm.lastHits)}</b></div></div>` : '<p class="empty">No data.</p>'}</div></div>`;
  }

  // ----- matchups / synergy -----
  function liftBars(list, fmtTip) {
    const max = Math.max(0.01, ...list.map((x) => Math.abs(x.p.lift)));
    return `<div class="bars">${list.map((x) => { const w = (Math.abs(x.p.lift) / max) * 48;
      return `<div class="b" ${tipAttr(fmtTip(x))}>${heroCell(x.id, 'build')}<svg viewBox="0 0 100 12" preserveAspectRatio="none"><line x1="50" x2="50" y1="0" y2="12" stroke="var(--axis)"/><rect x="${x.p.lift >= 0 ? 50 : 50 - w}" y="2" width="${w}" height="8" rx="1.5" fill="${x.p.lift >= 0 ? 'var(--pos-2)' : 'var(--neg-2)'}"/></svg><span class="r num ${cls(x.p.lift)}">${ppS(x.p.lift)}</span></div>`; }).join('')}</div>`;
  }
  function heroMatchups(body, id) {
    const k = heroPairMode, list = pairsFor(k, id).sort((a, b) => b.p.lift - a.p.lift);
    const fmt = (x) => `<b>${esc(H[id].name)}</b> vs <b>${esc(H[x.id].name)}</b><br>${pct(x.p.wr)} actual · ${pct(x.p.expected)} expected<br><span class=r>${x.p.n.toLocaleString()} games${k === 'lane' ? ' (same lane)' : ''}</span>`;
    body.innerHTML = `<div class="toolbar"><div class="seg" id="pm">${[['counters', 'Whole game'], ['lane', 'Laning phase']].map(([m, l]) => `<button data-k="${m}" class="${m === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="muted small">How much better or worse ${esc(H[id].name)} does against each hero than their overall strength predicts.</span></div>
      <div class="cols"><div class="card"><h3>Good against</h3>${liftBars(list.filter((x) => x.p.lift > 0).slice(0, 12), fmt) || '<p class="empty">None</p>'}</div>
      <div class="card"><h3>Struggles against</h3>${liftBars(list.filter((x) => x.p.lift < 0).reverse().slice(0, 12), fmt) || '<p class="empty">None</p>'}</div></div>`;
    $('#pm', body).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; heroPairMode = b.dataset.k; heroMatchups(body, id); });
  }
  function heroSynergy(body, id) {
    const list = pairsFor('synergy', id).sort((a, b) => b.p.lift - a.p.lift);
    const fmt = (x) => `<b>${esc(H[id].name)}</b> + <b>${esc(H[x.id].name)}</b> on the same team<br>${pct(x.p.wr)} actual · ${pct(x.p.expected)} expected<br><span class=r>${x.p.n.toLocaleString()} games</span>`;
    body.innerHTML = `<p class="muted small">How much better a team does with both heroes than their individual strengths predict.</p>
      <div class="cols"><div class="card"><h3>Best teammates</h3>${liftBars(list.filter((x) => x.p.lift > 0).slice(0, 12), fmt) || '<p class="empty">None</p>'}</div>
      <div class="card"><h3>Awkward teammates</h3>${liftBars(list.filter((x) => x.p.lift < 0).reverse().slice(0, 12), fmt) || '<p class="empty">None</p>'}</div></div>`;
  }
  function heroHistory(body, id) {
    const hist = M.heroHistory[id] || [];
    const groups = []; for (const x of hist) { let g = groups.find((y) => y.p === x.p); if (!g) groups.push(g = { p: x.p, t: x.t, lines: [] }); g.lines.push(x); }
    const mk = (d) => (d === 1 ? ['buff', '▲'] : d === -1 ? ['nerf', '▼'] : d === 0 ? ['neutral', '●'] : ['unknown', '?']);
    body.innerHTML = groups.length ? groups.map((g) => { const b = g.lines.filter((l) => l.d === 1).length, n = g.lines.filter((l) => l.d === -1).length;
      return `<div class="card"><h3>${esc(g.t)} <span class="muted small">${esc(g.p)} · ${b} buff${b === 1 ? '' : 's'}, ${n} nerf${n === 1 ? '' : 's'}</span></h3>${g.lines.map((l) => { const [c, s] = mk(l.d); return `<div class="chg"><span class="m ${c}">${s}</span><div>${esc(l.l)}</div></div>`; }).join('')}</div>`; }).join('')
      : '<div class="card"><p class="empty">No balance changes for this hero in the patches we track.</p></div>';
  }

  // ========== PATCH ==========
  function changeRow(c) {
    const k = c.direction === null ? 'unknown' : c.direction > 0 ? 'buff' : c.direction < 0 ? 'nerf' : 'neutral';
    const sym = { unknown: '?', buff: '▲', nerf: '▼', neutral: '●' }[k];
    const dw = (d) => (d === 1 ? 'buff' : d === -1 ? 'nerf' : d === 0 ? 'neutral' : 'unsure');
    let src = '';
    if (c.source === 'llm') src = `<span class="pill llm" ${tipAttr(`Rules said: ${dw(c.rules.direction)} (${esc(c.rules.reason)})`)}>LLM</span> `;
    else if (c.llm) src = c.disagree ? `<span class="pill unknown" ${tipAttr(`LLM says ${dw(c.llm.direction)}: ${esc(c.llm.reason)}`)}>LLM disagrees</span> ` : `<span class="pill" ${tipAttr(`LLM: ${esc(c.llm.reason)}`)}>LLM agrees</span> `;
    return `<div class="chg"><span class="m ${k}">${sym}</span><div>${src}${esc(c.line.replace(/^[-•*]\s*[^:]+:\s*/, ''))}<div class="meta">${esc(c.reason)} · size ${(c.magnitude * 100).toFixed(0)}% · confidence ${c.confidence}</div></div></div>`;
  }
  function viewPatch() {
    const P = M.patch, heroS = Object.values(P.summary).filter((s) => s.kind === 'hero');
    const rs = M.tiers.all.filter((r) => r.patch).sort((a, b) => b.patchDelta - a.patchDelta);
    let dumb = '<p class="empty">No hero changes in this patch.</p>';
    if (rs.length) {
      const vals = rs.flatMap((r) => [r.preWR, r.preWR + r.patchDelta, r.postWR ?? r.preWR]);
      const lo = Math.min(...vals) - 0.01, hi = Math.max(...vals) + 0.01;
      const L = 130, W = 620, rh = 32, Hh = rs.length * rh + 30, x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - 16);
      const ticks = []; for (let t = Math.ceil(lo * 100); t <= Math.floor(hi * 100); t++) ticks.push(t / 100);
      dumb = `<svg viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="Forecast vs observed win rate for changed heroes">
        ${ticks.map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="${Hh - 22}" stroke="var(--grid)"/><text x="${x(t)}" y="${Hh - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${Math.round(t * 100)}%</text>`).join('')}
        ${rs.map((r, i) => { const y = i * rh + 14, pred = r.preWR + r.patchDelta;
          return `<a href="${heroLink(r.id, 'history')}"><g ${tipAttr(`<b>${esc(r.name)}</b> · ${r.patch.verdict}<br>Before: ${pct(r.preWR)}<br>Forecast: ${pct(pred)} (${ppS(r.patchDelta, 2)})<br>So far: ${r.postWR == null ? '–' : pct(r.postWR)} over ${r.postN.toLocaleString()} hero-games`)}>
            <rect x="0" y="${y - 14}" width="${W}" height="${rh}" fill="transparent"/>
            <text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="var(--ink)">${esc(r.name)}</text>
            <line x1="${x(r.preWR)}" x2="${x(r.postWR ?? pred)}" y1="${y}" y2="${y}" stroke="var(--axis)" stroke-width="2"/>
            <circle cx="${x(r.preWR)}" cy="${y}" r="5" fill="var(--surface)" stroke="var(--muted)" stroke-width="2"/>
            <line x1="${x(pred)}" x2="${x(pred)}" y1="${y - 8}" y2="${y + 8}" stroke="var(--series-2)" stroke-width="3" stroke-linecap="round"/>
            ${r.postWR != null ? `<circle cx="${x(r.postWR)}" cy="${y}" r="5.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>` : ''}</g></a>`; }).join('')}</svg>
        <div class="legend"><span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="none" stroke="var(--muted)" stroke-width="2"/></svg> Before the patch</span><span><svg width="8" height="14"><line x1="4" x2="4" y1="2" y2="12" stroke="var(--series-2)" stroke-width="3"/></svg> Forecast</span><span><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="var(--accent)"/></svg> Games so far</span></div>`;
    }
    const groups = {}; for (const c of P.changes) (groups[c.target] ??= []).push(c);
    const order = Object.keys(groups).sort((a, b) => (P.summary[b] ? 1 : 0) - (P.summary[a] ? 1 : 0));
    view.innerHTML = `
      <div class="section-head"><div><h1>${esc(P.title)}</h1><p>${new Date(P.date).toLocaleString()}${P.link ? ` · <a href="${esc(P.link)}" target="_blank" rel="noopener">official notes</a>` : ''} · what changed, what the model expected, and what's actually happening.</p></div></div>
      <div class="stats">
        <div class="stat"><div class="l">Heroes buffed</div><div class="v up">${heroS.filter((s) => s.verdict === 'buff').length}</div></div>
        <div class="stat"><div class="l">Heroes nerfed</div><div class="v down">${heroS.filter((s) => s.verdict === 'nerf').length}</div></div>
        <div class="stat"><div class="l">Mixed / rework</div><div class="v">${heroS.filter((s) => !['buff', 'nerf'].includes(s.verdict)).length}</div></div>
        <div class="stat"><div class="l">Lines needing review</div><div class="v" style="color:var(--warn)">${P.flagged.length}</div><div class="h">of ${P.changes.length} parsed</div></div>
        <div class="stat"><div class="l">Matches since the patch</div><div class="v">${Math.round(M.contexts.all.postGames).toLocaleString()}</div></div></div>
      <div class="cols">
        <div class="card"><h3>Forecast vs reality</h3><p class="muted small" style="margin-top:0">Click a hero to see their patch history.</p>${dumb}</div>
        <div class="card"><h3>Every change, as the parser read it</h3><p class="muted small" style="margin-top:0"><span class="pill buff">▲ buff</span> <span class="pill nerf">▼ nerf</span> <span class="pill">● neutral</span> <span class="pill unknown">? unsure</span> · correct a line in <code>data/patch-overrides.json</code></p>
          <div class="changes">${order.map((t) => `<div class="grouphead">${byName[t] ? `<a class="hero" href="${heroLink(byName[t].id)}">${avatar(byName[t])}<span>${esc(t)}</span></a>` : esc(t)} ${P.summary[t] ? verdictPill(P.summary[t]) : ''}</div>${groups[t].map(changeRow).join('')}`).join('')}</div></div></div>
      <div class="card"><h3>Patch history</h3><div class="tablewrap"><table class="grid"><thead><tr><th>Date</th><th>Patch</th><th>Buffed</th><th>Nerfed</th></tr></thead><tbody>${[...M.timeline].reverse().map((p) => `<tr><td>${p.date.slice(0, 10)}</td><td>${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}</td>
        <td style="white-space:normal">${p.summary.filter((s) => s.v === 'buff').map((s) => byName[s.t] ? `<a class="tag" href="${heroLink(byName[s.t].id, 'history')}">${esc(s.t)}</a>` : `<span class="tag">${esc(s.t)}</span>`).join('')}</td>
        <td style="white-space:normal">${p.summary.filter((s) => s.v === 'nerf').map((s) => byName[s.t] ? `<a class="tag" href="${heroLink(byName[s.t].id, 'history')}">${esc(s.t)}</a>` : `<span class="tag">${esc(s.t)}</span>`).join('')}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  // ========== MATCHUPS ==========
  let pairK = 'counters', focus = null;
  function viewMatchups() {
    const order = M.tiers.all.map((r) => r.id);
    focus ??= order[0];
    const sym = pairK === 'synergy';
    const cs = 15, L = 104, T = 104, n = order.length, W = L + n * cs, Hh = T + n * cs;
    let cells = '';
    order.forEach((a, i) => order.forEach((b, j) => { if (a === b) return; const p = pairIdx[pairK][`${a}|${b}`]; if (!p) return; const c = divClass(p.lift * 100, [0.5, 1.5, 3]);
      cells += `<rect class="c" data-a="${a}" data-i="${i}" data-j="${j}" x="${L + j * cs + 1}" y="${T + i * cs + 1}" width="${cs - 2}" height="${cs - 2}" rx="2" style="fill:var(--${c.replace('cell-', '')})" ${tipAttr(`<b>${esc(H[a].name)}</b> ${sym ? '+' : 'vs'} <b>${esc(H[b].name)}</b><br>${ppS(p.lift, 2)} vs expected<br><span class=r>${pct(p.wr)} actual · ${pct(p.expected)} expected · ${p.n.toLocaleString()} games<br>Click to open ${esc(H[a].name)}</span>`)}/>`; }));
    const fi = order.indexOf(focus);
    const labels = order.map((id, i) => `<text x="${L - 6}" y="${T + i * cs + cs - 4}" text-anchor="end" font-size="11" fill="${id === focus ? 'var(--ink)' : 'var(--ink-2)'}" font-weight="${id === focus ? 700 : 400}">${esc(H[id].name)}</text>
      <text transform="translate(${L + i * cs + cs - 4},${T - 6}) rotate(-60)" font-size="11" fill="${id === focus ? 'var(--ink)' : 'var(--ink-2)'}" font-weight="${id === focus ? 700 : 400}">${esc(H[id].name)}</text>`).join('');
    const list = pairsFor(pairK, focus).sort((a, b) => b.p.lift - a.p.lift);
    const fmt = (x) => `${pct(x.p.wr)} actual · ${pct(x.p.expected)} expected<br><span class=r>${x.p.n.toLocaleString()} games</span>`;
    const names = [...new Set(M.archetypes.flatMap((a) => [a.a, a.b]))].sort();
    const arch = (a, b) => M.archetypes.find((x) => x.a === a && x.b === b);
    view.innerHTML = `
      <div class="section-head"><div><h1>Matchups &amp; synergy</h1><p>${{ counters: 'Row hero vs column hero across the whole game.', lane: 'Row hero vs column hero when they start in the same lane.', synergy: 'Row and column hero on the same team.' }[pairK]} Blue = better than their overall strength predicts. Hover a cell for the numbers, click it to open that hero.</p></div></div>
      <div class="toolbar"><div class="seg" id="pair-seg">${[['counters', 'Counters'], ['lane', 'Lane'], ['synergy', 'Synergy']].map(([k, l]) => `<button data-k="${k}" class="${k === pairK ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label class="ctx-pick">Focus <select id="pair-hero">${order.map((id) => `<option value="${id}" ${id === focus ? 'selected' : ''}>${esc(H[id].name)}</option>`).join('')}</select></label></div>
      <div class="cols" style="grid-template-columns:minmax(0,1fr) minmax(280px,380px)">
        <div class="card"><div class="heatwrap"><svg id="heat" width="${W}" height="${Hh}" role="img" aria-label="${pairK} heatmap"><rect id="hl-row" class="hl" x="${L}" width="${n * cs}" height="${cs}" y="-100"/><rect id="hl-col" class="hl" y="${T}" height="${n * cs}" width="${cs}" x="-100"/>
          <rect x="${L}" y="${T + fi * cs}" width="${n * cs}" height="${cs}" fill="none" stroke="var(--ink)" stroke-width="1.5" rx="2"/>${labels}${cells}</svg></div>
          <div class="legend">Lift: ${legendRamp(['−3pp', '+3pp'])} · heroes sorted by win rate · outlined row = focus</div></div>
        <div class="card"><h3>${heroCell(focus, 'matchups')}</h3><div class="plist" style="grid-template-columns:1fr">
          <div><b>${sym ? 'Best teammates' : 'Favoured against'}</b>${liftBars(list.slice(0, 8), fmt)}</div>
          <div><b>${sym ? 'Awkward teammates' : 'Struggles against'}</b>${liftBars(list.slice(-8).reverse(), fmt)}</div></div></div></div>
      <div class="card"><h3>Playstyle vs playstyle</h3><p class="muted small" style="margin-top:0">Average matchup lift when a hero with the row tag faces one with the column tag. Tags come from what heroes actually do in games.</p>
        <div class="tablewrap"><table class="grid heat"><thead><tr><th>Row vs column →</th>${names.map((x) => `<th class="r">${esc(x)}</th>`).join('')}</tr></thead><tbody>${names.map((a) => `<tr><td><b>${esc(a)}</b></td>${names.map((b) => { const c = arch(a, b); if (!c) return '<td class="h">–</td>'; const d = c.lift * 100; return `<td class="h ${divClass(d, [0.25, 0.6, 1.2])}" ${tipAttr(`<b>${esc(a)}</b> vs <b>${esc(b)}</b><br>${ppS(c.lift, 2)}<br><span class=r>${Math.round(c.n).toLocaleString()} hero-pair games</span>`)}>${sgn(d, 2)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></div>`;
    $('#pair-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; pairK = b.dataset.k; viewMatchups(); });
    $('#pair-hero').addEventListener('change', (e) => { focus = +e.target.value; viewMatchups(); });
    const heat = $('#heat'), hr = $('#hl-row'), hc = $('#hl-col');
    heat.addEventListener('mouseover', (e) => { const c = e.target.closest('rect.c'); if (!c) return; hr.setAttribute('y', T + c.dataset.i * cs); hc.setAttribute('x', L + c.dataset.j * cs); });
    heat.addEventListener('mouseleave', () => { hr.setAttribute('y', -100); hc.setAttribute('x', -100); });
    heat.addEventListener('click', (e) => { const c = e.target.closest('rect.c'); if (c) location.hash = heroLink(+c.dataset.a, sym ? 'synergy' : 'matchups'); });
  }

  // ========== DRAFT ==========
  const allies = new Set(store.get('allies', [])), enemies = new Set(store.get('enemies', []));
  let draftQ = '';
  function viewDraft() {
    const order = M.tiers.all.map((r) => r.id);
    const pick = (set, max, other, key) => `<div class="team">${[...set].map((id) => `<button class="chip on" data-rm="${key}" data-id="${id}">${esc(H[id].name)}<span class="x">×</span></button>`).join('') || '<span class="empty">None picked</span>'}</div>
      <div class="picker" data-set="${key}">${order.slice().sort((a, b) => H[a].name.localeCompare(H[b].name)).filter((id) => !draftQ || H[id].name.toLowerCase().includes(draftQ)).map((id) => `<button data-id="${id}" class="${set.has(id) ? 'on' : ''}" ${other.has(id) || (!set.has(id) && set.size >= max) ? 'disabled' : ''}>${avatar(H[id])}${esc(H[id].name)}</button>`).join('')}</div>`;
    const cands = order.filter((id) => !allies.has(id) && !enemies.has(id)).map((id) => {
      const r = tierOf(ctx, id) || tierOf('all', id);
      const base = (r.posterior - 0.5) * 100;
      const vs = [...enemies].map((e) => ({ e, l: (lift('counters', id, e) ?? 0) * 100 }));
      const wi = [...allies].map((a) => ({ a, l: (lift('synergy', id, a) ?? 0) * 100 }));
      const vsS = vs.reduce((s, x) => s + x.l, 0), wiS = wi.reduce((s, x) => s + x.l, 0);
      return { id, base, vsS, wiS, total: base + vsS + wiS, vs, wi };
    }).sort((a, b) => b.total - a.total).slice(0, 15);
    const max = Math.max(...cands.map((c) => Math.abs(c.base) + Math.abs(c.vsS) + Math.abs(c.wiS)), 1);
    view.innerHTML = `
      <div class="section-head"><div><h1>Draft helper</h1><p>Pick your teammates and the enemy team. Suggestions = how strong the hero is right now (${esc(M.contexts[ctx].label)}) + how well they do against each enemy + how well they pair with each teammate.</p></div>
        <div class="toolbar" style="margin:0"><input id="draft-q" type="search" placeholder="Find a hero…" value="${esc(draftQ)}" style="padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--ink)"><button class="chip" id="draft-clear">Clear all</button></div></div>
      <div class="cols"><div class="card"><h3>Your team <span class="muted small">(up to 5)</span></h3>${pick(allies, 5, enemies, 'a')}</div>
        <div class="card"><h3>Enemy team <span class="muted small">(up to 6)</span></h3>${pick(enemies, 6, allies, 'e')}</div></div>
      <div class="card"><h3>Suggested picks</h3>${enemies.size || allies.size ? '' : '<p class="muted small">No picks yet, so this is just raw strength. Add heroes above.</p>'}
        <div class="tablewrap"><table class="grid"><thead><tr><th>#</th><th>Hero</th><th class="r">Score</th><th class="r">Strength</th><th class="r">vs enemies</th><th class="r">with team</th><th>Breakdown</th><th>Biggest factors</th></tr></thead><tbody>${cands.map((c, i) => {
          let x0 = 0; const parts = [[c.base, 'var(--series-1)'], [c.vsS, 'var(--series-2)'], [c.wiS, 'var(--series-3)']].map(([v, col]) => { const w = (Math.abs(v) / max) * 100; const s = `<rect x="${x0}" width="${Math.max(w - 1, 0)}" height="10" rx="1.5" fill="${col}" ${v < 0 ? 'opacity=".35"' : ''}/>`; x0 += w; return s; }).join('');
          const keys = [...c.vs.map((v) => ({ n: 'vs ' + H[v.e].name, l: v.l })), ...c.wi.map((w) => ({ n: '+ ' + H[w.a].name, l: w.l }))].sort((a, b) => Math.abs(b.l) - Math.abs(a.l)).slice(0, 3);
          return `<tr class="row" data-id="${c.id}"><td>${i + 1}</td><td>${heroCell(c.id)}</td><td class="r"><b>${sgn(c.total, 2)}</b></td><td class="r">${sgn(c.base, 2)}</td><td class="r">${enemies.size ? sgn(c.vsS, 2) : '–'}</td><td class="r">${allies.size ? sgn(c.wiS, 2) : '–'}</td><td><svg width="160" height="10">${parts}</svg></td><td>${keys.map((k) => `<span class="tag ${k.l > 0 ? 'up' : 'down'}">${esc(k.n)} ${sgn(k.l)}</span>`).join('')}</td></tr>`; }).join('')}</tbody></table></div>
        <div class="legend"><span><i class="sw" style="background:var(--series-1)"></i>Strength (pp vs 50%)</span><span><i class="sw" style="background:var(--series-2)"></i>vs enemies</span><span><i class="sw" style="background:var(--series-3)"></i>with team</span><span class="muted">· faded = negative</span></div></div>`;
    const save = () => { store.set('allies', [...allies]); store.set('enemies', [...enemies]); };
    view.querySelectorAll('.picker').forEach((p) => p.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.disabled) return; const set = p.dataset.set === 'a' ? allies : enemies; const id = +b.dataset.id; set.has(id) ? set.delete(id) : set.add(id); save(); viewDraft(); }));
    view.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { (b.dataset.rm === 'a' ? allies : enemies).delete(+b.dataset.id); save(); viewDraft(); }));
    $('#draft-clear').addEventListener('click', () => { allies.clear(); enemies.clear(); save(); viewDraft(); });
    const q = $('#draft-q'); q.addEventListener('input', () => { draftQ = q.value.trim().toLowerCase(); const pos = q.selectionStart; viewDraft(); const q2 = $('#draft-q'); q2.focus(); q2.setSelectionRange(pos, pos); });
    view.querySelector('tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr.row'); if (tr && !e.target.closest('a')) location.hash = heroLink(+tr.dataset.id); });
  }

  // ========== AUDIT ==========
  function viewAudit() {
    const B = M.backtest, C = M.config;
    const pts = B.points.filter((p) => p.score !== 0);
    let scatter = '<p class="empty">Not enough past patches to backtest.</p>';
    if (pts.length) {
      const W = 520, Hh = 340, P = 40;
      const ext = Math.max(...pts.flatMap((p) => [Math.abs(p.predicted), Math.abs(p.observed)])) * 100 * 1.1;
      const x = (v) => P + ((v * 100 + ext) / (2 * ext)) * (W - P - 10), y = (v) => 10 + ((ext - v * 100) / (2 * ext)) * (Hh - P - 10);
      const step = ext > 6 ? 2 : 1, ticks = []; for (let t = -Math.floor(ext / step) * step; t <= ext; t += step) ticks.push(t);
      scatter = `<svg viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="Predicted vs observed win-rate change for past patches">
        ${ticks.map((t) => `<line x1="${x(t / 100)}" x2="${x(t / 100)}" y1="10" y2="${Hh - P}" stroke="var(--grid)"/><line x1="${P}" x2="${W - 10}" y1="${y(t / 100)}" y2="${y(t / 100)}" stroke="var(--grid)"/><text x="${x(t / 100)}" y="${Hh - P + 14}" text-anchor="middle" font-size="11" fill="var(--muted)">${sgn(t, 0)}</text><text x="${P - 6}" y="${y(t / 100) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${sgn(t, 0)}</text>`).join('')}
        <line x1="${x(-ext / 100)}" y1="${y(-ext / 100)}" x2="${x(ext / 100)}" y2="${y(ext / 100)}" stroke="var(--muted)" stroke-dasharray="4 4"/>
        <line x1="${x(0)}" x2="${x(0)}" y1="10" y2="${Hh - P}" stroke="var(--axis)"/><line x1="${P}" x2="${W - 10}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>
        ${pts.map((p) => `<circle cx="${x(p.predicted)}" cy="${y(p.observed)}" r="5" fill="${Math.sign(p.predicted) === Math.sign(p.observed) ? 'var(--accent)' : 'var(--neg-2)'}" stroke="var(--surface)" stroke-width="2" ${tipAttr(`<b>${esc(p.hero)}</b> · ${esc(p.patch)}<br>Predicted ${ppS(p.predicted, 2)} · actual ${ppS(p.observed, 2)}<br><span class=r>${p.nPost.toLocaleString()} post-patch hero-games</span>`)}/>`).join('')}
        <text x="${(W + P) / 2}" y="${Hh - 6}" text-anchor="middle" font-size="11" fill="var(--ink-2)">Predicted change (pp)</text>
        <text transform="translate(12,${(Hh - P) / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="var(--ink-2)">Actual change (pp)</text></svg>
        <div class="legend"><span><i class="sw" style="background:var(--accent);border-radius:50%"></i>Direction right</span><span><i class="sw" style="background:var(--neg-2);border-radius:50%"></i>Direction wrong</span><span class="muted">· dashed = perfect prediction</span></div>`;
    }
    const dw = (d) => (d === 1 ? 'buff' : d === -1 ? 'nerf' : d === 0 ? 'neutral' : 'unsure');
    const dis = [...M.disagreements, ...(M.llm?.disagreements || []).map((d) => ({ hero: d.target, type: 'parser rules vs LLM', detail: `"${d.line.replace(/^[-•*]\s*[^:]+:\s*/, '')}" — rules: ${dw(d.rules.direction)}, LLM: ${dw(d.llm.direction)} (${d.llm.reason})` }))];
    view.innerHTML = `
      <div class="section-head"><div><h1>Audit</h1><p>How much to trust this. The patch forecast is replayed on past patches and checked against what really happened.</p></div></div>
      <div class="stats">${[
        ['Correlation (r)', B.r.toFixed(2), `${B.n} past hero changes · 1 = perfect`],
        ['Direction right', B.signAccuracy == null ? '–' : pct(B.signAccuracy, 0), 'buffed heroes went up, nerfed went down'],
        ['Avg error', `${B.maeModelPp.toFixed(2)}pp`, `vs ${B.maeNaivePp.toFixed(2)}pp assuming "no change"`],
        ['Forecast scale (k)', `${(B.k * 100).toFixed(2)}pp`, B.fitted ? 'per unit of patch score, fitted' : 'fallback'],
        M.llm && M.backtestRules ? ['Rules vs rules + LLM', `r ${M.backtestRules.r.toFixed(2)} → ${B.r.toFixed(2)}`, `direction ${pct(M.backtestRules.signAccuracy, 0)} → ${pct(B.signAccuracy, 0)}`] : ['LLM pass', 'off', 'node src/build.js --llm to enable'],
      ].map(([l, v, h]) => `<div class="stat"><div class="l">${l}</div><div class="v">${v}</div><div class="h">${esc(h)}</div></div>`).join('')}</div>
      <div class="cols"><div class="card"><h3>Did the forecast call it?</h3><p class="muted small" style="margin-top:0">Each dot is one hero change from a past patch (${B.patches.map((p) => p.id).join(', ')}).</p>${scatter}</div>
        <div class="card"><h3>Where sources disagree</h3>${dis.length ? dis.map((d) => `<div class="chg"><span class="m unknown">!</span><div><b>${esc(d.hero)}</b> — ${esc(d.type)}<div class="meta">${esc(d.detail)}</div></div></div>`).join('') : '<p class="empty">Nothing right now. This lists heroes whose early post-patch results go against the forecast, expert opinions that contradict the data, and lines the parser and LLM read differently.</p>'}
          <h3 style="margin-top:16px">Expert claims</h3>${Object.keys(M.experts).length ? Object.entries(M.experts).map(([h, e]) => `<div class="chg"><span class="m">${sgn(e.avgRating, 1)}</span><div><b>${esc(h)}</b> · ${e.claims.length} claim(s) · shifts rating ${sgn(e.shift, 2)}pp</div></div>`).join('') : `<p class="empty">None loaded. Add coach/pro opinions to <code>data/experts/claims.json</code> (hero, rating −2…+2, source, date). They can move a rating by at most ±${C.expert.maxShiftPp}pp and fade over ${C.expert.halfLifeDays} days.</p>`}</div></div>
      <div class="cols"><div class="card"><h3>Data coverage</h3><div class="tablewrap"><table class="grid"><thead><tr><th>Situation</th><th class="r">Matches before patch</th><th class="r">Since patch</th></tr></thead><tbody>${CTX.map((k) => `<tr><td>${esc(M.contexts[k].label)}</td><td class="r">${Math.round(M.contexts[k].preGames).toLocaleString()}</td><td class="r">${Math.round(M.contexts[k].postGames).toLocaleString()}</td></tr>`).join('')}</tbody></table></div><p class="muted small">Before-patch window: ${esc(M.preNote)}. Rank filters only count matches with rank data for both teams.</p></div>
        <div class="card"><h3>Model assumptions</h3><ul class="small" style="padding-left:18px;margin:0;color:var(--ink-2)">
          <li>Unchanged heroes' pre-patch record counts as <b>${C.priorGames.unchanged.toLocaleString()}</b> games of evidence; patched heroes <b>${C.priorGames.changed.toLocaleString()}</b>, so new games take over faster.</li>
          <li>Win rates are shrunk toward 50% with <b>${C.shrinkGames}</b> pseudo-games; matchup lifts toward 0 with <b>${C.pairShrinkGames}</b>.</li>
          <li>Tiers: S ≥ +1.25σ, A ≥ +0.5σ, B ≥ −0.5σ, C ≥ −1.25σ from the average hero.</li>
          <li>Builds: items compared with same-tier items; core needs ${Object.entries(M.buildConfig.core).map(([t, v]) => `T${t} ${pct(v, 0)}`).join(', ')} pick rate; gems ≥ ${ppS(M.buildConfig.gemMinLift)}; traps ≤ ${ppS(M.buildConfig.trapMaxLift)}.</li>
          <li>All knobs live in <code>config.js</code> and <code>src/builds.js</code>.</li></ul></div></div>`;
  }

  render();
})();
