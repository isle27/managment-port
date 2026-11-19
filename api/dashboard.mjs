import { createHash, timingSafeEqual } from 'node:crypto';
import { createWorker } from '../portfolio-manager/worker.js';
import { loadAssets } from '../portfolio-manager/asset-manifest.mjs';

const worker = createWorker(await loadAssets());
const digest = value => createHash('sha256').update(value).digest();
const privateHeaders = { 'Cache-Control': 'no-store' };

export default {
  async fetch(request) {
    const password = process.env.ADMIN_PASSWORD;
    if (!password) {
      return new Response('Set the server-side ADMIN_PASSWORD environment variable.', {
        status: 503, headers: privateHeaders
      });
    }

    const authorization = request.headers.get('Authorization') || '';
    const expected = 'Basic ' + Buffer.from('admin:' + password).toString('base64');
    if (!timingSafeEqual(digest(authorization), digest(expected))) {
      return new Response('Portfolio Studio sign-in required.', {
        status: 401,
        headers: { ...privateHeaders, 'WWW-Authenticate': 'Basic realm="Portfolio Studio", charset="UTF-8"' }
      });
    }

    const incoming = new URL(request.url);
    const route = incoming.searchParams.get('route') || incoming.pathname;
    if (!/^(?:\/|\/app\.js|\/style\.css|\/studio-icon\.png|\/api\/projects(?:\/[1-9][0-9]{0,9}(?:\/move)?)?)$/.test(route)) {
      return new Response('Page not found.', { status: 404, headers: privateHeaders });
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
    return new Response(result.body, { status: result.status, headers: responseHeaders });
  }
};
