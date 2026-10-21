/**
 * Email notifications via Resend (#140).
 *
 * Sends branded emails on:
 *   - Certificate minted
 *   - Certificate retired
 *   - Mint failed
 *
 * All sends are fire-and-forget: failures are logged but never thrown.
 * Configurable per operator via the NOTIFICATION_EMAIL env var.
 * Every email includes an unsubscribe link.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_ADDRESS = process.env.NOTIFICATION_FROM_EMAIL ?? 'SolarProof <notifications@solarproof.app>'
const UNSUBSCRIBE_URL = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=notifications`
  : 'https://solarproof.app/settings?tab=notifications'

interface EmailPayload {
  to: string
  subject: string
  html: string
}

async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!RESEND_API_KEY) return // no-op when not configured

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[email] send failed', { status: res.status, body: text })
  }
}

function baseTemplate(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="font-family:sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#2563eb">⚡ SolarProof</h1>
  <h2>${title}</h2>
  ${body}
  <hr style="margin-top:40px;border:none;border-top:1px solid #e5e7eb"/>
  <p style="font-size:12px;color:#6b7280">
    You are receiving this because you are an operator on SolarProof.<br/>
    <a href="${UNSUBSCRIBE_URL}">Manage notification preferences</a>
  </p>
</body>
</html>`
}

export async function sendMintedEmail(to: string, params: {
  reading_id: string
  mint_tx_hash: string
  kwh: number
  cooperative_id: string
}): Promise<void> {
  const html = baseTemplate('Certificate Minted ✅', `
    <p>A new energy certificate has been minted for your cooperative.</p>
    <table style="border-collapse:collapse;width:100%">
      <tr><td style="padding:8px;font-weight:bold">kWh</td><td style="padding:8px">${params.kwh}</td></tr>
      <tr><td style="padding:8px;font-weight:bold">Mint TX</td><td style="padding:8px;font-family:monospace;font-size:12px">${params.mint_tx_hash}</td></tr>
      <tr><td style="padding:8px;font-weight:bold">Reading ID</td><td style="padding:8px;font-family:monospace;font-size:12px">${params.reading_id}</td></tr>
    </table>
  `)
  await sendEmail({ to, subject: `SolarProof: ${params.kwh} kWh certificate minted`, html })
}

export async function sendRetiredEmail(to: string, params: {
  certificate_id: string
  retired_by: string
  retire_tx_hash: string
  kwh: number
}): Promise<void> {
  const html = baseTemplate('Certificate Retired 🏁', `
    <p>An energy certificate has been retired.</p>
    <table style="border-collapse:collapse;width:100%">
      <tr><td style="padding:8px;font-weight:bold">Certificate ID</td><td style="padding:8px;font-family:monospace;font-size:12px">${params.certificate_id}</td></tr>
      <tr><td style="padding:8px;font-weight:bold">kWh</td><td style="padding:8px">${params.kwh}</td></tr>
      <tr><td style="padding:8px;font-weight:bold">Retired by</td><td style="padding:8px;font-family:monospace;font-size:12px">${params.retired_by}</td></tr>
      <tr><td style="padding:8px;font-weight:bold">Retire TX</td><td style="padding:8px;font-family:monospace;font-size:12px">${params.retire_tx_hash}</td></tr>
    </table>
  `)
  await sendEmail({ to, subject: `SolarProof: certificate ${params.certificate_id.slice(0, 8)} retired`, html })
}

export async function sendMintFailedEmail(to: string, params: {
  reading_id: string
  error: string
  diagnosis?: unknown
}): Promise<void> {
  const diagnosisSection = params.diagnosis
    ? `<pre style="background:#fef2f2;padding:12px;border-radius:4px;font-size:12px;overflow-x:auto">${JSON.stringify(params.diagnosis, null, 2)}</pre>`
    : ''
  const html = baseTemplate('Mint Failed ⚠️', `
    <p>A certificate mint failed and requires attention.</p>
    <table style="border-collapse:collapse;width:100%">
      <tr><td style="padding:8px;font-weight:bold">Reading ID</td><td style="padding:8px;font-family:monospace;font-size:12px">${params.reading_id}</td></tr>
      <tr><td style="padding:8px;font-weight:bold">Error</td><td style="padding:8px;color:#dc2626">${params.error}</td></tr>
    </table>
    ${diagnosisSection}
  `)
  await sendEmail({ to, subject: `SolarProof: mint failed for reading ${params.reading_id.slice(0, 8)}`, html })
}

export interface RetirementReportBuyer {
  buyer: string
  kwh: number
  certificate_ids: string[]
}

export interface RetirementReportParams {
  /** Report month in YYYY-MM format. */
  month: string
  total_kwh: number
  buyers: RetirementReportBuyer[]
  cooperative_id?: string
}

