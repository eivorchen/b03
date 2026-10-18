import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.argv[2] || '.');
const port = Number(process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.json':'application/json; charset=utf-8', '.ttf':'font/ttf', '.txt':'text/plain; charset=utf-8' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    // A local project subpath exercises the same relative resource URLs as Pages.
    if (path.startsWith('/b03/')) path = path.slice(4);
    const pieces = path.split('/');
    if (pieces.some(p => p.startsWith('.') || ['node_modules','tests','docs','scripts'].includes(p))) throw new Error('forbidden');
    let file = resolve(root, '.' + path);
    if (file !== root && !file.startsWith(root + sep)) throw new Error('forbidden');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'text/plain; charset=utf-8', 'Cache-Control':'no-store' });
    res.end(bytes);
  } catch {
    res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`B03: http://127.0.0.1:${port}/b03/ (${root})`));
