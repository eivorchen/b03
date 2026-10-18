import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DEFAULT_CONFIG } from '../src/config.js';
const output = new URL('../dist/', import.meta.url);
const source = new URL('../', import.meta.url);
const files = ['index.html', 'styles.css', ...(await readdir(new URL('src/', source))).filter(f => f.endsWith('.js')).map(f => `src/${f}`), 'assets/fonts/rajdhani-semibold.ttf', 'assets/fonts/OFL-Rajdhani.txt'];
const content = await Promise.all(files.map(f => readFile(new URL(f, source))));
const hash = createHash('sha256');
files.forEach((file, index) => hash.update(file).update(content[index]));
const revision = hash.digest('hex').slice(0,12);
await mkdir(new URL('src/', output), { recursive:true });
await mkdir(new URL('assets/fonts/', output), { recursive:true });
for (let i=0; i<files.length; i++) {
  let value = content[i];
  // Binary fonts stay byte-for-byte intact; all referenced assets share a release token.
  if (/\.(?:html|css|js)$/.test(files[i])) {
    value = value.toString('utf8').replace(/(\.\/?[^'"\s]+\.(?:js|css|ttf))(?:\?v=[^'"\s]+)?(?=['"])/g, `$1?v=${revision}`);
  }
  await writeFile(new URL(files[i], output), value);
}
await writeFile(new URL('.nojekyll', output), '');
await writeFile(new URL('release.json', output), JSON.stringify({version:DEFAULT_CONFIG.version,revision,files}, null, 2)+'\n');
console.log(`Static build: dist/ · ${DEFAULT_CONFIG.version} · ${revision} · ${files.length} files`);
