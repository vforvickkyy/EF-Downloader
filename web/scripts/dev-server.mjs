// Local server for development and tests: serves public/ and the API.
//   DATABASE_URL=postgres://... APP_KEY=... node scripts/dev-server.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../lib/router.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.argv[2] || process.env.PORT || 3000);
// Same security headers as production (vercel.json).
const vercel = JSON.parse(fs.readFileSync(path.join(root, '..', 'vercel.json'), 'utf8'));
const security = Object.fromEntries(vercel.headers[0].headers.filter((x) => x.key !== 'Strict-Transport-Security').map((x) => [x.key, x.value]));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = `http://${req.headers.host}${req.url}`;
  if (req.url.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const response = await handle(request);
    res.writeHead(response.status, { ...security, ...Object.fromEntries(response.headers) });
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  let file = path.join(root, decodeURIComponent(new URL(url).pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { ...security, 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}`));
