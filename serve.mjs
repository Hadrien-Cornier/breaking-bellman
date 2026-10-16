// A tiny static server for dist/ (no dependencies). npm start builds the page, then runs this.
// It listens on 127.0.0.1 only, so other computers on your network cannot open it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), 'dist');
const port = Number(process.env.PORT) || 8642;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.join(root, url === '/' ? 'breaking-bellman.html' : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Breaking Bellman: open http://localhost:${port} (Ctrl+C to stop)`));
