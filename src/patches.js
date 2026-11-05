// Builds a clean timeline of balance patches from the API's patch feed (Steam + forum).
import { get } from './api.js';
import { parsePatch, summarize, applyOverrides } from './patchParser.js';

function effectiveDate(p) {
  // Forum threads were sometimes posted in bulk weeks later; trust the date in the title when it disagrees.
  const m = p.title.match(/(\d{2})-(\d{2})-(\d{4})/);
  const pub = new Date(p.pub_date);
  if (m) {
    const titled = new Date(`${m[3]}-${m[1]}-${m[2]}T20:00:00Z`);
    if (Math.abs(titled - pub) > 2 * 864e5) return titled;
  }
  return pub;
}

// parse → optional LLM pass → manual overrides (always last, so a human has the final say) → summary
async function analyse(text, { heroNames, itemNames, overrides, patchId, title, classifier }) {
  let changes = parsePatch(text, { heroNames, itemNames, patchId });
  if (classifier) changes = await classifier.classify(changes, { patchTitle: title });
  changes = applyOverrides(changes, overrides);
  return { changes, summary: summarize(changes) };
}

export async function loadPatchTimeline({ heroNames, itemNames, overrides, offline, classifier }) {
  const feed = await get('/v2/patches', {}, { offline, ttlHours: 1 });
  const candidates = [];
  for (const p of feed) {
    const date = effectiveDate(p);
    const id = date.toISOString().slice(0, 10);
    // Cheap rules-only pass first to skip news/event posts before spending LLM calls.
    const heroLines = parsePatch(p.content, { heroNames, itemNames, patchId: id }).filter((c) => c.kind === 'hero');
    if (heroLines.length < 3) continue;
    candidates.push({ p, date, id });
  }
  candidates.sort((a, b) => a.date - b.date);
  const out = [];
  for (const { p, date, id } of candidates) {
    const prev = out[out.length - 1];
    const title = p.title.trim();
    const { changes, summary } = await analyse(p.content, { heroNames, itemNames, overrides, patchId: id, title, classifier });
    // Drop duplicates (same notes posted on Steam and forum within ~2 days).
    if (prev && Math.abs(date - new Date(prev.date)) < 2 * 864e5 && Object.keys(prev.summary).sort().join() === Object.keys(summary).sort().join()) continue;
    out.push({ id, title, date: date.toISOString(), link: p.link, source: p.source, changes, summary });
  }
  return out;
}

// For a user-supplied patch (pasted text), wrap it in the same shape.
export async function customPatch(text, { heroNames, itemNames, overrides, date, title, classifier }) {
  const id = `custom-${date.toISOString().slice(0, 10)}`;
  const t = title || 'Custom patch notes';
  const { changes, summary } = await analyse(text, { heroNames, itemNames, overrides, patchId: id, title: t, classifier });
  return { id, title: t, date: date.toISOString(), link: null, source: 'file', changes, summary, custom: true };
}
