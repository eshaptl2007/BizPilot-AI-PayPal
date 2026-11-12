import test from 'node:test';
import assert from 'node:assert/strict';
import { hashToken, newResetToken, normalizePhone, passwordProblem } from '../src/utils/validation.js';

test('normalizePhone accepts common formats and rejects junk', () => {
  assert.equal(normalizePhone('+91 98765-43210'), '+919876543210');
  assert.equal(normalizePhone('(987) 654-3210'), '9876543210');
  assert.equal(normalizePhone('0091 9876543210'), '+919876543210');
  assert.equal(normalizePhone('98765abc10'), null);
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('1234567890123456'), null); // 16 digits
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(undefined), null);
});

test('normalized phones satisfy the database CHECK pattern', () => {
  const db = /^\+?[0-9]{7,15}$/;
  for (const raw of ['+91 98765 43210', '9876543210', '+1 (555) 010-9999']) assert.ok(db.test(normalizePhone(raw)));
});

test('passwordProblem enforces length, letter and number', () => {
  assert.match(passwordProblem('short1'), /at least 8/);
  assert.match(passwordProblem('onlyletters'), /letter and one number/);
  assert.match(passwordProblem('12345678'), /letter and one number/);
  assert.match(passwordProblem('x'.repeat(101) + '1'), /too long/);
  assert.equal(passwordProblem('Demo@1234'), null);
  assert.equal(passwordProblem(undefined) !== null, true);
});

test('reset tokens are random, long, and hashed deterministically', () => {
  const a = newResetToken(), b = newResetToken();
  assert.notEqual(a, b);
  assert.equal(a.length, 64);
  assert.equal(hashToken(a), hashToken(a));
  assert.notEqual(hashToken(a), a);
  assert.match(hashToken(a), /^[0-9a-f]{64}$/);
});
