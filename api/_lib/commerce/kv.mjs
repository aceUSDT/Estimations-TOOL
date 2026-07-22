/* Commerce KV — the entitlement store, on Supabase (the system's single
 * database) instead of Netlify Blobs. Exposes the exact interface the
 * commerce code was written against (get / get{type:'json'} / set /
 * setJSON), so entitlements.mjs logic is unchanged.
 *
 * Table: public.commerce_kv (supabase/migrations/0004_commerce_kv.sql).
 * RLS is enabled + FORCED with NO policies: only the service-role client
 * (server-side, never the browser) can read or write entitlements.
 */
import { serviceClient } from '../supabase.mjs';

const TABLE = 'commerce_kv';

export function supabaseKvStore(sb) {
  const client = sb || serviceClient();
  return {
    async get(key, opts) {
      const { data, error } = await client.from(TABLE).select('value').eq('key', key).maybeSingle();
      if (error) throw new Error(`kv get failed: ${error.code || 'db_error'}`);
      if (!data) return null;
      // Blobs semantics: {type:'json'} returns the object; default returns
      // the stored string (pointer keys store bare strings).
      if (opts && opts.type === 'json') return data.value;
      return typeof data.value === 'string' ? data.value : JSON.stringify(data.value);
    },
    async set(key, value) {
      const { error } = await client.from(TABLE).upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw new Error(`kv set failed: ${error.code || 'db_error'}`);
    },
    async setJSON(key, value) {
      return this.set(key, value);
    },
  };
}
