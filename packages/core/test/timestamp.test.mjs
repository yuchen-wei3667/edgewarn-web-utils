import assert from 'node:assert/strict';
import test from 'node:test';
import { formatExpiresIn } from '../src/time/timestamp.ts';

const NOW = Date.parse('2026-09-15T12:00:00Z');
const offset = (ms) => new Date(NOW + ms).toISOString();

test('formatExpiresIn counts down minutes, hours, and days', () => {
  assert.equal(formatExpiresIn(offset(45 * 60_000), NOW), 'Expires in 45 min');
  assert.equal(formatExpiresIn(offset(60 * 60_000), NOW), 'Expires in 1 hr');
  assert.equal(formatExpiresIn(offset((2 * 60 + 15) * 60_000), NOW), 'Expires in 2 hr 15 min');
  assert.equal(formatExpiresIn(offset(24 * 60 * 60_000), NOW), 'Expires in 24 hr');
  assert.equal(formatExpiresIn(offset(50 * 60 * 60_000), NOW), 'Expires in 2 days');
});

test('formatExpiresIn handles expired and unparseable values', () => {
  assert.equal(formatExpiresIn(offset(-1_000), NOW), 'Expired');
  assert.equal(formatExpiresIn('not a date', NOW), 'Expiration unavailable');
  assert.equal(formatExpiresIn(null, NOW), 'Expiration unavailable');
  assert.equal(formatExpiresIn(undefined, NOW), 'Expiration unavailable');
});
