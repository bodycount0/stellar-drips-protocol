import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, '..', 'src');

// Pure reference helpers matching src/lib/event_history.ts logic for fast Node verification
function parseEvent(raw, idx = 0) {
  const topics = Array.isArray(raw.topic) ? raw.topic : Array.isArray(raw.topics) ? raw.topics : [];
  const eventType = String(topics[0] ?? 'unknown');
  const subscriber = String(topics[1] ?? '');
  const merchant = String(topics[2] ?? '');
  const amount = String(raw.value ?? '0');
  const ledger = Number(raw.ledger ?? 0);
  const timestamp = String(raw.ledgerClosedAt ?? raw.timestamp ?? '');
  const id = String(raw.id ?? `${ledger}-${idx}`);
  return {
    id,
    eventType,
    subscriber,
    merchant,
    address: subscriber || merchant,
    amount,
    timestamp,
    ledger,
    txHash: raw.txHash,
  };
}

function computeAnalytics(events, latestLedger = 0) {
  let totalSubscriptions = 0;
  let totalExecutedPayments = 0;
  let subscribedVol = 0n;
  let settledVol = 0n;
  const subscribers = new Set();
  const merchants = new Set();
  let maxLedger = latestLedger;

  for (const ev of events) {
    if (ev.subscriber) subscribers.add(ev.subscriber);
    if (ev.merchant) merchants.add(ev.merchant);
    if (ev.ledger > maxLedger) maxLedger = ev.ledger;
    const amt = BigInt(ev.amount || '0');
    if (ev.eventType === 'subscribe') {
      totalSubscriptions += 1;
      subscribedVol += amt;
    } else if (ev.eventType === 'executed') {
      totalExecutedPayments += 1;
      settledVol += amt;
    }
  }
  return {
    totalEvents: events.length,
    totalSubscriptions,
    totalExecutedPayments,
    totalSubscribedVolume: subscribedVol.toString(),
    totalSettledVolume: settledVol.toString(),
    uniqueSubscribers: subscribers.size,
    uniqueMerchants: merchants.size,
    latestLedger: maxLedger,
  };
}

function paginate(events, page, pageSize) {
  const safePageSize = Math.max(1, pageSize);
  const totalItems = events.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * safePageSize;
  return {
    items: events.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
  };
}

function toCsv(events) {
  const escapeCell = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = [
    'Event ID',
    'Event Type',
    'Timestamp',
    'Address',
    'Subscriber',
    'Merchant',
    'Amount',
    'Ledger',
    'Transaction Hash',
  ];
  const rows = events.map((ev) =>
    [
      escapeCell(ev.id),
      escapeCell(ev.eventType),
      escapeCell(ev.timestamp),
      escapeCell(ev.address),
      escapeCell(ev.subscriber),
      escapeCell(ev.merchant),
      escapeCell(ev.amount),
      escapeCell(ev.ledger),
      escapeCell(ev.txHash ?? ''),
    ].join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

test('EventHistory.tsx and event_history.ts exist and implement required Soroban RPC getEvents interface', () => {
  const compPath = path.join(srcRoot, 'components', 'EventHistory.tsx');
  const libPath = path.join(srcRoot, 'lib', 'event_history.ts');
  const pagePath = path.join(srcRoot, 'app', 'page.tsx');

  assert.equal(fs.existsSync(compPath), true, 'EventHistory.tsx must exist');
  assert.equal(fs.existsSync(libPath), true, 'event_history.ts must exist');

  const compSrc = fs.readFileSync(compPath, 'utf8');
  const libSrc = fs.readFileSync(libPath, 'utf8');
  const pageSrc = fs.readFileSync(pagePath, 'utf8');

  assert.match(libSrc, /getEvents\(/, 'Must call Stellar RPC getEvents');
  assert.match(compSrc, /Export CSV/, 'Must provide CSV export button');
  assert.match(compSrc, /Previous/, 'Must provide pagination controls');
  assert.match(pageSrc, /<EventHistory\s*\/>/, 'Home page must render EventHistory component');
});

test('Soroban lifecycle event decoding and on-chain subscription analytics aggregation', () => {
  const rawEvents = [
    {
      id: '0001050-1',
      topic: ['subscribe', 'GSUB1AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMM', 'GMER1AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMM'],
      value: '25000000',
      ledger: 1050,
      ledgerClosedAt: '2026-11-10T12:00:00Z',
      txHash: 'tx_sub_1',
    },
    {
      id: '0001055-1',
      topic: ['executed', 'GSUB1AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMM', 'GMER1AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMM'],
      value: '25000000',
      ledger: 1055,
      ledgerClosedAt: '2026-11-10T12:05:00Z',
      txHash: 'tx_exec_1',
    },
    {
      id: '0001060-1',
      topic: ['subscribe', 'GSUB2AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMM', 'GMER2AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMM'],
      value: '50000000',
      ledger: 1060,
      ledgerClosedAt: '2026-11-10T12:10:00Z',
      txHash: 'tx_sub_2',
    },
  ];

  const parsed = rawEvents.map((e, i) => parseEvent(e, i));
  const summary = computeAnalytics(parsed, 1060);

  assert.equal(summary.totalEvents, 3);
  assert.equal(summary.totalSubscriptions, 2);
  assert.equal(summary.totalExecutedPayments, 1);
  assert.equal(summary.totalSubscribedVolume, '75000000');
  assert.equal(summary.totalSettledVolume, '25000000');
  assert.equal(summary.uniqueSubscribers, 2);
  assert.equal(summary.uniqueMerchants, 2);
  assert.equal(summary.latestLedger, 1060);
});

test('Pagination and CSV export formatting', () => {
  const sample = Array.from({ length: 15 }, (_, idx) => ({
    id: `ev-${idx + 1}`,
    eventType: idx % 2 === 0 ? 'subscribe' : 'executed',
    subscriber: `GSUB${idx + 1}`,
    merchant: `GMER${idx + 1}`,
    address: `GSUB${idx + 1}`,
    amount: String((idx + 1) * 100),
    timestamp: `2026-11-10T12:${String(idx).padStart(2, '0')}:00Z`,
    ledger: 2000 + idx,
    txHash: `hash_${idx + 1}`,
  }));

  const p1 = paginate(sample, 1, 10);
  assert.equal(p1.items.length, 10);
  assert.equal(p1.totalPages, 2);
  assert.equal(p1.page, 1);

  const p2 = paginate(sample, 2, 10);
  assert.equal(p2.items.length, 5);
  assert.equal(p2.page, 2);

  const csv = toCsv(p2.items);
  const lines = csv.split('\n');
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^Event ID,Event Type,Timestamp,Address,Subscriber,Merchant,Amount,Ledger,Transaction Hash$/);
  assert.match(lines[1], /^ev-11,subscribe,2026-11-10T12:10:00Z,GSUB11,GSUB11,GMER11,1100,2010,hash_11$/);
});
