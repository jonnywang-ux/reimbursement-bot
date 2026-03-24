import Anthropic from '@anthropic-ai/sdk';
import { REIMBURSEMENT_SYSTEM_PROMPT } from '../config/skillPrompt.js';
import { CLAUDE_MODEL, CONFIDENCE_THRESHOLD } from '../config/constants.js';
import { withRetry } from '../utils/retry.js';
import { log, warn, error } from '../utils/logger.js';

const client = new Anthropic();

const CLAUDE_TIMEOUT_MS = 30_000;

/**
 * Parse <receipt_json>...</receipt_json> out of a Claude response.
 * Returns null if not found.
 *
 * @param {string} text
 * @returns {object|null}
 */
function parseReceiptJson(text) {
  const match = text.match(/<receipt_json>([\s\S]*?)<\/receipt_json>/);
  if (!match) return null;
  return JSON.parse(match[1].trim());
}

/**
 * Extract the natural-language prose from a Claude response (everything
 * outside the <receipt_json> block), stripped of leading/trailing whitespace.
 *
 * @param {string} text
 * @returns {string}
 */
function extractProse(text) {
  return text.replace(/<receipt_json>[\s\S]*?<\/receipt_json>/g, '').trim();
}

/**
 * Extract structured data from a receipt image using Claude vision.
 * Returns both the structured JSON and the natural-language acknowledgement
 * for posting to Slack.
 *
 * @param {Buffer} fileBuffer          - Raw file bytes
 * @param {string} fileType            - MIME type (e.g. "image/jpeg", "application/pdf")
 * @param {string} descriptionContext  - Any text the user sent alongside the receipt
 * @param {Array}  conversationHistory - Last N messages [{role, content}] for context
 * @returns {Promise<{ extracted: object, prose: string }>}
 */
export async function extractReceipt(fileBuffer, fileType, descriptionContext = '', conversationHistory = []) {
  const base64Data = fileBuffer.toString('base64');

  // Build user content for this receipt
  const receiptContent = [];

  const supportedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (supportedImageTypes.includes(fileType)) {
    receiptContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: fileType,
        data: base64Data,
      },
    });
  } else {
    receiptContent.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: fileType,
        data: base64Data,
      },
    });
  }

  const contextText = descriptionContext.trim()
    ? `Additional context from the submitter: ${descriptionContext.trim()}`
    : 'No additional context provided.';
  receiptContent.push({ type: 'text', text: contextText });

  // Build messages: trimmed history + this receipt turn
  const MAX_HISTORY = 20;
  const trimmedHistory = conversationHistory.slice(-MAX_HISTORY);
  const messages = [
    ...trimmedHistory,
    { role: 'user', content: receiptContent },
  ];

  log('Receipt extraction started', { fileType, hasContext: !!descriptionContext.trim(), historyLength: trimmedHistory.length });

  const rawText = await withRetry(async () => {
    const response = await client.messages.create(
      {
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: REIMBURSEMENT_SYSTEM_PROMPT,
        messages,
      },
      { timeout: CLAUDE_TIMEOUT_MS },
    );
    return response.content[0]?.text ?? '';
  }, 2, 2000);

  log('Receipt extraction completed', { fileType });

  let extracted;
  try {
    extracted = parseReceiptJson(rawText);
    if (!extracted) {
      throw new Error('No <receipt_json> block found in response');
    }
  } catch (parseErr) {
    throw new Error(`Claude returned unparseable response: ${parseErr.message}. Raw: ${rawText.slice(0, 300)}`);
  }

  if ((extracted.confidence ?? 0) < CONFIDENCE_THRESHOLD) {
    warn('Low confidence extraction', { confidence: extracted.confidence, fileType });
    extracted.needsReview = true;
  }

  // Normalise needsCounterparty — support both old missingCounterparty and new needsCounterparty
  if (
    extracted.needsCounterparty ||
    (extracted.category === 'Meals/Entertainment' && (!extracted.description || !/with\s+\S/i.test(extracted.description)))
  ) {
    extracted.needsCounterparty = true;
    extracted.missingCounterparty = true; // keep legacy flag for slackHelpers compatibility
  }

  const prose = extractProse(rawText);

  return { extracted, prose };
}

/**
 * Send a plain text message to Claude (no receipt attachment) and get a reply.
 * Used for conversational turns (e.g. opening question, corrections, clarifications).
 *
 * @param {string} userText            - The user's message
 * @param {Array}  conversationHistory - Last N messages [{role, content}]
 * @returns {Promise<string>} Claude's reply text
 */
export async function chatWithClaude(userText, conversationHistory = []) {
  const MAX_HISTORY = 20;
  const trimmedHistory = conversationHistory.slice(-MAX_HISTORY);
  const messages = [
    ...trimmedHistory,
    { role: 'user', content: userText },
  ];

  const response = await withRetry(async () => {
    const res = await client.messages.create(
      {
        model: CLAUDE_MODEL,
        max_tokens: 512,
        system: REIMBURSEMENT_SYSTEM_PROMPT,
        messages,
      },
      { timeout: CLAUDE_TIMEOUT_MS },
    );
    return res.content[0]?.text ?? '';
  }, 2, 2000);

  return response;
}
