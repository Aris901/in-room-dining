'use strict';

const ExcelJS = require('exceljs');
const { config } = require('./../config');
const { kopecksToNumber } = require('./../money');
const { MEALS } = require('./../time');

/**
 * Excel order summary for a completed meal window.
 *
 * Money is written as real numbers with a rouble format string, not as text,
 * so the kitchen/finance team can sum and pivot the sheet directly.
 */

const NAVY = 'FF1B2A4A';
const GOLD = 'FFB8860B';
const LIGHT = 'FFF3F4F7';

function fmtInstant(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: config.hotelTimeZone,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(iso));
}

const RUB_FORMAT = '#,##0.00\\ "₽"';

/**
 * @param {{serviceDate:string, meal:string, orders:Array}} params
 * @returns {Promise<Buffer>}
 */
async function buildOrderSummary({ serviceDate, meal, orders }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = config.hotel.name;
  wb.created = new Date();

  const mealDef = MEALS[meal];
  const sheet = wb.addWorksheet(`${meal} ${serviceDate}`, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 6 }],
  });

  sheet.columns = [
    { key: 'room', width: 10 },
    { key: 'guest', width: 26 },
    { key: 'items', width: 46 },
    { key: 'qty', width: 8 },
    { key: 'method', width: 20 },
    { key: 'status', width: 16 },
    { key: 'total', width: 14 },
    { key: 'ordered', width: 20 },
    { key: 'paid', width: 20 },
  ];

  // ---- title block -----------------------------------------------------
  sheet.mergeCells('A1:I1');
  const title = sheet.getCell('A1');
  title.value = `${config.hotel.name} — In-Room Dining`;
  title.font = { size: 16, bold: true, color: { argb: NAVY } };
  sheet.getRow(1).height = 24;

  sheet.mergeCells('A2:I2');
  const subtitle = sheet.getCell('A2');
  subtitle.value =
    `${meal.toUpperCase()} · ${serviceDate} · served ${mealDef.serviceStart}–${mealDef.serviceEnd} ` +
    `(${config.hotelTimeZone})`;
  subtitle.font = { size: 11, color: { argb: 'FF667085' } };

  sheet.mergeCells('A3:I3');
  const generated = sheet.getCell('A3');
  generated.value = `Generated ${fmtInstant(new Date().toISOString())}`;
  generated.font = { size: 9, italic: true, color: { argb: 'FF98A2B3' } };

  sheet.addRow([]);

  // ---- header row ------------------------------------------------------
  const header = sheet.addRow({
    room: 'Room',
    guest: 'Guest name',
    items: 'Ordered items',
    qty: 'Items',
    method: 'Payment method',
    status: 'Payment status',
    total: 'Total (₽)',
    ordered: 'Ordered at',
    paid: 'Paid at',
  });
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.alignment = { vertical: 'middle' };
  header.height = 20;
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  });

  // ---- data ------------------------------------------------------------
  let revenuePaid = 0;
  let revenuePending = 0;

  for (const order of orders) {
    const itemText = order.items
      .map((i) => `${i.qty} × ${i.title_en}`)
      .join('\n');
    const itemCount = order.items.reduce((sum, i) => sum + i.qty, 0);
    const isPaid = order.status === 'paid';

    if (isPaid) revenuePaid += order.total_kopecks;
    else revenuePending += order.total_kopecks;

    const row = sheet.addRow({
      room: order.room_number,
      guest: order.guest_name,
      items: itemText,
      qty: itemCount,
      method: order.payment_method === 'card' ? 'Card (online)' : 'Cash at reception',
      status: isPaid ? 'PAID' : 'PENDING RECEPTION',
      total: kopecksToNumber(order.total_kopecks),
      ordered: fmtInstant(order.created_at),
      paid: fmtInstant(order.paid_at),
    });

    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell('total').numFmt = RUB_FORMAT;
    row.getCell('status').font = {
      bold: true,
      color: { argb: isPaid ? 'FF067647' : GOLD },
    };
    if (!isPaid) {
      row.getCell('status').fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4E5' },
      };
    }
  }

  if (orders.length === 0) {
    const empty = sheet.addRow({ room: '—', guest: 'No orders for this service window' });
    empty.font = { italic: true, color: { argb: 'FF98A2B3' } };
  }

  // ---- totals ----------------------------------------------------------
  sheet.addRow([]);

  const addTotal = (label, kopecks, emphasis = false) => {
    const row = sheet.addRow({ method: label, total: kopecksToNumber(kopecks) });
    row.getCell('method').font = { bold: emphasis, color: { argb: emphasis ? NAVY : 'FF667085' } };
    row.getCell('method').alignment = { horizontal: 'right' };
    const totalCell = row.getCell('total');
    totalCell.numFmt = RUB_FORMAT;
    totalCell.font = { bold: true, size: emphasis ? 12 : 11, color: { argb: emphasis ? NAVY : 'FF101828' } };
    if (emphasis) {
      totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
      totalCell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    }
    return row;
  };

  addTotal('Collected (card)', revenuePaid);
  addTotal('Awaiting reception (cash)', revenuePending);
  addTotal('Total revenue', revenuePaid + revenuePending, true);

  sheet.addRow([]);
  const note = sheet.addRow({
    room: config.paymentsAreSimulated
      ? 'Demo data — payments are simulated; no funds were transferred.'
      : '',
  });
  note.font = { italic: true, size: 9, color: { argb: GOLD } };

  return wb.xlsx.writeBuffer();
}

module.exports = { buildOrderSummary };
