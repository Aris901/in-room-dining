'use strict';

const test = require('node:test');
const assert = require('node:assert');
const m = require('../src/money');

test('admin price input parses into exact kopecks', () => {
  assert.strictEqual(m.parseRoublesToKopecks('1250'), 125000);
  assert.strictEqual(m.parseRoublesToKopecks('1250.50'), 125050);
  assert.strictEqual(m.parseRoublesToKopecks('1250,50'), 125050);
  assert.strictEqual(m.parseRoublesToKopecks('1 250,50'), 125050);
  assert.strictEqual(m.parseRoublesToKopecks('0.05'), 5);
  assert.strictEqual(m.parseRoublesToKopecks(0), 0);
});

test('malformed or negative prices are rejected', () => {
  assert.strictEqual(m.parseRoublesToKopecks('abc'), null);
  assert.strictEqual(m.parseRoublesToKopecks('-5'), null);
  assert.strictEqual(m.parseRoublesToKopecks('1.234'), null);
  assert.strictEqual(m.parseRoublesToKopecks(''), null);
  assert.strictEqual(m.parseRoublesToKopecks(null), null);
});

test('0.1 + 0.2 style prices do not drift', () => {
  const lines = [
    { lineTotalKopecks: m.parseRoublesToKopecks('0.10') },
    { lineTotalKopecks: m.parseRoublesToKopecks('0.20') },
  ];
  assert.strictEqual(m.totalsFor(lines, 20).totalKopecks, 30);
});

test('VAT is extracted from a VAT-inclusive price', () => {
  // 1200 ₽ gross at 20% => 1000 ₽ net + 200 ₽ VAT
  const { net, vat, gross } = m.splitVatInclusive(120000, 20);
  assert.strictEqual(gross, 120000);
  assert.strictEqual(vat, 20000);
  assert.strictEqual(net, 100000);
});

test('net + VAT always reconstructs the gross exactly', () => {
  for (const gross of [1, 7, 99, 12345, 999999, 1000000]) {
    const { net, vat } = m.splitVatInclusive(gross, 20);
    assert.strictEqual(net + vat, gross, `rounding lost a kopeck at ${gross}`);
  }
});

test('order totals sum line items without rounding loss', () => {
  const lines = [
    { lineTotalKopecks: 45000 },
    { lineTotalKopecks: 129900 },
    { lineTotalKopecks: 7550 },
  ];
  const totals = m.totalsFor(lines, 20);
  assert.strictEqual(totals.totalKopecks, 182450);
  assert.strictEqual(totals.subtotalKopecks + totals.vatKopecks, totals.totalKopecks);
});

test('formatting produces roubles for display and plain numbers for Excel', () => {
  assert.match(m.formatKopecks(125050), /1\s?250,50/);
  assert.strictEqual(m.kopecksToNumber(125050), 1250.5);
});