/**
 * Send the monthly cooperative certificate retirement report (#123).
 *
 * Fire-and-forget: failures are logged but never thrown, consistent with the
 * other senders in this module.
 */
export async function sendRetirementReportEmail(
  to: string,
  params: RetirementReportParams,
): Promise<void> {
  try {
    const buyerRows = params.buyers.length
      ? params.buyers
          .map(
            (b) => `
      <tr>
        <td style="padding:8px;border-top:1px solid #e5e7eb;font-family:monospace;font-size:12px">${b.buyer}</td>
        <td style="padding:8px;border-top:1px solid #e5e7eb;text-align:right">${b.kwh}</td>
        <td style="padding:8px;border-top:1px solid #e5e7eb;font-family:monospace;font-size:12px">${b.certificate_ids.join(', ') || '—'}</td>
      </tr>`,
          )
          .join('')
      : `<tr><td colspan="3" style="padding:8px;border-top:1px solid #e5e7eb;color:#6b7280">No retirements recorded for this month.</td></tr>`

    const html = baseTemplate(`Retirement Report — ${params.month} 📊`, `
    <p>Here is the monthly certificate retirement report for your cooperative.</p>
    <table style="border-collapse:collapse;width:100%;margin-bottom:16px">
      <tr><td style="padding:8px;font-weight:bold">Month</td><td style="padding:8px">${params.month}</td></tr>
      <tr><td style="padding:8px;font-weight:bold">Total kWh retired</td><td style="padding:8px">${params.total_kwh}</td></tr>
      <tr><td style="padding:8px;font-weight:bold">Certificates retired</td><td style="padding:8px">${params.buyers.reduce((n, b) => n + b.certificate_ids.length, 0)}</td></tr>
    </table>
    <h3 style="margin-bottom:8px">Per-buyer breakdown</h3>
    <table style="border-collapse:collapse;width:100%">
      <thead>
        <tr>
          <th style="padding:8px;text-align:left;border-bottom:1px solid #e5e7eb">Buyer</th>
          <th style="padding:8px;text-align:right;border-bottom:1px solid #e5e7eb">kWh</th>
          <th style="padding:8px;text-align:left;border-bottom:1px solid #e5e7eb">Certificate IDs</th>
        </tr>
      </thead>
      <tbody>${buyerRows}</tbody>
    </table>
  `)
    await sendEmail({
      to,
      subject: `SolarProof: retirement report for ${params.month}`,
      html,
    })
  } catch (err) {
    console.error('[email] retirement report send failed', err)
  }
}

/**
 * Send an account lockout notification email.
 *
 * Called after MAX_ATTEMPTS consecutive failed logins (issue #115).
 * The email tells the user their account is temporarily locked and directs
 * them to contact support or wait for the lockout to expire.
 */
export async function sendLockoutEmail(to: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://solarproof.app'
  const html = baseTemplate('Account temporarily locked 🔒', `
    <p>We detected multiple consecutive failed login attempts on your account.</p>
    <p>For your security, your account has been <strong>temporarily locked for 15 minutes</strong>.</p>
    <p>If this was you, please wait 15 minutes and try again.</p>
    <p>If you did not make these attempts, we recommend
      <a href="${appUrl}/settings?tab=security">changing your password</a>
      immediately after regaining access.
    </p>
    <p>Need help? Contact <a href="mailto:support@solarproof.app">support@solarproof.app</a>.</p>
  `)
  await sendEmail({ to, subject: 'SolarProof: account temporarily locked', html })
}
