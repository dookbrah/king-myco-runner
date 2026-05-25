const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..', 'public');
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const resolvePublicPath = (pathname) => {
  if (pathname === '/' || pathname === '/game/myco-quest') {
    return path.join(root, 'myco-quest-game.html');
  }
  const normalized = path.normalize(pathname.replace(/^\/+/, ''));
  const resolved = path.join(root, normalized);
  if (!resolved.startsWith(root)) {
    return null;
  }
  return resolved;
};

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const targetPath = resolvePublicPath(requestUrl.pathname);

  if (!targetPath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  fs.readFile(targetPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(targetPath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`Myco Quest preview server listening on ${port}`);
});
