#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');

const [, , artifactPath, limitArg = '131072', portArg = '8099'] = process.argv;

if (!artifactPath) {
  console.error('Usage: node scripts/interrupted-firmware-server.js <artifact.bin> [bytes-to-send] [port]');
  process.exit(1);
}

const resolvedPath = path.resolve(artifactPath);
const bytesToSend = Number.parseInt(limitArg, 10);
const port = Number.parseInt(portArg, 10);

if (!Number.isFinite(bytesToSend) || bytesToSend <= 0) {
  console.error('bytes-to-send must be a positive integer');
  process.exit(1);
}

if (!Number.isFinite(port) || port <= 0 || port > 65535) {
  console.error('port must be a valid TCP port');
  process.exit(1);
}

const stat = fs.statSync(resolvedPath);

const server = http.createServer((req, res) => {
  console.log(`Serving interrupted artifact for ${req.method} ${req.url}`);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': stat.size,
    Connection: 'close',
  });

  const stream = fs.createReadStream(resolvedPath, {
    start: 0,
    end: Math.min(bytesToSend, stat.size) - 1,
  });

  stream.pipe(res, { end: false });
  stream.on('end', () => {
    console.log(`Sent ${Math.min(bytesToSend, stat.size)} of ${stat.size} bytes, closing connection`);
    res.destroy();
    server.close();
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Interrupted firmware server listening on http://0.0.0.0:${port}/interrupted.bin`);
  console.log(`Artifact: ${resolvedPath}`);
  console.log(`Advertised size: ${stat.size}, bytes before disconnect: ${Math.min(bytesToSend, stat.size)}`);
});
