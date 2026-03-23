import { getActiveSession, addReceipt, addDescription, updateStatus, getSession, setExtractedData } from '../services/sessionManager.js';
import { extractReceipt } from '../services/receiptExtractor.js';
import { convertAmount } from '../services/fxRateService.js';
import { downloadSlackFile, formatSummaryTable } from '../utils/slackHelpers.js';
import { getSignatureStatus } from '../services/helloSign.js';
import { log, warn, error } from '../utils/logger.js';

const DONE_RE = /^(done|submit)$/i;
const STATUS_RE = /^status$/i;

export function registerMessageListener(app) {
  app.message(async ({ message, client }) => {
    // Only process thread messages that aren't from the bot
    if (!message.thread_ts) return;
    if (message.bot_id) return;
    if (message.subtype) return;

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
    if (!session) return;

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

        await client.chat.postMessage({
          channel,
          thread_ts,
          text: `Got it! Processing ${n} receipt${n !== 1 ? 's' : ''}... ⏳`,
        });

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
      await client.chat.postMessage({
        channel,
        thread_ts,
        text: `Sorry, something went wrong: ${err.message}`,
      });
    }
  });
}
