import { withRetry } from './retry.js';

/**
 * Download a Slack private file using the bot token.
 * Retries up to 2 times on transient failures.
 *
 * @param {string} fileUrl  The url_private from the Slack file object
 * @param {string} botToken SLACK_BOT_TOKEN
 * @returns {Promise<Buffer>}
 */
export async function downloadSlackFile(fileUrl, botToken) {
  return withRetry(async () => {
    const res = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${botToken}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to download Slack file: HTTP ${res.status} from ${fileUrl}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }, 2, 1000);
}

/**
 * Format extracted receipt data as a Slack Block Kit message with summary table,
 * approve/edit buttons, and warning flags.
 *
 * @param {object[]} extractedDataArray Array of merged extracted+FX records
 * @returns {object} Slack Block Kit payload (blocks array)
 */
export function formatSummaryTable(extractedDataArray) {
  const blocks = [];

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `Receipt Summary — ${extractedDataArray.length} item${extractedDataArray.length !== 1 ? 's' : ''}`,
    },
  });

  blocks.push({ type: 'divider' });

  // One section per receipt
  extractedDataArray.forEach((item, idx) => {
    const num = idx + 1;
    const lowConf = item.needsReview ? ' ⚠️ *Low confidence*' : '';
    const fallbackFx = item.source === 'fallback' ? ' ⚠️ *Fallback FX*' : '';
    const missingCounterparty = item.missingCounterparty ? ' ⚠️ *Missing counterparty*' : '';
    const hasError = item.error ? ' ❌ *Extraction failed*' : '';

    if (item.error) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*#${num} — ${item.vendorName ?? item.fileName ?? 'Unknown'}*${hasError}\n> ❌ ${item.error}`,
        },
      });
      return;
    }

    const origAmount = `${item.currency} ${Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const sgdAmount = item.totalAmountSGD != null
      ? `SGD ${Number(item.totalAmountSGD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '—';
    const usdAmount = item.totalAmountUSD != null
      ? `USD ${Number(item.totalAmountUSD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '—';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*#${num} — ${item.vendorName ?? 'Unknown vendor'}*${lowConf}${fallbackFx}${missingCounterparty}`,
          `> *Category:* ${item.category ?? '—'}  |  *Date:* ${item.date ?? '—'}  |  *Location:* ${item.location ?? '—'}`,
          `> *Description:* ${item.description ?? '—'}`,
          `> *Original:* ${origAmount}  →  *SGD:* ${sgdAmount}  |  *USD:* ${usdAmount}`,
          item.rateDate ? `> _MAS rate date: ${item.rateDate}_` : '',
        ].filter(Boolean).join('\n'),
      },
    });
  });

  blocks.push({ type: 'divider' });

  // Warning legend if any flags present
  const hasWarnings = extractedDataArray.some(
    i => i.needsReview || i.source === 'fallback' || i.missingCounterparty || i.error,
  );
  if (hasWarnings) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: [
            '⚠️ *Low confidence* — Claude was not certain about this extraction. Please verify.',
            '⚠️ *Fallback FX* — Official MAS rate unavailable; used open.er-api.com instead.',
            '⚠️ *Missing counterparty* — Required for Meals/Entertainment. Please reply with the name.',
            '❌ *Extraction failed* — Could not process this receipt. Check the file and try again.',
          ].join('\n'),
        },
      ],
    });
    blocks.push({ type: 'divider' });
  }

  // Approve / Edit buttons
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '✅ Approve & Generate Report' },
        style: 'primary',
        action_id: 'approve_receipts',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '✏️ Edit' },
        action_id: 'edit_receipts',
      },
    ],
  });

  return { blocks };
}
