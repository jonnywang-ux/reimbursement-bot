import {
  getActiveSession,
  updateStatus,
  getSession,
  setExtractedData,
  appendExtractedRecord,
  enqueueReceipt,
  dequeueReceipt,
  setQueueProcessing,
  setReimbursementPurpose,
  appendConversationHistory,
} from '../services/sessionManager.js';
import { extractReceipt, chatWithClaude } from '../services/receiptExtractor.js';
import { convertAmount } from '../services/fxRateService.js';
import { downloadSlackFile, formatSummaryTable } from '../utils/slackHelpers.js';
import { getSignatureStatus } from '../services/helloSign.js';
import { log, warn, error } from '../utils/logger.js';
import { startSession } from '../utils/sessionHelpers.js';

const DONE_RE = /^(done|submit)$/i;
const STATUS_RE = /^status$/i;

/**
 * Drain the receipt processing queue for a session.
 * Processes one receipt at a time in arrival order.
 * Posts a Claude-generated acknowledgement after each receipt.
 */
async function drainQueue(threadTs, channel, client) {
  const session = getSession(threadTs);
  if (!session || session.isProcessingQueue) return;

  setQueueProcessing(threadTs, true);

  try {
    while (true) {
      const { item } = dequeueReceipt(threadTs);
      if (!item) break;

      let record;
      try {
        const botToken = process.env.SLACK_BOT_TOKEN;
        const fileBuffer = await downloadSlackFile(item.fileUrl, botToken);
        log('Extraction started', { threadTs, fileName: item.fileName });

        const currentSession = getSession(threadTs);
        const { extracted, prose } = await extractReceipt(
          fileBuffer,
          item.fileType,
          item.description,
          currentSession.conversationHistory,
        );

        log('Extraction completed', { threadTs, fileName: item.fileName, confidence: extracted.confidence });

        const fx = await convertAmount(extracted.amount, extracted.currency, extracted.date);
        log('FX rate fetched', { threadTs, fileName: item.fileName, currency: extracted.currency });

        record = { ...extracted, ...fx, fileName: item.fileName };
        appendExtractedRecord(threadTs, record);

        // Store assistant acknowledgement in history
        appendConversationHistory(threadTs, 'assistant', prose);

        // Post Claude's acknowledgement to Slack
        const ackText = prose || `✅ Processed: ${record.vendorName ?? item.fileName} — ${record.currency} ${record.amount}, ${record.date}`;
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: ackText,
        });

        // If counterparty is missing, Claude will have asked in the prose — no extra message needed

      } catch (extractErr) {
        error(`Error processing receipt ${item.fileName}`, extractErr, { threadTs });
        record = {
          vendorName: item.fileName,
          error: extractErr.message,
          needsReview: true,
          fileName: item.fileName,
        };
        appendExtractedRecord(threadTs, record);

        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: `❌ Could not process *${item.fileName}*: ${extractErr.message}. Please re-send or try a clearer image.`,
        });
      }
    }
  } finally {
    setQueueProcessing(threadTs, false);
  }
}

export function registerMessageListener(app) {
  app.message(async ({ message, say, client }) => {
    console.log('[message] RAW MESSAGE:', JSON.stringify(message, null, 2));
    if (message.bot_id) { console.log('[message] Ignoring — bot message'); return; }
    if (message.subtype) { console.log('[message] Ignoring — subtype:', message.subtype); return; }

    // @mention with no thread_ts = new session trigger
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

    // "status" — works on any thread that has a session
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
        error('status check error', err, { thread_ts, channel });
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
      // a. File attachments — enqueue immediately, drain asynchronously
      if (message.files?.length > 0) {
        for (const file of message.files) {
          enqueueReceipt(thread_ts, {
            fileUrl: file.url_private,
            fileType: file.mimetype,
            fileName: file.name,
            description: message.text ?? '',
            messageTs: message.ts,
          });
          // Store user message in conversation history
          appendConversationHistory(thread_ts, 'user', `[Receipt: ${file.name}]${message.text ? ' ' + message.text : ''}`);
          log('Receipt queued', { threadTs: thread_ts, channel, fileName: file.name, fileType: file.mimetype });
        }
        await client.reactions.add({ channel, timestamp: message.ts, name: 'hourglass_flowing_sand' });
        // Drain asynchronously — don't await so user can keep sending
        drainQueue(thread_ts, channel, client).catch(err => {
          error('Queue drain error', err, { threadTs: thread_ts });
        });
        return;
      }

      // b. "done" or "submit" — wait for queue to drain first, then post summary
      if (DONE_RE.test(message.text?.trim())) {
        appendConversationHistory(thread_ts, 'user', 'done');

        // Wait for any in-progress queue processing to finish
        let attempts = 0;
        while (getSession(thread_ts)?.isProcessingQueue && attempts < 30) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
        }

        // Also drain any remaining queued items
        await drainQueue(thread_ts, channel, client);

        const updated = getSession(thread_ts);
        const extractedData = updated.extractedData;
        const n = extractedData.length;

        if (n === 0) {
          await client.chat.postMessage({
            channel,
            thread_ts,
            text: "I don't have any receipts to process yet. Please send your receipt files first.",
          });
          return;
        }

        updateStatus(thread_ts, 'processing');

        await client.chat.postMessage({
          channel,
          thread_ts,
          text: `Got it! Preparing summary for ${n} receipt${n !== 1 ? 's' : ''}... ⏳`,
        });

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

      // c. Plain text message — record purpose if not yet set, then route through Claude
      if (message.text) {
        const currentSession = getSession(thread_ts);

        // If reimbursement purpose not yet captured, this answer is the purpose
        const userText = message.text.trim();
        appendConversationHistory(thread_ts, 'user', userText);

        if (!currentSession.reimbursementPurpose) {
          setReimbursementPurpose(thread_ts, userText);
          log('Reimbursement purpose captured', { threadTs: thread_ts });
        }

        // Route through Claude for a conversational reply
        try {
          const reply = await chatWithClaude(userText, currentSession.conversationHistory);
          appendConversationHistory(thread_ts, 'assistant', reply);
          await client.chat.postMessage({ channel, thread_ts, text: reply });
        } catch (claudeErr) {
          error('Claude chat error', claudeErr, { threadTs: thread_ts });
          await client.chat.postMessage({
            channel,
            thread_ts,
            text: "Got it! Send your receipts when you're ready. Say *done* when finished.",
          });
        }
      }

    } catch (err) {
      error('message listener error', err, { threadTs: thread_ts, channel });
      console.error('[message] Outer catch error:', err);
      try {
        await client.chat.postMessage({
          channel,
          thread_ts,
          text: `Sorry, something went wrong: ${err.message}`,
        });
      } catch (pmErr) {
        console.error('[message] postMessage FAILED — error fallback:', pmErr);
      }
    }
  });
}
