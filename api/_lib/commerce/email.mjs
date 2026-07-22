/* Restore-purchase email via Resend's REST API.
 *
 * The restore token is NEVER logged and never returned to the requester in
 * production — it travels only inside the email link. Local test mode
 * (localhost SITE_URL, no RESEND_API_KEY) returns the link so the flow can
 * be exercised without sending real mail; that branch is impossible in
 * production because commerce requires RESEND_API_KEY to be enabled.
 */
export function isLocalTestMode(env = process.env) {
  try {
    const host = new URL(env.SITE_URL || '').hostname;
    return !env.RESEND_API_KEY && ['localhost', '127.0.0.1', '::1'].includes(host);
  } catch {
    return false;
  }
}

export async function sendRestoreEmail({ to, restoreUrl }, env = process.env, fetchImpl = fetch) {
  if (isLocalTestMode(env)) {
    return { sent: false, localTestUrl: restoreUrl };
  }
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject: `${env.PRODUCT_DISPLAY_NAME || 'Estimation Tools'} — your download link`,
      text: [
        'Use the link below to open your downloads. It works once and expires in 15 minutes.',
        '',
        restoreUrl,
        '',
        `If you did not request this, ignore this email. Questions: ${env.SUPPORT_EMAIL || ''}`,
      ].join('\n'),
    }),
  });
  if (!response.ok) {
    // Do not leak provider details to the caller; the endpoint's response is
    // identical whether or not mail went out (anti-enumeration).
    return { sent: false, error: `resend ${response.status}` };
  }
  return { sent: true };
}
