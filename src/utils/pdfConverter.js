import { execSync } from 'child_process';
import { dirname, basename, join } from 'path';

/**
 * Convert an xlsx file to PDF using LibreOffice headless mode.
 *
 * @param {string} xlsxPath  Absolute path to the .xlsx file
 * @returns {Promise<string|null>}  Path to the generated PDF, or null if LibreOffice unavailable
 */
export async function convertToPdf(xlsxPath) {
  const outDir = dirname(xlsxPath);
  const baseName = basename(xlsxPath, '.xlsx');
  const pdfPath = join(outDir, `${baseName}.pdf`);

  try {
    const cmd = `libreoffice --headless --convert-to pdf --outdir "${outDir}" "${xlsxPath}"`;
    execSync(cmd, { encoding: 'utf8', timeout: 60_000 });
    return pdfPath;
  } catch (err) {
    // libreoffice might not be installed; log and degrade gracefully
    console.warn('PDF conversion skipped — LibreOffice not available:', err.message);
    return null;
  }
}
