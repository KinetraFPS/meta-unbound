#!/usr/bin/env node
// One-command local copy: `npm start` or double-click start-local.cmd.
// Rebuilds the dashboards if they're missing or more than a day old, starts the local server
// (which keeps your personal Overwatch matchups fresh on its own) and opens the site.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(base);
const DAY = 864e5;
const fresh = (f) => fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < DAY;
const run = (label, args) => {
  console.log(`\n▸ ${label}…`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) console.log(`  (${label} failed — using the previous copy if there is one)`);
};

if (!fresh('dist/data.js')) run('Updating Deadlock data', ['src/build.js']);
// The local server fetches matchups itself, so skip that step here to open the site sooner.
if (!fresh('dist-ow/data.js')) run('Updating Overwatch data', ['overwatch/build.js', '--no-counters']);

const port = +process.env.PORT || 5178;
const url = `http://localhost:${port}/overwatch/`;
const open = () => {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { console.log(`Open ${url} in your browser.`); }
};
console.log('\n▸ Starting local server (keep this window open; close it to stop)…');
await import('./serve.js');
if (!process.env.NO_OPEN) setTimeout(open, 800);
