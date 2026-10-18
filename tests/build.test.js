import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';

test('static release resolves every entry and module under an arbitrary project subpath with one release token', async () => {
  execFileSync(process.execPath, ['scripts/build.js'], { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
  const output=new URL('../dist/',import.meta.url);
  const release=JSON.parse(await readFile(new URL('release.json',output),'utf8'));
  assert.match(release.revision,/^[a-f0-9]{12}$/);
  assert.equal(release.version,'0.4.0');
  const base=new URL('https://example.invalid/any-repository/');
  for(const file of release.files) {
    if(file.endsWith('.ttf')) {
      assert.deepEqual(await readFile(new URL(file,output)), await readFile(new URL(`../${file}`,import.meta.url)), 'The bundled font must remain intact');
      continue;
    }
    const content=await readFile(new URL(file,output),'utf8');
    assert.doesNotMatch(content,/(?:src|href)=["'](?:https?:|\/Users\/|\/src\/)/);
    const imports=[...content.matchAll(/(?:from\s+|import\(|url\(|(?:src|href)=)["']([^"']+\.(?:js|css|ttf)(?:\?[^"']*)?)["']/g)].map(match=>match[1]);
    for(const reference of imports) {
      const url=new URL(reference,new URL(file,base));
      assert.ok(url.pathname.startsWith('/any-repository/'),`${file}: ${reference} escapes the project path`);
      assert.equal(url.searchParams.get('v'),release.revision,`${file}: stale asset token`);
      const local=url.pathname.slice('/any-repository/'.length);
      assert.ok(release.files.includes(local),`unpublished asset ${local}`);
      assert.ok((await stat(new URL(local,output))).isFile());
    }
  }
  assert.ok(release.files.includes('assets/fonts/rajdhani-semibold.ttf'));
  assert.match(await readFile(new URL('assets/fonts/OFL-Rajdhani.txt',output),'utf8'), /SIL OPEN FONT LICENSE/);
  assert.ok((await stat(new URL('.nojekyll',output))).isFile());
});
