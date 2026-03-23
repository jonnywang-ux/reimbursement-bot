import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', '..', 'scripts', 'generate_report.py');

/**
 * Transform an extractedData record into the shape expected by generate_report.py.
 */
function toExpenseRecord(record, claimantName) {
  return {
    date: record.date ?? '',
    user: claimantName,
    expense_type: record.category ?? '',
    vendor_name: record.vendorName ?? record.fileName ?? '',
    description: record.description ?? '',
    currency: record.currency ?? 'USD',
    price_per_unit: record.amount ?? 0,
    total_nights: record.totalNights ?? null,
    total_units: record.totalUnits ?? null,
    total_amount_original: record.amount ?? 0,
    mas_rate_date: record.rateDate ?? record.date ?? '',
    fx_rate_sgd: record.fxRateSGD ?? 0,
    total_amount_sgd: record.totalAmountSGD ?? 0,
    fx_rate_usd: record.fxRateUSD ?? 0,
    total_amount_usd: record.totalAmountUSD ?? 0,
    paid_by: record.paidBy ?? claimantName,
    fx_source: record.source ?? 'MAS',
  };
}

/**
 * Generate an Excel + CSV report from extracted receipt data.
 *
 * @param {object[]} extractedData  Array of merged extracted+FX records from the pipeline
 * @param {string}   claimantName   Name of the person submitting (default "Daniel")
 * @returns {Promise<{ xlsxPath: string, csvPath: string }>}
 */
export async function generateReport(extractedData, claimantName = 'Daniel') {
  // Write expenses JSON to a temp file
  const tmpDir = os.tmpdir();
  const expensesJson = join(tmpDir, `reimbursement_${Date.now()}.json`);
  const outputDir = join(tmpDir, `report_${Date.now()}`);

  const expenses = extractedData.map(r => toExpenseRecord(r, claimantName));
  writeFileSync(expensesJson, JSON.stringify(expenses, null, 2), 'utf8');
  mkdirSync(outputDir, { recursive: true });

  // Run the Python script
  const cmd = `python "${SCRIPT_PATH}" "${expensesJson}" "${outputDir}" "${claimantName}"`;
  const output = execSync(cmd, { encoding: 'utf8', timeout: 60_000 });

  // Parse the paths from stdout ("CSV:  ...\nXLSX: ...")
  const csvLine  = output.split('\n').find(l => l.startsWith('CSV:'));
  const xlsxLine = output.split('\n').find(l => l.startsWith('XLSX:'));

  if (!csvLine || !xlsxLine) {
    throw new Error(`Unexpected output from generate_report.py:\n${output}`);
  }

  return {
    csvPath:  csvLine.replace(/^CSV:\s+/, '').trim(),
    xlsxPath: xlsxLine.replace(/^XLSX:\s+/, '').trim(),
  };
}
