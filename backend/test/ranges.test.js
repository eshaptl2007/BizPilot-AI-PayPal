import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketFor, computeRanges } from '../src/services/ranges.js';
import { formatMoney, toChargeAmount } from '../src/utils/money.js';
import { pivotStock } from '../src/services/stock.js';

const labels = (r) => r.options.map((o) => o.label);
const h = (days) => days * 24;

test('bucketFor: hourly up to 3 days, daily to a month, weekly to ~6 months, then monthly', () => {
  assert.equal(bucketFor(6), 'hour');
  assert.equal(bucketFor(24), 'hour');
  assert.equal(bucketFor(72), 'hour');
  assert.equal(bucketFor(h(7)), 'day');
  assert.equal(bucketFor(h(30)), 'day');
  assert.equal(bucketFor(h(90)), 'week');
  assert.equal(bucketFor(h(180)), 'week');
  assert.equal(bucketFor(h(365)), 'month');
});

test('tier 1: account under a week -> hourly ranges, default 24H', () => {
  for (const tenure of [0, 2, 30, h(3), h(6.5)]) {
    const r = computeRanges(tenure);
    assert.equal(r.tier, 'hours');
    assert.equal(r.defaultKey, '24h');
    assert.ok(r.options.every((o) => o.bucket === 'hour'));
    assert.deepEqual(labels(r).slice(0, 3), ['6H', '12H', '24H']);
  }
  assert.deepEqual(labels(computeRanges(2)), ['6H', '12H', '24H']);          // brand-new user
  assert.deepEqual(labels(computeRanges(h(3))), ['6H', '12H', '24H', '48H', '72H']);
});

test('tier 2: one week to one month -> 1D, 1W, 2W... up to the history', () => {
  assert.deepEqual(labels(computeRanges(h(7))), ['1D', '1W']);
  assert.deepEqual(labels(computeRanges(h(16))), ['1D', '1W', '2W', 'All time']);
  const r = computeRanges(h(25));
  assert.equal(r.tier, 'weeks');
  assert.deepEqual(labels(r), ['1D', '1W', '2W', '3W', 'All time']); // 25 days of history -> shows the full span too
  assert.equal(r.defaultKey, '1w');
  assert.equal(r.options.find((o) => o.key === '1d').bucket, 'hour');
  assert.equal(r.options.find((o) => o.key === '1w').bucket, 'day');
});

test('tier 3: months -> 1D 1W 1M ... up to the history', () => {
  assert.deepEqual(labels(computeRanges(h(45))), ['1D', '1W', '1M', 'All time']);
  const r = computeRanges(h(90.2));
  assert.equal(r.tier, 'months');
  assert.deepEqual(labels(r), ['1D', '1W', '1M', '2M', '3M']);
  assert.equal(r.defaultKey, '1m');
  assert.equal(r.options.find((o) => o.key === '3m').bucket, 'week');
  assert.deepEqual(labels(computeRanges(h(300))), ['1D', '1W', '1M', '2M', '3M', '6M', '9M', 'All time']);
});

test('tier 4: years -> adds 1Y, 2Y ...', () => {
  const r = computeRanges(h(800));
  assert.equal(r.tier, 'years');
  assert.deepEqual(labels(r), ['1D', '1W', '1M', '3M', '6M', '1Y', '2Y', 'All time']);
  assert.equal(r.defaultKey, '1y');
  assert.equal(r.defaultHours, h(365));
  assert.equal(r.options.find((o) => o.key === '1y').bucket, 'month');
  assert.ok(labels(computeRanges(h(2000))).includes('5Y'));
});

test('options never exceed the history by more than a day, and always include the default', () => {
  for (const d of [0.1, 1, 6.9, 7, 13, 29.9, 30, 89, 200, 364, 365, 1000, 4000]) {
    const r = computeRanges(h(d));
    assert.ok(r.options.some((o) => o.key === r.defaultKey), `default present for ${d}d`);
    for (const o of r.options.slice(1)) assert.ok(o.hours <= h(d) + 24 + 24, `${o.label} fits ${d}d`);
  }
});

test('formatMoney: INR uses rupee sign and Indian digit grouping', () => {
  assert.equal(formatMoney(250, 'INR'), '₹250');
  assert.equal(formatMoney(5.5, 'INR'), '₹5.50');
  assert.equal(formatMoney(123456.5, 'INR'), '₹1,23,456.50');
  assert.equal(formatMoney(1234567, 'INR'), '₹12,34,567');
  assert.equal(formatMoney(12.5, 'USD'), '$12.50');
  assert.ok(!formatMoney(1000, 'INR').includes('$'));
});

test('toChargeAmount: INR to USD in cents, never zero', () => {
  assert.equal(toChargeAmount(880, 88), 10);
  assert.equal(toChargeAmount(250, 88), 2.84);
  assert.equal(toChargeAmount(0.5, 88), 0.01);   // tiny prices still charge one cent, not zero
  assert.equal(toChargeAmount(42.7, 1), 42.7);   // same currency: rate 1
});

test('pivotStock: top products + Others, aligned to the series buckets', () => {
  const series = [{ bucket: 'b1' }, { bucket: 'b2' }, { bucket: 'b3' }];
  const rows = [
    { bucket: 'b1', product_name: 'A', units: '5' }, { bucket: 'b1', product_name: 'B', units: '1' },
    { bucket: 'b2', product_name: 'A', units: '2' }, { bucket: 'b2', product_name: 'C', units: '9' },
  ];
  const out = pivotStock(series, rows, 2);
  assert.deepEqual(out.products, ['C', 'A', 'Others']);
  assert.deepEqual(out.rows[0], { bucket: 'b1', C: 0, A: 5, Others: 1 });
  assert.deepEqual(out.rows[2], { bucket: 'b3', C: 0, A: 0, Others: 0 }); // empty bucket kept
  assert.deepEqual(pivotStock(series, [], 2), { products: [], rows: series.map((s) => ({ bucket: s.bucket })) });
});
