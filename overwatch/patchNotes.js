// Reads Blizzard's Overwatch patch-notes pages and turns hero changes into the same structured,
// signed changes the Deadlock tool uses (src/patchParser.js does the buff/nerf reading).
import cfg from './config.js';
import { fetchCached } from './fetch.js';
import { parsePatch, summarize, htmlToText } from '../src/patchParser.js';

export const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (html) => htmlToText(html).replace(/\s+/g, ' ').trim();

function monthUrls(now, n) {
  const urls = [`${cfg.blizzard}/`];
  for (let i = 1; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    urls.push(`${cfg.blizzard}/live/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/`);
  }
  return urls;
}

// One page → [{ title, date, lines: [{hero, ability, text}], dev: {heroKey: text}, sections }]
function parsePage(html, heroByNorm) {
  const blocks = html.split(/class="PatchNotes-patch[ "]/).slice(1);
  const out = [];
  for (const b of blocks) {
    const title = clean(b.match(/PatchNotes-patchTitle"[^>]*>([\s\S]*?)<\//)?.[1] || '');
    const dateTxt = clean(b.match(/PatchNotes-date"[^>]*>([\s\S]*?)<\//)?.[1] || '');
    if (!title) continue;
    const date = new Date(`${dateTxt} 18:00 UTC`);
    const lines = [], dev = {};
    // "Tank"/"Damage"/"Support" headings are sub-sections; the parent (e.g. "Stadium Updates") decides
    // whether lines count. Stadium has its own balance, and hit-volume/audio sections aren't power changes.
    const ROLE_SUB = /^(tank|damage|support|hero reworks|new hero)$/i;
    const SKIP = /stadium|hit volume|audio|sound|visual|cosmetic|ui\b/i;
    let parent = '', hero = null, ability = null;
    const re = /class="(PatchNotes-sectionTitle|PatchNotesHeroUpdate-name|PatchNotesAbilityUpdate-name|PatchNotesGeneralUpdate-title|PatchNotes-dev(?: PatchNotesHeroUpdate-dev)?|PatchNotesHeroUpdate-dev)"[^>]*>([\s\S]*?)<\/(?:h\d|div|span)>|<li[^>]*>([\s\S]*?)<\/li>/g;
    let m;
    while ((m = re.exec(b))) {
      const [, cls, inner, li] = m;
      if (cls === 'PatchNotes-sectionTitle') { const t = clean(inner); if (!ROLE_SUB.test(t)) parent = t; hero = null; ability = null; }
      else if (cls === 'PatchNotesHeroUpdate-name') { const n = clean(inner); hero = heroByNorm[norm(n)] || { key: null, name: n }; ability = null; }
      else if (cls === 'PatchNotesAbilityUpdate-name') ability = clean(inner);
      else if (cls === 'PatchNotesGeneralUpdate-title') { hero = null; ability = null; }
      else if (cls && cls.endsWith('-dev')) { if (hero?.key && !SKIP.test(parent)) dev[hero.key] = clean(inner).replace(/^Developer Comments?:\s*/i, ''); }
      else if (li && hero && !SKIP.test(parent)) {
        const text = clean(li);
        if (text) lines.push({ hero, ability, text });
      }
    }
    out.push({ title, date, lines, dev });
  }
  return out;
}

export async function loadPatches({ heroes, offline, now = new Date() }) {
  const heroByNorm = {};
  for (const h of heroes) { heroByNorm[norm(h.name)] = h; heroByNorm[norm(h.key)] = h; }
  const pages = [];
  for (const url of monthUrls(now, cfg.patchMonths)) {
    try { pages.push(await fetchCached(url, { as: 'html', offline, ttlHours: url.endsWith('patch-notes/') ? 2 : 24 * 14 })); } catch { /* month may not exist yet */ }
  }
  const seen = new Set(), patches = [];
  for (const html of pages) for (const p of parsePage(html, heroByNorm)) {
    if (seen.has(p.title)) continue; seen.add(p.title);
    const id = isNaN(p.date) ? p.title : p.date.toISOString().slice(0, 10);
    // Feed the shared parser one "- key: Ability - change" line per bullet.
    const text = p.lines.map((l) => `- ${l.hero.key || l.hero.name}: ${l.ability ? l.ability + ' - ' : ''}${l.text}`).join('\n');
    const changes = parsePatch(text, { heroNames: heroes.map((h) => h.key), itemNames: [], patchId: id })
      .map((c) => ({ ...c, kind: heroes.some((h) => h.key === c.target) ? 'hero' : 'general' }));
    if (!changes.some((c) => c.kind === 'hero')) continue; // events/cosmetics/bug-fix-only posts
    patches.push({ id, title: p.title, date: isNaN(p.date) ? null : p.date.toISOString(), changes, summary: summarize(changes), dev: p.dev });
  }
  patches.sort((a, b) => new Date(a.date) - new Date(b.date));
  return patches;
}
