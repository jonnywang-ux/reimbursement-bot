import * as cheerio from 'cheerio';
import { MAS_CURRENCY_MAP, MAS_RATES_URL, FALLBACK_FX_URL } from '../config/constants.js';
import { withRetry } from '../utils/retry.js';
import { log, warn, error } from '../utils/logger.js';

/** Cache: date string "YYYY-MM-DD" → { [isoCode]: sgdPerUnit } */
const rateCache = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Date as "YYYY-MM-DD" */
function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

/** Return the most recent weekday on or before the given date string */
function mostRecentWeekday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return toDateStr(d);
}

// ---------------------------------------------------------------------------
// MAS scraper
// ---------------------------------------------------------------------------

/**
 * Attempt to scrape MAS exchange rates for a given date.
 * Returns parsed rate map or null on failure.
 *
 * @param {string} dateStr "YYYY-MM-DD"
 * @returns {Promise<{ [isoCode: string]: number } | null>}
 */
async function scrapeMasRates(dateStr) {
  try {
    const [year, month, day] = dateStr.split('-');
    const masDate = `${day}/${month}/${year}`;

    const pageRes = await fetch(MAS_RATES_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReimbursementBot/1.0)' },
    });

    if (!pageRes.ok) throw new Error(`MAS page HTTP ${pageRes.status}`);

    const html = await pageRes.text();
    const $ = cheerio.load(html);

    const viewState = $('input[name="__VIEWSTATE"]').val() ?? '';
    const viewStateGenerator = $('input[name="__VIEWSTATEGENERATOR"]').val() ?? '';
    const eventValidation = $('input[name="__EVENTVALIDATION"]').val() ?? '';
    const cookies = pageRes.headers.get('set-cookie') ?? '';

    const formData = new URLSearchParams({
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGenerator,
      __EVENTVALIDATION: eventValidation,
      __EVENTTARGET: '',
      __EVENTARGUMENT: '',
      'ctl00$ContentPlaceHolder1$txtDate': masDate,
      'ctl00$ContentPlaceHolder1$btnDownload': 'Download',
    });

    const csvRes = await fetch(MAS_RATES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; ReimbursementBot/1.0)',
        Cookie: cookies,
      },
      body: formData.toString(),
    });

    if (!csvRes.ok) throw new Error(`MAS CSV HTTP ${csvRes.status}`);

    const contentType = csvRes.headers.get('content-type') ?? '';
    if (!contentType.includes('csv') && !contentType.includes('octet-stream')) {
      return null;
    }

    const csv = await csvRes.text();
    return parseMasCsv(csv);
  } catch (err) {
    warn('MAS scrape failed', { dateStr, reason: err.message });
    return null;
  }
}

/**
 * Parse MAS CSV into a { [isoCode]: sgdPerUnit } map.
 */
