const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || 'dist');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function resolvePath(urlPath) {
  const relativePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const fullPath = path.resolve(root, relativePath);
  return fullPath.startsWith(root) ? fullPath : null;
}

function sendFile(filePath, res) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Server error');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const requestedPath = resolvePath(urlPath);

  if (!requestedPath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(requestedPath, (statError, stats) => {
    if (!statError && stats.isFile()) {
      sendFile(requestedPath, res);
      return;
    }

    sendFile(path.join(root, 'index.html'), res);
  });
});

server.listen(port, host, () => {
  console.log(`Listening on http://${host}:${port}`);
  console.log(`Serving ${root}`);
});
