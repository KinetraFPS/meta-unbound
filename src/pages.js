// Copies the built dashboard (dist/) into docs/ so GitHub Pages can serve it.
// Usage: node src/build.js && node src/pages.js   (or: npm run pages), then commit + push docs/.
import fs from 'node:fs';
import path from 'node:path';

if (!fs.existsSync('dist/data.js')) { console.error('✖ dist/ is empty — run node src/build.js first'); process.exit(1); }
fs.rmSync('docs', { recursive: true, force: true });
fs.mkdirSync('docs');
for (const f of fs.readdirSync('dist')) fs.copyFileSync(path.join('dist', f), path.join('docs', f));
if (fs.existsSync('dist-ow/data.js')) { fs.mkdirSync('docs/overwatch'); for (const f of fs.readdirSync('dist-ow')) fs.copyFileSync(path.join('dist-ow', f), path.join('docs/overwatch', f)); }
fs.writeFileSync('docs/.nojekyll', ''); // serve files as-is
console.log('✔ Copied dashboard to docs/ — commit and push to update the GitHub Pages site');
