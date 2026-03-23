export const SIGNERS = [
  {
    order: 1,
    email: process.env.SIGNER_1_EMAIL,
    name: process.env.SIGNER_1_NAME,
  },
  {
    order: 2,
    email: process.env.SIGNER_2_EMAIL,
    name: process.env.SIGNER_2_NAME,
  },
  {
    order: 3,
    email: process.env.SIGNER_3_EMAIL,
    name: process.env.SIGNER_3_NAME,
  },
  {
    order: 4,
    email: process.env.SIGNER_4_EMAIL,
    name: process.env.SIGNER_4_NAME,
  },
];

export const EXPENSE_CATEGORIES = [
  'Meals/Entertainment',
  'Transportation',
  'Hotel',
  'Flight Ticket',
  'Other',
];

export const CONFIDENCE_THRESHOLD = 0.8;

export const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

export const MAS_RATES_URL =
  'https://eservices.mas.gov.sg/Statistics/msb/ExchangeRates.aspx';

export const FALLBACK_FX_URL = 'https://open.er-api.com/v6/latest';

/** MAS currency column labels → ISO codes */
export const MAS_CURRENCY_MAP = {
  'US Dollar': 'USD',
  'Sterling Pound': 'GBP',
  Euro: 'EUR',
  'Japanese Yen': 'JPY',
  'Swiss Franc': 'CHF',
  'Australian Dollar': 'AUD',
  'Canadian Dollar': 'CAD',
  'Hong Kong Dollar': 'HKD',
  'Malaysian Ringgit': 'MYR',
  'New Zealand Dollar': 'NZD',
  'Taiwan Dollar': 'TWD',
  'Chinese Renminbi': 'RMB',
  'Indonesian Rupiah': 'IDR',
  'Indian Rupee': 'INR',
  'Korean Won': 'KRW',
  'Saudi Arabian Riyal': 'SAR',
  'Thai Baht': 'THB',
  'UAE Dirham': 'AED',
  'Brunei Dollar': 'BND',
  'Philippine Peso': 'PHP',
  'Vietnamese Dong': 'VND',
};
