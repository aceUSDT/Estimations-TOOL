const ALLOWED_ORIGINS = new Set([
  'https://estimations-tool.vercel.app',
  'http://127.0.0.1:8765',
  'http://localhost:8765',
]);

function response(origin: string, status: number, body: Record<string, unknown>) {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'vary': 'Origin',
  };
  if (ALLOWED_ORIGINS.has(origin)) headers['access-control-allow-origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin') || '';
  if (!ALLOWED_ORIGINS.has(origin)) return response(origin, 403, { error: 'forbidden' });

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        'cache-control': 'no-store',
        'vary': 'Origin',
      },
    });
  }
  if (request.method !== 'POST') return response(origin, 405, { error: 'method_not_allowed' });

  let token = '';
  try {
    const body = await request.json();
    token = typeof body?.token === 'string' ? body.token.trim() : '';
  } catch {
    return response(origin, 400, { error: 'invalid_request' });
  }
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) return response(origin, 410, { error: 'pass_unavailable' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return response(origin, 503, { error: 'service_unavailable' });

  const redeem = await fetch(`${supabaseUrl}/rest/v1/rpc/redeem_manager_test_pass`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${serviceKey}`,
      'apikey': serviceKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_token_hash: await sha256(token) }),
  });
  if (!redeem.ok) return response(origin, 503, { error: 'service_unavailable' });
  const rows = await redeem.json();
  if (!Array.isArray(rows) || rows.length !== 1) return response(origin, 410, { error: 'pass_unavailable' });
  const expiresAt = Date.parse(rows[0]?.expires_at || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return response(origin, 410, { error: 'pass_unavailable' });

  return response(origin, 200, { ok: true, expiresAt: new Date(expiresAt).toISOString() });
});
