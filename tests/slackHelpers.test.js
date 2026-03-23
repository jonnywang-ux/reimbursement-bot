import { describe, it, expect, vi } from 'vitest';
import { formatSummaryTable } from '../src/utils/slackHelpers.js';

describe('slackHelpers', () => {
  describe('formatSummaryTable', () => {
    it('returns blocks array with header block containing item count', () => {
      const items = [
        {
          vendorName: 'Starbucks',
          category: 'Meals/Entertainment',
          date: '2026-01-15',
          currency: 'USD',
          amount: 5.50,
          totalAmountSGD: 7.50,
          totalAmountUSD: 5.50,
          description: 'Coffee meeting',
        },
      ];

      const result = formatSummaryTable(items);

      expect(result).toHaveProperty('blocks');
      expect(Array.isArray(result.blocks)).toBe(true);
      expect(result.blocks.length).toBeGreaterThan(0);

      const headerBlock = result.blocks[0];
      expect(headerBlock.type).toBe('header');
      expect(headerBlock.text.text).toContain('Receipt Summary');
      expect(headerBlock.text.text).toContain('1 item');
    });

    it('shows plural "items" when count > 1', () => {
      const items = [
        {
          vendorName: 'Vendor1',
          category: 'Meals/Entertainment',
          date: '2026-01-15',
          currency: 'USD',
          amount: 10,
          totalAmountSGD: 13.4,
          totalAmountUSD: 10,
        },
        {
          vendorName: 'Vendor2',
          category: 'Transportation',
          date: '2026-01-16',
          currency: 'SGD',
          amount: 20,
          totalAmountSGD: 20,
          totalAmountUSD: 14.93,
        },
      ];

      const result = formatSummaryTable(items);
      const headerBlock = result.blocks[0];
      expect(headerBlock.text.text).toContain('2 items');
    });

    it('each receipt item renders as a section block with vendor, category, date, amounts', () => {
      const items = [
        {
          vendorName: 'Restaurant ABC',
          category: 'Meals/Entertainment',
          date: '2026-01-15',
          currency: 'SGD',
          amount: 50,
          totalAmountSGD: 50,
          totalAmountUSD: 37.31,
          description: 'Team lunch',
          location: 'Singapore',
          rateDate: '2026-01-15',
        },
      ];

      const result = formatSummaryTable(items);

      const sectionBlocks = result.blocks.filter(b => b.type === 'section');
      expect(sectionBlocks.length).toBeGreaterThan(0);

      const itemBlock = sectionBlocks[0];
      expect(itemBlock.type).toBe('section');
      expect(itemBlock.text.type).toBe('mrkdwn');
      expect(itemBlock.text.text).toContain('Restaurant ABC');
      expect(itemBlock.text.text).toContain('Meals/Entertainment');
      expect(itemBlock.text.text).toContain('2026-01-15');
      expect(itemBlock.text.text).toContain('SGD 50.00');
      expect(itemBlock.text.text).toContain('USD 37.31');
      expect(itemBlock.text.text).toContain('Team lunch');
    });

    it('items with error field render the error row with ❌', () => {
      const items = [
        {
          vendorName: 'Receipt',
          fileName: 'receipt.pdf',
          error: 'Failed to extract data from image',
        },
      ];

      const result = formatSummaryTable(items);

      const sectionBlocks = result.blocks.filter(b => b.type === 'section');
      const errorBlock = sectionBlocks[0];

      expect(errorBlock.text.text).toContain('❌');
      expect(errorBlock.text.text).toContain('Extraction failed');
      expect(errorBlock.text.text).toContain('Failed to extract data from image');
      // Should NOT contain normal receipt info
      expect(errorBlock.text.text).not.toContain('Category:');
    });

    it('items with error render with fileName when vendorName is missing', () => {
      const items = [
        {
          fileName: 'receipt-123.jpg',
          error: 'Processing error',
        },
      ];

      const result = formatSummaryTable(items);
      const sectionBlocks = result.blocks.filter(b => b.type === 'section');
      expect(sectionBlocks[0].text.text).toContain('receipt-123.jpg');
    });

    it('items without error show normal receipt details', () => {
      const items = [
        {
          vendorName: 'Coffee Shop',
          category: 'Meals/Entertainment',
          date: '2026-01-20',
          currency: 'USD',
          amount: 8.50,
          totalAmountSGD: 11.39,
          totalAmountUSD: 8.50,
          description: 'Meeting with client',
          location: 'Downtown',
        },
      ];

      const result = formatSummaryTable(items);
      const allBlocks = result.blocks;
      // Find the receipt section blocks (type: section, with mrkdwn text, not actions/context)
      const receiptBlocks = allBlocks.filter(
        b => b.type === 'section' && b.text && b.text.type === 'mrkdwn',
      );
      expect(receiptBlocks.length).toBeGreaterThan(0);
      const text = receiptBlocks[0].text.text;

      expect(text).toContain('Coffee Shop');
      expect(text).toContain('*Category:*');
      expect(text).toContain('Meals/Entertainment');
      expect(text).toContain('*Date:*');
      expect(text).toContain('2026-01-20');
      expect(text).not.toContain('❌');
    });

    it('items with needsReview=true show ⚠️ Low confidence warning', () => {
      const items = [
        {
          vendorName: 'Blurry Receipt',
          category: 'Transportation',
          date: '2026-01-15',
          currency: 'SGD',
          amount: 30,
          totalAmountSGD: 30,
          totalAmountUSD: 22.39,
          needsReview: true,
        },
      ];

      const result = formatSummaryTable(items);
      const sectionBlocks = result.blocks.filter(b => b.type === 'section');
      expect(sectionBlocks[0].text.text).toContain('⚠️ *Low confidence*');
    });

    it('items with source=fallback show ⚠️ Fallback FX warning', () => {
      const items = [
        {
          vendorName: 'USD Receipt',
          category: 'Meals/Entertainment',
          date: '2026-01-15',
          currency: 'USD',
          amount: 20,
          totalAmountSGD: 26.8,
          totalAmountUSD: 20,
          source: 'fallback',
        },
      ];

      const result = formatSummaryTable(items);
      const sectionBlocks = result.blocks.filter(b => b.type === 'section');
      expect(sectionBlocks[0].text.text).toContain('⚠️ *Fallback FX*');
    });

    it('items with missingCounterparty=true show ⚠️ Missing counterparty warning', () => {
      const items = [
        {
          vendorName: 'Restaurant',
          category: 'Meals/Entertainment',
          date: '2026-01-15',
          currency: 'SGD',
          amount: 45,
          totalAmountSGD: 45,
          totalAmountUSD: 33.58,
          description: 'Meal alone',
          missingCounterparty: true,
        },
      ];

      const result = formatSummaryTable(items);
      const sectionBlocks = result.blocks.filter(b => b.type === 'section');
      expect(sectionBlocks[0].text.text).toContain('⚠️ *Missing counterparty*');
    });

    it('warnings legend block appears only when any item has warning flags', () => {
      const itemsWithWarning = [
        {
          vendorName: 'Test',
          category: 'Meals/Entertainment',
          date: '2026-01-15',
          currency: 'SGD',
          amount: 10,
          totalAmountSGD: 10,
          totalAmountUSD: 7.46,
          needsReview: true,
        },
      ];

      const resultWithWarning = formatSummaryTable(itemsWithWarning);
      const contextBlocks = resultWithWarning.blocks.filter(b => b.type === 'context');
      expect(contextBlocks.length).toBeGreaterThan(0);
      expect(contextBlocks[0].elements[0].text).toContain('⚠️ *Low confidence*');
    });

    it('warnings legend block does not appear when no warnings', () => {
      const itemsNoWarnings = [
        {
          vendorName: 'Clean Receipt',
          category: 'Transportation',
          date: '2026-01-15',
          currency: 'SGD',
          amount: 25,
          totalAmountSGD: 25,
          totalAmountUSD: 18.66,
          description: 'Taxi ride',
        },
      ];

      const resultNoWarning = formatSummaryTable(itemsNoWarnings);
      const contextBlocks = resultNoWarning.blocks.filter(b => b.type === 'context');
      expect(contextBlocks).toHaveLength(0);
    });

    it('Approve and Edit buttons are always present', () => {
      const items = [
        {
          vendorName: 'Any Receipt',
          category: 'Other',
          date: '2026-01-15',
          currency: 'SGD',
          amount: 15,
          totalAmountSGD: 15,
          totalAmountUSD: 11.19,
        },
      ];

      const result = formatSummaryTable(items);

      const actionBlocks = result.blocks.filter(b => b.type === 'actions');
      expect(actionBlocks.length).toBeGreaterThan(0);

      const actionBlock = actionBlocks[0];
      expect(actionBlock.elements).toHaveLength(2);

      const approveBtn = actionBlock.elements.find(
        e => e.action_id === 'approve_receipts',
      );
      const editBtn = actionBlock.elements.find(
        e => e.action_id === 'edit_receipts',
      );

      expect(approveBtn).toBeDefined();
      expect(approveBtn.text.text).toContain('Approve');
      expect(editBtn).toBeDefined();
      expect(editBtn.text.text).toContain('Edit');
    });

    it('handles missing optional fields gracefully', () => {
      const items = [
        {
          vendorName: 'Minimal Receipt',
          category: 'Other',
          currency: 'SGD',
          amount: 5,
        },
      ];

      const result = formatSummaryTable(items);

      expect(result.blocks).toBeDefined();
      const sectionBlocks = result.blocks.filter(b => b.type === 'section');
      expect(sectionBlocks.length).toBeGreaterThan(0);
      expect(sectionBlocks[0].text.text).toContain('Minimal Receipt');
    });

    it('formats currency amounts with 2 decimal places and thousand separators', () => {
      const items = [
        {
          vendorName: 'Large Purchase',
          category: 'Other',
          date: '2026-01-15',
          currency: 'USD',
          amount: 1234.5,
          totalAmountSGD: 1654.43,
          totalAmountUSD: 1234.5,
        },
      ];

      const result = formatSummaryTable(items);
      const sectionBlocks = result.blocks.filter(b => b.type === 'section');
      expect(sectionBlocks[0].text.text).toContain('USD 1,234.50');
      expect(sectionBlocks[0].text.text).toContain('SGD 1,654.43');
    });

    it('displays rateDate when provided', () => {
      const items = [
        {
          vendorName: 'Test',
          category: 'Meals/Entertainment',
          date: '2026-01-15',
          currency: 'SGD',
          amount: 10,
          totalAmountSGD: 10,
          totalAmountUSD: 7.46,
          rateDate: '2026-01-14',
        },
      ];

      const result = formatSummaryTable(items);
      const sectionBlocks = result.blocks.filter(b => b.type === 'section');
      expect(sectionBlocks[0].text.text).toContain('2026-01-14');
    });

    it('handles empty items array', () => {
      const result = formatSummaryTable([]);

      expect(result.blocks).toBeDefined();
      const headerBlock = result.blocks[0];
      expect(headerBlock.text.text).toContain('0 items');
    });

    it('combines multiple warning flags in one item', () => {
      const items = [
        {
          vendorName: 'Problematic',
          category: 'Meals/Entertainment',
          date: '2026-01-15',
          currency: 'USD',
          amount: 30,
          totalAmountSGD: 40.2,
          totalAmountUSD: 30,
          needsReview: true,
          source: 'fallback',
          missingCounterparty: true,
        },
      ];

      const result = formatSummaryTable(items);
      const sectionBlocks = result.blocks.filter(b => b.type === 'section');
      const text = sectionBlocks[0].text.text;

      expect(text).toContain('⚠️ *Low confidence*');
      expect(text).toContain('⚠️ *Fallback FX*');
      expect(text).toContain('⚠️ *Missing counterparty*');
    });

    it('hides amounts as dash when totalAmountSGD/USD are null', () => {
      const items = [
        {
          vendorName: 'Incomplete',
          category: 'Other',
          date: '2026-01-15',
          currency: 'XYZ',
          amount: 50,
          totalAmountSGD: null,
          totalAmountUSD: null,
        },
      ];

      const result = formatSummaryTable(items);
      const allBlocks = result.blocks;
      const receiptBlocks = allBlocks.filter(
        b => b.type === 'section' && b.text && b.text.type === 'mrkdwn',
      );
      const text = receiptBlocks[0].text.text;

      expect(text).toContain('*SGD:* —');
      expect(text).toContain('*USD:* —');
    });
  });
});