function parseMasCsv(csv) {
  const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
  const rates = {};

  for (const line of lines) {
    const cols = line.split(',').map(c => c.replace(/"/g, '').trim());
    if (cols.length < 2) continue;

    const currencyName = cols[0];
    const isoCode = MAS_CURRENCY_MAP[currencyName];
    if (!isoCode) continue;

    const rate = parseFloat(cols[1]);
    if (isNaN(rate) || rate <= 0) continue;

    rates[isoCode] = rate;
  }

  return Object.keys(rates).length > 0 ? rates : null;
}

// ---------------------------------------------------------------------------
// Fallback: open.er-api.com
// ---------------------------------------------------------------------------

/**
 * Fetch rates via open.er-api.com (free, no key) and convert to SGD-per-unit.
 */
async function fetchFallbackRates(currency) {
  const [usdRes, currencyRes] = await Promise.all([
    fetch(`${FALLBACK_FX_URL}/USD`),
    currency !== 'USD' ? fetch(`${FALLBACK_FX_URL}/${currency}`) : Promise.resolve(null),
  ]);

  if (!usdRes.ok) throw new Error(`Fallback FX API HTTP ${usdRes.status}`);

  const usdData = await usdRes.json();
  const sgdPerUsd = usdData.rates?.SGD;
  if (!sgdPerUsd) throw new Error('Fallback FX: no SGD rate found');

  const rates = { USD: sgdPerUsd };

  if (currency !== 'USD' && currencyRes?.ok) {
    const currencyData = await currencyRes.json();
    const usdPerUnit = currencyData.rates?.USD;
    if (usdPerUnit) {
      rates[currency] = usdPerUnit * sgdPerUsd;
    }
  }

  return rates;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the MAS SGD-per-unit rate for a currency on a given date.
 * Walks backward up to 7 days to find a weekday with data.
 * Falls back to open.er-api.com if MAS is unavailable.
 *
 * @param {string} dateStr "YYYY-MM-DD"
 * @param {string} currency ISO code (e.g. "USD", "RMB")
 * @returns {Promise<{ date: string, rateDate: string, sgdPerUnit: number, source: string }>}
 */
export async function getMasRate(dateStr, currency) {
  const isoCode = currency === 'CNY' ? 'RMB' : currency;

  let candidateDate = mostRecentWeekday(dateStr);
  let rates = null;
  let source = 'MAS';

  for (let attempt = 0; attempt < 7; attempt++) {
    if (rateCache.has(candidateDate)) {
      rates = rateCache.get(candidateDate);
      break;
    }

    // Retry MAS scrape up to 2 times for transient failures
    const scraped = await withRetry(() => scrapeMasRates(candidateDate), 2, 1500)
      .catch(() => null);

    if (scraped) {
      rateCache.set(candidateDate, scraped);
      rates = scraped;
      break;
    }

    // Move one day earlier
    const d = new Date(`${candidateDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    candidateDate = mostRecentWeekday(toDateStr(d));
  }

  if (!rates || !rates[isoCode]) {
    warn('MAS rates unavailable, trying fallback', { isoCode, dateStr });
    source = 'fallback';

    let fallback;
    try {
      fallback = await withRetry(() => fetchFallbackRates(isoCode), 2, 1500);
    } catch (err) {
      error('Both MAS and fallback FX failed', err, { isoCode, dateStr });
      throw new Error(
        `FX rate unavailable for ${isoCode} on ${dateStr}. Both MAS and fallback API failed. ` +
        'Please provide the SGD exchange rate manually.',
      );
    }

    if (!fallback[isoCode]) {
      throw new Error(`No FX rate found for ${isoCode} on ${dateStr}`);
    }

    log('MAS rate fetched', { isoCode, dateStr, source: 'fallback', rate: fallback[isoCode] });
    return {
      date: dateStr,
      rateDate: new Date().toISOString().slice(0, 10),
      sgdPerUnit: fallback[isoCode],
      source,
    };
  }

  const sgdPerUnit = rates[isoCode];
  if (!sgdPerUnit) {
    throw new Error(`MAS has no rate for ${isoCode} on ${candidateDate}`);
  }

  log('MAS rate fetched', { isoCode, dateStr, rateDate: candidateDate, source: 'MAS', rate: sgdPerUnit });
  return {
    date: dateStr,
    rateDate: candidateDate,
    sgdPerUnit,
    source,
  };
}

/**
 * Convert an amount in a foreign currency to SGD and USD using MAS rates.
 *
 * @param {number} originalAmount
 * @param {string} originalCurrency ISO code
 * @param {string} rateDate "YYYY-MM-DD"
 * @returns {Promise<{ totalAmountSGD, totalAmountUSD, fxRateSGD, fxRateUSD, rateDate, source }>}
 */
export async function convertAmount(originalAmount, originalCurrency, rateDate) {
  const isoCode = originalCurrency === 'CNY' ? 'RMB' : originalCurrency;

  let totalAmountSGD;
  let totalAmountUSD;
  let fxRateSGD;
  let fxRateUSD;
  let source;
  let actualRateDate;

  if (isoCode === 'SGD') {
    const usdRate = await getMasRate(rateDate, 'USD');
    totalAmountSGD = originalAmount;
    totalAmountUSD = originalAmount / usdRate.sgdPerUnit;
    fxRateSGD = 1;
    fxRateUSD = usdRate.sgdPerUnit;
    source = usdRate.source;
    actualRateDate = usdRate.rateDate;
  } else if (isoCode === 'USD') {
    const usdRate = await getMasRate(rateDate, 'USD');
    totalAmountSGD = originalAmount * usdRate.sgdPerUnit;
    totalAmountUSD = originalAmount;
    fxRateSGD = usdRate.sgdPerUnit;
    fxRateUSD = usdRate.sgdPerUnit;
    source = usdRate.source;
    actualRateDate = usdRate.rateDate;
  } else {
    const [foreignRate, usdRate] = await Promise.all([
      getMasRate(rateDate, isoCode),
      getMasRate(rateDate, 'USD'),
    ]);
    totalAmountSGD = originalAmount * foreignRate.sgdPerUnit;
    totalAmountUSD = totalAmountSGD / usdRate.sgdPerUnit;
    fxRateSGD = foreignRate.sgdPerUnit;
    fxRateUSD = usdRate.sgdPerUnit;
    source = foreignRate.source === 'fallback' || usdRate.source === 'fallback'
      ? 'fallback'
      : 'MAS';
    actualRateDate = foreignRate.rateDate;
  }

  return {
    totalAmountSGD: Math.round(totalAmountSGD * 100) / 100,
    totalAmountUSD: Math.round(totalAmountUSD * 100) / 100,
    fxRateSGD,
    fxRateUSD,
    rateDate: actualRateDate,
    source,
  };
}
