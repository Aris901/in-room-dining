'use strict';

const crypto = require('crypto');

/**
 * SIMULATED payment gateway.
 *
 * This module fakes card authorisation for a portfolio demo. It performs no
 * network call, contacts no acquirer, and moves no money. It exists to model
 * the *shape* of a real integration so that swapping in Stripe / CloudPayments
 * / YooKassa means replacing this one file.
 *
 * What it deliberately does NOT do, and what a real integration must do:
 *   - Card data must never reach this server at all. A real build collects the
 *     PAN in a PSP-hosted iframe or SDK, so the server only ever sees a token.
 *     That is what keeps the app out of PCI-DSS scope; the moment raw PANs hit
 *     your server you inherit the full SAQ-D burden.
 *   - 3-D Secure 2.0 requires a real challenge redirect and a signed callback.
 *   - Authorisation results must be reconciled against the PSP by webhook, not
 *     trusted from the browser.
 *
 * Accordingly this function accepts only a *test card selector*, never a real
 * card number, so a guest cannot enter genuine card details anywhere.
 */

/** Test cards the demo UI offers. No real card is ever accepted. */
const TEST_CARDS = {
  approved: { last4: '4242', outcome: 'approved', label_en: 'Approved', label_ru: 'Успешно' },
  challenge: {
    last4: '3155',
    outcome: 'approved',
    requires3ds: true,
    label_en: 'Approved after 3-D Secure', label_ru: 'Успешно после 3-D Secure',
  },
  declined: { last4: '0002', outcome: 'declined', label_en: 'Declined', label_ru: 'Отклонено' },
  insufficient: {
    last4: '9995', outcome: 'declined',
    label_en: 'Insufficient funds', label_ru: 'Недостаточно средств',
  },
};

function listTestCards() {
  return Object.entries(TEST_CARDS).map(([id, c]) => ({
    id,
    last4: c.last4,
    requires3ds: Boolean(c.requires3ds),
    label_en: c.label_en,
    label_ru: c.label_ru,
  }));
}

/**
 * "Authorise" a payment.
 * @returns {{approved: boolean, last4?: string, authCode?: string, declineReason?: string}}
 */
function authorise({ testCardId, amountKopecks }) {
  const card = TEST_CARDS[testCardId];

  if (!card) return { approved: false, declineReason: 'invalid_card' };
  if (!Number.isInteger(amountKopecks) || amountKopecks <= 0) {
    return { approved: false, declineReason: 'invalid_amount' };
  }

  if (card.outcome !== 'approved') {
    return { approved: false, last4: card.last4, declineReason: testCardId };
  }

  return {
    approved: true,
    last4: card.last4,
    // Shaped like an acquirer auth code; meaningless outside this demo.
    authCode: crypto.randomBytes(3).toString('hex').toUpperCase(),
    threeDsPerformed: Boolean(card.requires3ds),
  };
}

/** Opaque token a guest presents at reception for a cash order. */
function createVoucherToken() {
  return crypto.randomBytes(9).toString('base64url').toUpperCase().replace(/[_-]/g, '0');
}

module.exports = { TEST_CARDS, listTestCards, authorise, createVoucherToken };
