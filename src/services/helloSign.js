import { readFileSync } from 'fs';
import { basename } from 'path';
import { SIGNERS } from '../config/constants.js';

const API_BASE = 'https://api.hellosign.com/v3';

function getApiKey() {
  const key = process.env.HELLOSIGN_API_KEY;
  if (!key) throw new Error('HELLOSIGN_API_KEY env var not set');
  return key;
}

/** Basic-auth header: API key as username, empty password */
function authHeader(apiKey) {
  return 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
}

/**
 * Submit a PDF to HelloSign (Dropbox Sign) for a 4-signer ordered signing chain.
 *
 * @param {string} pdfPath       Absolute path to the PDF (or xlsx fallback)
 * @param {string} claimantName  Name of the expense claimant
 * @param {string} threadTs      Slack thread_ts, stored as metadata
 * @returns {Promise<{ signatureRequestId: string, detailsUrl: string | null }>}
 */
export async function submitForSigning(pdfPath, claimantName, threadTs) {
  const apiKey = getApiKey();

  const signers = SIGNERS
    .filter(s => s.email && s.name)
    .sort((a, b) => a.order - b.order);

  if (signers.length === 0) {
    throw new Error('No signers configured — check SIGNER_* env vars');
  }

  const today = new Date().toISOString().slice(0, 10);
  const title = `Budget Realization - ${claimantName} - ${today}`;
  const isProduction = process.env.NODE_ENV === 'production';

  // Build multipart/form-data manually via FormData (Node 18+ native)
  const form = new FormData();
  form.append('test_mode', isProduction ? '0' : '1');
  form.append('title', title);
  form.append('subject', 'Expense Reimbursement for Approval');
  form.append('message', `Please review and sign the attached expense reimbursement report for ${claimantName}.`);

  signers.forEach((s, idx) => {
    form.append(`signers[${idx}][email_address]`, s.email);
    form.append(`signers[${idx}][name]`, s.name);
    form.append(`signers[${idx}][order]`, String(idx + 1));
  });

  const fileBuffer = readFileSync(pdfPath);
  const fileName = basename(pdfPath);
  form.append('file[0]', new Blob([fileBuffer]), fileName);

  // metadata
  form.append('metadata[slack_thread_ts]', threadTs);
  form.append('metadata[claimant_name]', claimantName);

  const res = await fetch(`${API_BASE}/signature_request/send`, {
    method: 'POST',
    headers: { Authorization: authHeader(apiKey) },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HelloSign API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const req = data.signature_request;

  return {
    signatureRequestId: req.signature_request_id,
    detailsUrl: req.details_url ?? null,
  };
}

/**
 * Fetch the current signing status for a signature request.
 *
 * @param {string} signatureRequestId
 * @returns {Promise<{ status: string, signedBy: string[], pendingWith: string }>}
 */
export async function getSignatureStatus(signatureRequestId) {
  const apiKey = getApiKey();

  const res = await fetch(`${API_BASE}/signature_request/${signatureRequestId}`, {
    headers: { Authorization: authHeader(apiKey) },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HelloSign API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const req = data.signature_request;

  const signedBy = req.signatures
    .filter(s => s.status_code === 'signed')
    .map(s => s.signer_name);

  const pending = req.signatures
    .filter(s => s.status_code !== 'signed')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const pendingWith = pending.length > 0 ? pending[0].signer_name : 'Everyone has signed';

  return {
    status: req.is_complete ? 'complete' : 'pending',
    signedBy,
    pendingWith,
  };
}
