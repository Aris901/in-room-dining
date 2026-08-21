'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { config } = require('./../config');
const { formatKopecks } = require('./../money');
const { t, normaliseLang } = require('./../i18n');
const { MEALS } = require('./../time');

/**
 * Receipt / voucher PDF generation.
 *
 * PDF base-14 fonts are Latin-only, so Cyrillic receipts require an embedded
 * TrueType face. DejaVu is bundled for that. If the font is ever missing we
 * fall back to Helvetica and force the document to English rather than
 * silently emitting a receipt full of blank boxes.
 */

const REGULAR = path.join(config.paths.fonts, 'DejaVuSans.ttf');
const BOLD = path.join(config.paths.fonts, 'DejaVuSans-Bold.ttf');

const hasUnicodeFonts = fs.existsSync(REGULAR) && fs.existsSync(BOLD);

const INK = '#101828';
const MUTED = '#667085';
const NAVY = '#1B2A4A';
const GOLD = '#B8860B';
const RULE = '#D8DCE5';

function fonts(doc) {
  if (hasUnicodeFonts) {
    doc.registerFont('body', REGULAR);
    doc.registerFont('bold', BOLD);
    return { body: 'body', bold: 'bold' };
  }
  return { body: 'Helvetica', bold: 'Helvetica-Bold' };
}

function formatInstant(iso, lang) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', {
    timeZone: config.hotelTimeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/**
 * @param {object} order  order row joined with its items
 * @returns {PDFDocument} a readable stream the caller pipes to the response
 */
