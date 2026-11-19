import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createWorker } from '../portfolio-manager/worker.js';
import { loadAssets } from '../portfolio-manager/asset-manifest.mjs';

const worker = createWorker(await loadAssets());
const privateHeaders = { 'Cache-Control': 'no-store' };
const cookieName = '__Host-portfolio-studio';
const cookieAttributes = 'Path=/; Secure; HttpOnly; SameSite=Strict';
const sessionLength = 8 * 60 * 60;

const digest = value => createHash('sha256').update(value).digest();
const equal = (first, second) => timingSafeEqual(digest(first), digest(second));
const sign = (value, password) =>
  createHmac('sha256', password).update('portfolio-studio-session:' + value).digest('base64url');

function hasSession(request, password) {
  const cookie = request.headers.get('Cookie')?.split(';').map(value => value.trim())
    .find(value => value.startsWith(cookieName + '='));
  const token = cookie?.slice(cookieName.length + 1);
  const match = token?.match(/^(\d{10})\.([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/);
  return Boolean(match && Number(match[1]) > Math.floor(Date.now() / 1000) &&
    equal(match[3], sign(match[1] + '.' + match[2], password)));
}

function redirect(location, cookie) {
  const headers = { ...privateHeaders, Location: location };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 303, headers });
}

function loginPage(status = 200, error = '') {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Portfolio Studio</title><link rel="icon" href="/studio-icon.png"><link rel="stylesheet" href="/style.css"></head>
<body class="sign-in"><main><section class="sign-in-panel" aria-labelledby="sign-in-title">
<p class="kicker">Portfolio Studio</p><h1 id="sign-in-title">Sign in</h1>
<form action="/login" method="post">
<label>Username<input name="username" autocomplete="username" value="admin" required></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required autofocus></label>
${error ? '<p class="error" role="alert">' + error + '</p>' : ''}
<button class="primary" type="submit">Sign in</button>
</form></section></main></body></html>`, {
    status, headers: {
      ...privateHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    }
  });
}

async function authenticate(request, origin, password, signedIn) {
  if (request.method === 'GET') return signedIn ? redirect('/') : loginPage();
  if (request.method !== 'POST') return methodNotAllowed('GET, POST');
  if (request.headers.get('Origin') !== origin) return new Response(null, { status: 403, headers: privateHeaders });
  const form = new URLSearchParams(await request.text());
  if (form.get('username') !== 'admin' || !equal(form.get('password') || '', password)) {
    return loginPage(401, 'The username or password is incorrect.');
  }
  const expires = Math.floor(Date.now() / 1000) + sessionLength;
  const session = expires + '.' + randomBytes(16).toString('hex');
  return redirect('/', cookieName + '=' + session + '.' + sign(session, password) +
    '; ' + cookieAttributes + '; Max-Age=' + sessionLength);
}

function methodNotAllowed(allow) {
  return new Response(null, { status: 405, headers: { ...privateHeaders, Allow: allow } });
}

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const route = incoming.searchParams.get('route') || incoming.pathname;
    if (!/^(?:\/|\/login|\/logout|\/app\.js|\/style\.css|\/studio-icon\.png|\/api\/projects(?:\/[1-9][0-9]{0,9}(?:\/move)?)?)$/.test(route)) {
      return new Response('Page not found.', { status: 404, headers: privateHeaders });
    }
    if ((route === '/style.css' || route === '/studio-icon.png') && ['GET', 'HEAD'].includes(request.method)) {
      return worker.fetch(new Request(new URL(route, incoming.origin), { method: request.method }));
    }

    const password = process.env.ADMIN_PASSWORD;
    if (!password) {
      return new Response('Set the server-side ADMIN_PASSWORD environment variable.', {
        status: 503, headers: privateHeaders
      });
    }
    const signedIn = hasSession(request, password);
    if (route === '/login') return authenticate(request, incoming.origin, password, signedIn);
    if (route === '/logout') {
      if (request.method !== 'POST') return methodNotAllowed('POST');
      if (request.headers.get('Origin') !== incoming.origin) return new Response(null, { status: 403, headers: privateHeaders });
      return redirect('/login', cookieName + '=; ' + cookieAttributes + '; Max-Age=0');
    }
    if (!signedIn) {
      if (route === '/') return redirect('/login');
      return Response.json({ error: 'Please sign in to Portfolio Studio.', signIn: true }, {
        status: 401, headers: privateHeaders
      });
    }

    const headers = new Headers(request.headers);
    headers.delete('authorization');
    headers.set('oai-authenticated-user-id', 'vercel-admin');
    const forwarded = new Request(new URL(route, incoming.origin), {
      method: request.method, headers, body: request.body, duplex: 'half'
    });
    const result = await worker.fetch(forwarded, { DATABASE_URL: process.env.DATABASE_URL });
    const responseHeaders = new Headers(result.headers);
    responseHeaders.set('Cache-Control', 'no-store');
    if (route === '/' && request.method === 'GET') {
      const html = (await result.text()).replace('<!-- session controls -->',
        '<form action="/logout" method="post"><button type="submit">Sign out</button></form>');
      return new Response(html, { status: result.status, headers: responseHeaders });
    }
    return new Response(result.body, { status: result.status, headers: responseHeaders });
  }
};
