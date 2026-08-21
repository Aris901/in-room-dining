/* AUTO-GENERATED from src/money.js — do not edit.
   Regenerate with: npm run build:demo */
window.DiningMoney = (function () {
  'use strict';
/**
 * Money is stored and computed as integer kopecks (1/100 RUB) throughout.
 * Floating point never touches a price, a subtotal, or a VAT figure.
 */

const KOPECKS_PER_ROUBLE = 100;

/** Parse admin input ("1250", "1250.50", "1 250,50") into integer kopecks. */
function parseRoublesToKopecks(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * KOPECKS_PER_ROUBLE);
  }
  if (typeof input !== 'string') return null;

  const cleaned = input.trim().replace(/\s| /g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const [whole, frac = ''] = cleaned.split('.');
  const paddedFrac = frac.padEnd(2, '0');
  return Number(whole) * KOPECKS_PER_ROUBLE + Number(paddedFrac);
}

/**
 * VAT is extracted from a VAT-inclusive menu price, which is how Russian
 * consumer pricing works — the guest pays the shelf price, and the receipt
 * shows how much of it was tax.
 */
function splitVatInclusive(grossKopecks, vatPercent) {
  const gross = Math.round(grossKopecks);
  const vat = Math.round((gross * vatPercent) / (100 + vatPercent));
  return { net: gross - vat, vat, gross };
}

/** Sum line totals into subtotal / VAT / total, all in kopecks. */
function totalsFor(lines, vatPercent) {
  const gross = lines.reduce((sum, line) => sum + line.lineTotalKopecks, 0);
  const { net, vat } = splitVatInclusive(gross, vatPercent);
  return { subtotalKopecks: net, vatKopecks: vat, totalKopecks: gross };
}

/** Format kopecks for display, e.g. 125050 -> "1 250,50 ₽". */
function formatKopecks(kopecks, locale = 'ru-RU') {
  const roubles = kopecks / KOPECKS_PER_ROUBLE;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roubles);
}

/** Plain numeric string for spreadsheet cells (no symbol, dot decimal). */
function kopecksToNumber(kopecks) {
  return Number((kopecks / KOPECKS_PER_ROUBLE).toFixed(2));
}


  return { KOPECKS_PER_ROUBLE, parseRoublesToKopecks, splitVatInclusive, totalsFor, formatKopecks, kopecksToNumber };
})();
