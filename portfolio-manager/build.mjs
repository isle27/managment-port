import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadAssets } from './asset-manifest.mjs';

const assets = await loadAssets();
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await mkdir('dist/vercel-static', { recursive: true });
await writeFile('dist/vercel-static/robots.txt', 'User-agent: *\nDisallow: /\n');
const worker = await readFile('worker.js', 'utf8');
await writeFile('dist/server/index.js', worker + '\nexport default createWorker(' + JSON.stringify(assets) + ');\n');
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
