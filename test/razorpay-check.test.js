const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

function createSignature(orderId, paymentId, keySecret) {
  return crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

function verifySignature(orderId, paymentId, signature, keySecret) {
  return createSignature(orderId, paymentId, keySecret) === signature;
}

test('signature verification matches Razorpay format', () => {
  const orderId = 'order_test_123';
  const paymentId = 'pay_test_123';
  const keySecret = 'test_secret';
  const signature = createSignature(orderId, paymentId, keySecret);
  assert.equal(verifySignature(orderId, paymentId, signature, keySecret), true);
});

test('signature verification rejects mismatches', () => {
  const orderId = 'order_test_123';
  const paymentId = 'pay_test_123';
  const keySecret = 'test_secret';
  const signature = 'wrong_signature';
  assert.equal(verifySignature(orderId, paymentId, signature, keySecret), false);
});
