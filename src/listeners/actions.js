import { getSession, updateStatus, setSignatureRequestId } from '../services/sessionManager.js';
import { generateReport } from '../services/reportGenerator.js';
import { submitForSigning } from '../services/helloSign.js';
import { convertToPdf } from '../utils/pdfConverter.js';
import { withRetry } from '../utils/retry.js';
import { log, error } from '../utils/logger.js';
import { createReadStream } from 'fs';

export function registerActionsListener(app) {
  // ── Approve ──────────────────────────────────────────────────────────────
  app.action('approve_receipts', async ({ ack, body, client }) => {
    await ack();

    const threadTs = body.message?.thread_ts ?? body.container?.thread_ts;
    const channel  = body.channel?.id ?? body.container?.channel_id;

    if (!threadTs || !channel) {
      console.error('approve_receipts: could not determine threadTs or channel from payload');
      return;
    }

    const session = getSession(threadTs);
    if (!session) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: '⚠️ Session not found. Please start a new session by @mentioning me.',
      });
      return;
    }

    try {
      updateStatus(threadTs, 'approved');

      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: '✅ Approved! Generating report... ⏳',
      });

      // 1. Generate Excel + CSV
      let xlsxPath, csvPath;
      try {
        ({ xlsxPath, csvPath } = await generateReport(
          session.extractedData,
          session.claimantName,
        ));
        log('Report generated', { threadTs, xlsxPath, csvPath });
      } catch (reportErr) {
        error('Report generation failed', reportErr, { threadTs });
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: `❌ Report generation failed: ${reportErr.message}\n\nRaw extracted data:\n\`\`\`json\n${JSON.stringify(session.extractedData, null, 2)}\n\`\`\``,
        });
        return;
      }

      // 2. Convert to PDF (graceful fallback if LibreOffice not available)
      const pdfPath = await convertToPdf(xlsxPath);

      // 3. Upload xlsx to Slack thread
      await withRetry(() => client.files.uploadV2({
        channel_id: channel,
        thread_ts: threadTs,
        file: createReadStream(xlsxPath),
        filename: xlsxPath.split(/[\\/]/).pop(),
        initial_comment: '📊 Here is your reimbursement report:',
      }), 2, 1000);

      // 4. Upload PDF if conversion succeeded
      if (pdfPath) {
        await withRetry(() => client.files.uploadV2({
          channel_id: channel,
          thread_ts: threadTs,
          file: createReadStream(pdfPath),
          filename: pdfPath.split(/[\\/]/).pop(),
        }), 2, 1000);
      }

      // 5. Submit to HelloSign
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: '📝 Submitting to HelloSign for signing...',
      });

      const targetPdf = pdfPath ?? xlsxPath;  // fall back to xlsx if no PDF
      const { signatureRequestId, detailsUrl } = await withRetry(
        () => submitForSigning(targetPdf, session.claimantName, threadTs),
        2,
        1500,
      );

      setSignatureRequestId(threadTs, signatureRequestId);
      updateStatus(threadTs, 'submitted');
      log('HelloSign submitted', { threadTs, signatureRequestId });

      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `📝 Submitted to HelloSign for signing.\nSigning order: Jonny → Daniel → Pak Kimin → Yopi (CFO)\nI'll update you on progress.${detailsUrl ? `\n<${detailsUrl}|View signing request>` : ''}`,
      });

    } catch (err) {
      error('approve_receipts action error', err, { threadTs });
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `❌ Something went wrong during approval: ${err.message}. Please try again or contact support.`,
      });
    }
  });

  // ── Edit ─────────────────────────────────────────────────────────────────
  app.action('edit_receipts', async ({ ack, body, client }) => {
    await ack();

    const threadTs = body.message?.thread_ts ?? body.container?.thread_ts;
    const channel  = body.channel?.id ?? body.container?.channel_id;

    if (!threadTs || !channel) return;

    try {
      updateStatus(threadTs, 'collecting');

      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: "✏️ No problem! What would you like to change? Reply with your corrections and I'll update the summary.",
      });
    } catch (err) {
      error('edit_receipts action error', err, { threadTs });
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `❌ Something went wrong: ${err.message}`,
      });
    }
  });
}
