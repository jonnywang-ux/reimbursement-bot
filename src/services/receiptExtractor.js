import Anthropic from '@anthropic-ai/sdk';
import { RECEIPT_EXTRACTION_PROMPT } from '../config/skillPrompt.js';
import { CLAUDE_MODEL, CONFIDENCE_THRESHOLD } from '../config/constants.js';
import { withRetry } from '../utils/retry.js';
import { log, warn, error } from '../utils/logger.js';

const client = new Anthropic();

const CLAUDE_TIMEOUT_MS = 30_000;

/**
 * Extract structured data from a receipt image using Claude vision.
 *
 * @param {Buffer} fileBuffer - Raw file bytes
 * @param {string} fileType   - MIME type (e.g. "image/jpeg", "image/png", "application/pdf")
 * @param {string} descriptionContext - Any text the user sent alongside the receipt
 * @returns {Promise<object>} Extracted receipt data with optional flags
 */
export async function extractReceipt(fileBuffer, fileType, descriptionContext = '') {
  const base64Data = fileBuffer.toString('base64');

  // Build user message content
  const userContent = [];

  const supportedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (supportedImageTypes.includes(fileType)) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: fileType,
        data: base64Data,
      },
    });
  } else {
    userContent.push({
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

  userContent.push({ type: 'text', text: contextText });

  log('Receipt extraction started', { fileType, hasContext: !!descriptionContext.trim() });

  const rawText = await withRetry(async () => {
    const response = await client.messages.create(
      {
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: RECEIPT_EXTRACTION_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      },
      { timeout: CLAUDE_TIMEOUT_MS },
    );
    return response.content[0]?.text ?? '';
  }, 2, 2000);

  log('Receipt extraction completed', { fileType });

  let extracted;
  try {
    extracted = JSON.parse(rawText);
  } catch {
    throw new Error(`Claude returned non-JSON response: ${rawText.slice(0, 200)}`);
  }

  if ((extracted.confidence ?? 0) < CONFIDENCE_THRESHOLD) {
    warn('Low confidence extraction', { confidence: extracted.confidence, fileType });
    extracted.needsReview = true;
  }

  if (
    extracted.category === 'Meals/Entertainment' &&
    (!extracted.description || !/with\s+\S/i.test(extracted.description))
  ) {
    extracted.missingCounterparty = true;
  }

  return extracted;
}
