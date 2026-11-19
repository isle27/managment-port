import './build.mjs';
import { createServer } from 'node:http';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sharedEnv = fileURLToPath(new URL('../../SE-Portfolio/.env', import.meta.url));
const envFile = process.env.PORTFOLIO_ENV_FILE ||
  (existsSync('.env') ? '.env' : existsSync(sharedEnv) ? sharedEnv : undefined);
try {
  loadEnvFile(envFile);
} catch (error) {
  if (envFile || error.code !== 'ENOENT') throw error;
}
const { default: worker } = await import('./dist/server/index.js');
const port = Number(process.env.PORT || 3010);
createServer(async (req, res) => {
  try {
    const options = { method: req.method, headers: req.headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') Object.assign(options, { body: req, duplex: 'half' });
    const host = req.headers.host;
    if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) {
      res.writeHead(400).end('Use the local dashboard URL printed in the terminal.');
      return;
    }
    const request = new Request('http://' + host + req.url, options);
    const result = await worker.fetch(request, { LOCAL_PREVIEW: true, DATABASE_URL: process.env.DATABASE_URL });
    res.writeHead(result.status, { ...Object.fromEntries(result.headers), 'Cache-Control': 'no-store' });
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    res.writeHead(500).end();
  }
}).listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port));
