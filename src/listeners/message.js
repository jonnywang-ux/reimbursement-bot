import { getActiveSession, addReceipt, addDescription, updateStatus, getSession, setExtractedData } from '../services/sessionManager.js';
import { extractReceipt } from '../services/receiptExtractor.js';
import { convertAmount } from '../services/fxRateService.js';
import { downloadSlackFile, formatSummaryTable } from '../utils/slackHelpers.js';
import { getSignatureStatus } from '../services/helloSign.js';
import { log, warn, error } from '../utils/logger.js';
import { startSession } from '../utils/sessionHelpers.js';

const DONE_RE = /^(done|submit)$/i;
const STATUS_RE = /^status$/i;

export function registerMessageListener(app) {
  app.message(async ({ message, say, client }) => {
    console.log('[message] RAW MESSAGE:', JSON.stringify(message, null, 2));
    if (message.bot_id) { console.log('[message] Ignoring — bot message'); return; }
    if (message.subtype) { console.log('[message] Ignoring — subtype:', message.subtype); return; }

    // @mention with no thread_ts = new session trigger (catches app_mention routed as message)
    if (!message.thread_ts) {
      const botUserId = process.env.SLACK_BOT_USER_ID;
      const isBotMention = botUserId && message.text?.includes(`<@${botUserId}>`);
      if (isBotMention) {
        console.log('[message] Detected bot @mention with no thread — treating as app_mention');
        await startSession(message.channel, message.user, message.ts, say, client);
      } else {
        console.log('[message] Ignoring — no thread_ts and not a bot mention');
      }
      return;
    }

    const { thread_ts, channel } = message;

    // "status" — works on any thread that has a session (not just collecting)
    if (STATUS_RE.test(message.text?.trim())) {
      const anySession = getSession(thread_ts);
      if (!anySession) return;
      try {
        if (!anySession.signatureRequestId) {
          await client.chat.postMessage({
            channel,
            thread_ts,
            text: 'No HelloSign submission found for this thread yet.',
          });
          return;
        }
        const { status, signedBy, pendingWith } = await getSignatureStatus(anySession.signatureRequestId);
        const signedLine = signedBy.length > 0
          ? `✅ Signed by: ${signedBy.join(', ')}`
          : '_(no signatures yet)_';
        const pendingLine = status === 'complete'
          ? '🎉 All signatures collected!'
          : `⏳ Pending with: *${pendingWith}*`;
        await client.chat.postMessage({
          channel,
          thread_ts,
          text: `*Signing status:* ${status}\n${signedLine}\n${pendingLine}`,
        });
      } catch (err) {
        error('status check error', err, { threadTs, channel });
        await client.chat.postMessage({
          channel,
          thread_ts,
          text: `Could not fetch signing status: ${err.message}`,
        });
      }
      return;
    }

    const session = getActiveSession(message.channel, message.thread_ts);
    if (!session) { console.log('[message] Ignoring — no active session for thread', thread_ts); return; }
    console.log('[message] Active session found, processing message');

    try {
      // a. File attachments
      if (message.files?.length > 0) {
        for (const file of message.files) {
          addReceipt(thread_ts, {
            fileUrl: file.url_private,
            fileType: file.mimetype,
            fileName: file.name,
            description: message.text ?? '',
            messageTs: message.ts,
          });
          log('Receipt received', { threadTs: thread_ts, channel, fileName: file.name, fileType: file.mimetype });
        }
        await client.reactions.add({
          channel,
          timestamp: message.ts,
          name: 'paperclip',
        });
        return;
      }

      // b. "done" or "submit"
      if (DONE_RE.test(message.text?.trim())) {
        updateStatus(thread_ts, 'processing');
        const updated = getSession(thread_ts);
        const n = updated.receipts.length;

        console.log('[message] Calling postMessage — processing receipts...');
        try {
          await client.chat.postMessage({
            channel,
            thread_ts,
            text: `Got it! Processing ${n} receipt${n !== 1 ? 's' : ''}... ⏳`,
          });
          console.log('[message] postMessage completed — processing receipts');
        } catch (pmErr) {
          console.error('[message] postMessage FAILED — processing receipts:', pmErr);
        }

        // Extract data from each receipt and fetch FX rates
        const botToken = process.env.SLACK_BOT_TOKEN;
        const extractedData = [];

        for (const receipt of updated.receipts) {
          let record;
          try {
            const fileBuffer = await downloadSlackFile(receipt.fileUrl, botToken);
            log('Extraction started', { threadTs: thread_ts, fileName: receipt.fileName });
            const extracted = await extractReceipt(fileBuffer, receipt.fileType, receipt.description);
            log('Extraction completed', { threadTs: thread_ts, fileName: receipt.fileName, confidence: extracted.confidence });
            const fx = await convertAmount(extracted.amount, extracted.currency, extracted.date);
            log('FX rate fetched', { threadTs: thread_ts, fileName: receipt.fileName, currency: extracted.currency, rateDate: fx.rateDate, source: fx.source, sgdPerUnit: fx.fxRateSGD });
            record = { ...extracted, ...fx, fileName: receipt.fileName };
          } catch (extractErr) {
            error(`Error processing receipt ${receipt.fileName}`, extractErr, { threadTs: thread_ts });
            record = {
              vendorName: receipt.fileName,
              error: extractErr.message,
              needsReview: true,
              fileName: receipt.fileName,
            };
          }
          extractedData.push(record);
        }

        // Check if any receipt is missing a counterparty for Meals/Entertainment
        const needsCounterparty = extractedData.some(r => r.missingCounterparty);
        if (needsCounterparty) {
          await client.chat.postMessage({
            channel,
            thread_ts,
            text: '⚠️ One or more Meals/Entertainment receipts are missing the counterparty name (who you dined with). Please reply with the name(s) before I continue.',
          });
          // Store extracted data in session for later use and pause at reviewing
          // TODO: handle counterparty reply flow
        }

        // Persist extracted data in session for the approve handler
        setExtractedData(thread_ts, extractedData);

        // Post summary table with approve/edit buttons
        const summaryPayload = formatSummaryTable(extractedData);
        await client.chat.postMessage({
          channel,
          thread_ts,
          ...summaryPayload,
          text: 'Receipt extraction complete — please review the summary below.',
        });

        updateStatus(thread_ts, 'reviewing');
        return;
      }

      // c. Other text — store as description context
      if (message.text) {
        addDescription(thread_ts, message.text, message.ts);
      }
    } catch (err) {
      error('message listener error', err, { threadTs: thread_ts, channel });
      console.error('[message] Outer catch error:', err);
      console.log('[message] Calling postMessage — error fallback...');
      try {
        await client.chat.postMessage({
          channel,
          thread_ts,
          text: `Sorry, something went wrong: ${err.message}`,
        });
        console.log('[message] postMessage completed — error fallback');
      } catch (pmErr) {
        console.error('[message] postMessage FAILED — error fallback:', pmErr);
      }
    }
  });
}
