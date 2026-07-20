/* Data-access layer for the extraction routes, over the Supabase SERVICE-ROLE
 * client (which bypasses RLS). BECAUSE RLS IS BYPASSED, every function here
 * performs an EXPLICIT ownership check: a caller may only touch a job /
 * project / document whose organization they are a member of. Guessing a
 * UUID is never sufficient — the org-membership join is the security boundary.
 *
 * These functions are thin and side-effect-scoped so the route handlers can
 * be tested against an in-memory fake implementing the same interface.
 */

/* Is `userId` a member of the org that owns `projectId`? */
export async function userOwnsProject(sb, userId, projectId) {
  const { data, error } = await sb
    .from('projects')
    .select('id, org_id, organization_members!inner(user_id)')
    .eq('id', projectId)
    .eq('organization_members.user_id', userId)
    .maybeSingle();
  if (error) throw Object.assign(new Error('db error'), { code: 'db_error', cause: error });
  return data ? { projectId: data.id, orgId: data.org_id } : null;
}

/* Idempotency: return an existing job for (project_id, idempotency_key). */
export async function findJobByIdempotency(sb, projectId, key) {
  const { data, error } = await sb
    .from('extraction_jobs')
    .select('*')
    .eq('project_id', projectId)
    .eq('idempotency_key', key)
    .maybeSingle();
  if (error) throw Object.assign(new Error('db error'), { code: 'db_error', cause: error });
  return data || null;
}

export async function insertJob(sb, row) {
  const { data, error } = await sb.from('extraction_jobs').insert(row).select('*').single();
  if (error) throw Object.assign(new Error('db error'), { code: 'db_error', cause: error });
  return data;
}

/* Fetch a job ONLY IF the user is a member of its org (ownership-checked). */
export async function getJobForUser(sb, userId, jobId) {
  const { data, error } = await sb
    .from('extraction_jobs')
    .select('*, organizations!inner(id, organization_members!inner(user_id))')
    .eq('id', jobId)
    .eq('organizations.organization_members.user_id', userId)
    .maybeSingle();
  if (error) throw Object.assign(new Error('db error'), { code: 'db_error', cause: error });
  if (!data) return null;
  delete data.organizations;                 // strip the join artifact
  return data;
}

export async function getResultForUser(sb, userId, jobId) {
  const job = await getJobForUser(sb, userId, jobId);
  if (!job) return { job: null, result: null };
  const { data, error } = await sb
    .from('extraction_results')
    .select('*')
    .eq('job_id', jobId)
    .maybeSingle();
  if (error) throw Object.assign(new Error('db error'), { code: 'db_error', cause: error });
  return { job, result: data || null };
}

export async function updateJob(sb, jobId, patch) {
  const { data, error } = await sb.from('extraction_jobs').update(patch).eq('id', jobId).select('*').single();
  if (error) throw Object.assign(new Error('db error'), { code: 'db_error', cause: error });
  return data;
}

export async function insertResult(sb, row) {
  const { data, error } = await sb.from('extraction_results').upsert(row, { onConflict: 'job_id' }).select('*').single();
  if (error) throw Object.assign(new Error('db error'), { code: 'db_error', cause: error });
  return data;
}
