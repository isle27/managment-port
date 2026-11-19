import { readFile } from 'node:fs/promises';

const entries = [
  ['/', 'index.html', 'text/html'],
  ['/app.js', 'app.js', 'text/javascript'],
  ['/style.css', 'style.css', 'text/css'],
  ['/studio-icon.png', 'studio-icon.png', 'image/png']
];

export async function loadAssets() {
  return Object.fromEntries(await Promise.all(entries.map(async ([route, file, type]) => {
    const binary = type.startsWith('image/');
    const body = await readFile(new URL(file, import.meta.url), binary ? 'base64' : 'utf8');
    return [route, { type: binary ? type : type + '; charset=utf-8', body, binary }];
  })));
}