function buildReceipt(order) {
  // If the bundled font is missing we cannot render Cyrillic at all, so the
  // document is produced in English rather than as unreadable glyph boxes.
  const lang = hasUnicodeFonts ? normaliseLang(order.lang) : 'en';
  const isCash = order.payment_method === 'cash';
  const isPaid = order.status === 'paid';

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const f = fonts(doc);
  const left = 50;
  const right = doc.page.width - 50;
  const width = right - left;

  // ---- header ----------------------------------------------------------
  doc.font(f.bold).fontSize(20).fillColor(NAVY).text(config.hotel.name, left, 50);
  doc.font(f.body).fontSize(9).fillColor(MUTED).text(config.hotel.address, left);
  doc.text(config.hotel.phone, left);

  doc
    .font(f.bold)
    .fontSize(15)
    .fillColor(isPaid ? INK : GOLD)
    .text(t(lang, isPaid ? 'receipt.title' : 'receipt.voucherTitle'), left, 50, {
      width,
      align: 'right',
    });

  doc.moveDown(1.4);
  const ruleY = doc.y;
  doc.moveTo(left, ruleY).lineTo(right, ruleY).strokeColor(RULE).lineWidth(1).stroke();
  doc.moveDown(1);

  // ---- meta ------------------------------------------------------------
  const meal = MEALS[order.meal];
  const rows = [
    [t(lang, 'receipt.orderId'), order.public_id],
    [t(lang, 'receipt.room'), order.room_number],
    [t(lang, 'receipt.guest'), order.guest_name],
    [t(lang, 'receipt.serviceDate'), order.service_date],
    [
      t(lang, 'receipt.meal'),
      `${t(lang, `meal.${order.meal}`)} (${meal.serviceStart}–${meal.serviceEnd})`,
    ],
    [
      t(lang, 'receipt.method'),
      t(lang, isCash ? 'receipt.methodCash' : 'receipt.methodCard'),
    ],
  ];

  if (!isCash && order.card_last4) {
    rows.push([t(lang, 'receipt.card'), `•••• ${order.card_last4}`]);
    if (order.auth_code) rows.push([t(lang, 'receipt.authCode'), order.auth_code]);
  }
  if (isCash && order.voucher_token) {
    rows.push([t(lang, 'receipt.voucherToken'), order.voucher_token]);
  }
  rows.push([
    t(lang, isPaid ? 'receipt.paidAt' : 'receipt.issued'),
    formatInstant(isPaid ? order.paid_at : order.created_at, lang),
  ]);

  doc.fontSize(10);
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.font(f.body).fillColor(MUTED).text(label, left, y, { width: 150 });
    doc.font(f.bold).fillColor(INK).text(String(value), left + 155, y, { width: width - 155 });
    doc.moveDown(0.35);
  }

  doc.moveDown(0.8);

  // ---- items table -----------------------------------------------------
  const colQty = right - 190;
  const colUnit = right - 140;
  const colTotal = right - 70;

  const headY = doc.y;
  doc.font(f.bold).fontSize(9).fillColor(MUTED);
  doc.text(t(lang, 'receipt.item'), left, headY, { width: colQty - left - 10 });
  doc.text(t(lang, 'receipt.qty'), colQty, headY, { width: 40, align: 'right' });
  doc.text(t(lang, 'receipt.unitPrice'), colUnit, headY, { width: 60, align: 'right' });
  doc.text(t(lang, 'receipt.lineTotal'), colTotal, headY, { width: 70, align: 'right' });

  doc.moveDown(0.5);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor(RULE).stroke();
  doc.moveDown(0.5);

  doc.fontSize(10);
  for (const item of order.items) {
    const title = lang === 'ru' ? item.title_ru : item.title_en;
    const y = doc.y;
    doc.font(f.body).fillColor(INK).text(title, left, y, { width: colQty - left - 10 });
    const rowEnd = doc.y;
    doc.text(String(item.qty), colQty, y, { width: 40, align: 'right' });
    doc.text(formatKopecks(item.unit_price_kopecks), colUnit, y, { width: 60, align: 'right' });
    doc.font(f.bold).text(formatKopecks(item.line_total_kopecks), colTotal, y, {
      width: 70,
      align: 'right',
    });
    doc.y = Math.max(rowEnd, doc.y);
    doc.moveDown(0.35);
  }

  doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor(RULE).stroke();
  doc.moveDown(0.6);

  // ---- totals ----------------------------------------------------------
  const totalLine = (label, value, emphasis = false) => {
    const y = doc.y;
    doc
      .font(emphasis ? f.bold : f.body)
      .fontSize(emphasis ? 12 : 10)
      .fillColor(emphasis ? INK : MUTED)
      .text(label, colUnit - 120, y, { width: 180, align: 'right' });
    doc
      .font(f.bold)
      .fontSize(emphasis ? 12 : 10)
      .fillColor(emphasis ? NAVY : INK)
      .text(value, colTotal - 10, y, { width: 80, align: 'right' });
    doc.moveDown(0.4);
  };

  totalLine(t(lang, 'receipt.subtotal'), formatKopecks(order.subtotal_kopecks));
  totalLine(`${t(lang, 'receipt.vat')} ${order.vat_percent}%`, formatKopecks(order.vat_kopecks));
  totalLine(
    t(lang, isPaid ? 'receipt.total' : 'receipt.totalDue'),
    formatKopecks(order.total_kopecks),
    true
  );

  doc.moveDown(1);

  // ---- cash instructions ----------------------------------------------
  if (isCash && !isPaid) {
    const boxTop = doc.y;
    doc.font(f.bold).fontSize(11).fillColor(GOLD);
    doc.text(t(lang, 'receipt.cashInstruction'), left + 14, boxTop + 12, { width: width - 28 });
    doc.font(f.body).fontSize(9).fillColor(MUTED);
    doc.text(t(lang, 'receipt.cashPending'), left + 14, doc.y + 4, { width: width - 28 });
    const boxBottom = doc.y + 12;
    doc
      .roundedRect(left, boxTop, width, boxBottom - boxTop, 6)
      .strokeColor(GOLD)
      .lineWidth(1)
      .stroke();
    doc.y = boxBottom + 14;

    if (order.voucher_token) drawBarcode(doc, order.voucher_token, left, doc.y, width, f);
  }

  // ---- footer ----------------------------------------------------------
  const footerY = doc.page.height - 90;
  doc.moveTo(left, footerY).lineTo(right, footerY).strokeColor(RULE).stroke();
  doc.font(f.body).fontSize(9).fillColor(MUTED);
  doc.text(t(lang, 'receipt.thanks'), left, footerY + 10, { width });
  if (config.paymentsAreSimulated) {
    doc.font(f.bold).fontSize(8).fillColor(GOLD);
    doc.text(t(lang, 'receipt.demoNotice'), left, footerY + 26, { width });
  }

  doc.end();
  return doc;
}

/**
 * A Code-39 style barcode rendered from the voucher token.
 * Decorative-but-plausible: reception scans or simply reads the token beneath.
 */
function drawBarcode(doc, token, x, y, width, f) {
  const height = 42;
  let cursor = x;
  const maxX = x + width;
  doc.fillColor('#000');

  // Deterministic bar pattern derived from the token's own characters.
  for (let i = 0; i < token.length && cursor < maxX - 4; i++) {
    const code = token.charCodeAt(i);
    for (let bit = 0; bit < 4 && cursor < maxX - 4; bit++) {
      const wide = (code >> bit) & 1;
      const barWidth = wide ? 3 : 1.4;
      doc.rect(cursor, y, barWidth, height).fill();
      cursor += barWidth + 1.6;
    }
  }

  doc
    .font(f.body)
    .fontSize(11)
    .fillColor('#101828')
    .text(token, x, y + height + 6, { width, align: 'left', characterSpacing: 2 });
  doc.moveDown(0.5);
}

module.exports = { buildReceipt, hasUnicodeFonts };
