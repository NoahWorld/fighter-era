'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = __dirname;
const portText = process.env.PORT || '4173';
if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
  throw new Error(`Invalid PORT: ${portText}. Expected an integer between 1 and 65535.`);
}
const port = Number(portText);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const publicFiles = new Set(['index.html', 'style.css', 'src/browser.js', 'src/engine.js', 'src/renderer.js']);

const server = http.createServer(async (req, res) => {
  const send = (code, message) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : message); };
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); send(405, 'Method not allowed'); return; }
  let requested;
  try { requested = decodeURIComponent(req.url.split('?')[0]); }
  catch (error) { console.warn('[HTTP] Invalid URL encoding', req.url, error.message); send(400, 'Invalid URL encoding'); return; }
  if (!requested.startsWith('/') || requested.includes('\0') || requested.includes('\\') || requested.split('/').includes('..')) { send(403, 'Forbidden path'); return; }
  const relative = requested === '/' ? 'index.html' : requested.slice(1);
  if (!publicFiles.has(relative)) { send(404, 'Not found'); return; }
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { send(403, 'Forbidden path'); return; }
  try {
    const resolved = await fs.realpath(file);
    if (!resolved.startsWith(root + path.sep)) { send(403, 'Forbidden path'); return; }
    const content = await fs.readFile(resolved);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Content-Length': content.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error('[HTTP] File read failed', { file, code: error.code, message: error.message });
    send(error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not found' : 'Static file read failed; see server logs.');
  }
});
server.on('error', error => { console.error(`[Neon Wing] Cannot listen on http://127.0.0.1:${port}`, error); throw error; });
server.listen(port, '127.0.0.1', () => console.log(`Neon Wing ready: http://127.0.0.1:${port}`));
