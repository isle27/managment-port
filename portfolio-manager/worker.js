const table = 'public.portfolio_projects';
const columns = 'id, title, description, image, technologies, github, live, featured, published, show_on_se, show_on_ai, ai_category, ai_overview, ai_outcomes, sort_order';
const json = (data, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store' }
});
const failure = (error, status) => json({ error }, status);

function database(connection) {
  const url = new URL(connection);
  if (!['postgresql:', 'postgres:'].includes(url.protocol)
      || !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(url.hostname)) {
    throw new Error('Invalid Neon connection');
  }
  const endpoint = 'https://' + url.hostname.replace(/^[^.]+\./, 'api.') + '/sql';
  return async (query, params = []) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'Neon-Connection-String': connection,
        'Neon-Raw-Text-Output': 'true',
        'Neon-Array-Mode': 'true'
      },
      body: JSON.stringify({ query, params }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Neon query failed');
    return (await response.json()).rows.map(([value]) => JSON.parse(value));
  };
}

function fields(body) {
  const flags = ['featured', 'published', 'show_on_se', 'show_on_ai'];
  if (!body || flags.some(key => typeof body[key] !== 'boolean')) return null;
  const values = ['title', 'description', 'image', 'github', 'live'].map(key =>
    typeof body[key] === 'string' ? body[key].trim() : null);
  if (values.some((value, index) => value === null || value.length > [200, 4000, 700000, 2048, 2048][index]) || !values[0]) return null;
  const tags = body.technologies;
  if (!Array.isArray(tags) || tags.length > 30 || tags.some(tag => typeof tag !== 'string' || tag.length > 80)) return null;
  for (const [index, value] of values.entries()) {
    if (index < 2 || !value) continue;
    if (index === 2 && /^data:image\/(?:webp;base64,UklGR|jpeg;base64,\/9j\/|png;base64,iVBORw0KGgo)[A-Za-z0-9+/]*={0,2}$/.test(value)) continue;
    if (value.length > 2048) return null;
    if (index === 2 && /^\/(?![\\/])/.test(value)) continue;
    try {
      if (!/^https?:\/\//i.test(value) || !['https:', 'http:'].includes(new URL(value).protocol)) return null;
    } catch { return null; }
  }
  if (body.published && !body.show_on_se && !body.show_on_ai) return null;
  const { ai_category: category, ai_overview: overview, ai_outcomes: outcomes } = body;
  if (typeof category !== 'string' || category.length > 100 || typeof overview !== 'string' || overview.length > 8000 ||
      !Array.isArray(outcomes) || outcomes.length > 30 || outcomes.some(item => typeof item !== 'string' || item.length > 500)) return null;
  return [...values, JSON.stringify(tags), ...flags.map(key => String(body[key])), category.trim(), overview.trim(), JSON.stringify(outcomes)];
}

async function api(request, env, url) {
  if (!env.LOCAL_PREVIEW && !request.headers.get('oai-authenticated-user-id')) {
    return failure('Sign in to manage projects.', 401);
  }
  const { method } = request;
  const list = url.pathname === '/api/projects';
  const match = url.pathname.match(/^\/api\/projects\/([1-9][0-9]{0,9})(\/move)?$/);
  if (!list && !match) return failure('Page not found.', 404);
  if (method !== 'GET' && request.headers.get('Origin') !== url.origin) {
    return failure('Request must come from this dashboard.', 403);
  }
  if (!env.DATABASE_URL) {
    return failure('Set DATABASE_URL to connect this workspace to Neon.', 503);
  }
  let body;
  if (method === 'POST' || method === 'PATCH') {
    try { body = await request.json(); }
    catch { return failure('Invalid request body.', 400); }
  }
  try {
    const sql = database(env.DATABASE_URL);
    if (list && method === 'GET') {
      const projects = await sql('SELECT row_to_json(p)::text FROM (SELECT ' + columns + ' FROM ' + table + ' ORDER BY sort_order, id) p');
      return json({ mode: 'neon', projects });
    }
    if ((list && method === 'POST') || (match && !match[2] && method === 'PATCH')) {
      const values = fields(body);
      if (!values) return failure('Check the project fields, links, and selected portfolios.', 400);
      if (list && !values[2]) return failure('Add a cover image for this project.', 400);
      const tags = 'ARRAY(SELECT jsonb_array_elements_text($6::jsonb))';
      const outcomes = 'ARRAY(SELECT jsonb_array_elements_text($13::jsonb))';
      const query = list
        ? 'INSERT INTO ' + table + ' (title, description, image, github, live, technologies, featured, published, show_on_se, show_on_ai, ai_category, ai_overview, ai_outcomes, slug, sort_order) ' +
          'VALUES ($1,$2,$3,NULLIF($4,\'\'),NULLIF($5,\'\'),' + tags + ',$7,$8,$9,$10,$11,$12,' + outcomes + ',$14,(SELECT COALESCE(MAX(sort_order),0)+1 FROM ' + table + '))'
        : 'UPDATE ' + table + ' SET title=$1, description=$2, image=$3, github=NULLIF($4,\'\'), live=NULLIF($5,\'\'), technologies=' + tags +
          ', featured=$7, published=$8, show_on_se=$9, show_on_ai=$10, ai_category=$11, ai_overview=$12, ai_outcomes=' + outcomes + ' WHERE id=$14';
      const rows = await sql('WITH changed AS (' + query + ' RETURNING ' + columns + ') SELECT row_to_json(changed)::text FROM changed',
        [...values, list ? crypto.randomUUID() : match[1]]);
      return rows.length ? json(rows[0], list ? 201 : 200) : failure('Project no longer exists.', 404);
    }
    if (match?.[2] && method === 'POST') {
      if (![1, -1].includes(body?.direction)) return failure('Choose a valid direction.', 400);
      const [moved] = await sql('SELECT portfolio_manager.move_existing_project($1, $2)::text', [match[1], String(body.direction)]);
      return moved ? json({ ok: true }) : failure('Project no longer exists.', 404);
    }
    if (match && !match[2] && method === 'DELETE') {
      const rows = await sql('DELETE FROM ' + table + ' WHERE id=$1 RETURNING true::text', [match[1]]);
      return rows.length ? json({ ok: true }) : failure('Project no longer exists.', 404);
    }
    return failure('Method not allowed.', 405);
  } catch {
    return failure('Could not access projects in Neon. Check the connection and database migration.', 503);
  }
}

export function createWorker(assets) {
  return { async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request, env, url);
    const asset = Object.hasOwn(assets, url.pathname) && assets[url.pathname];
    if (!asset) return new Response('Page not found', { status: 404 });
    const body = asset.binary ? Uint8Array.from(atob(asset.body), character => character.charCodeAt(0)) : asset.body;
    return new Response(body, { headers: {
      'Content-Type': asset.type,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; base-uri 'none'; form-action 'self'"
    } });
  } };
}
