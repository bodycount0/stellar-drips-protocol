import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventsToCsv,
  fetchEventHistory,
  formatAmount,
  paginate,
  parseEvent,
  type EventsServer,
  type HistoryEvent,
  type RawEvent,
} from './event_history.ts';

const decode = (v: unknown) => v; // mock events carry already-decoded values

const raw = (id: string, name: string, amount: string): RawEvent => ({
  id,
  ledgerClosedAt: '2026-01-01T00:00:00Z',
  topic: [name, 'GSUB', 'GMERCH'],
  value: amount,
});

test('parseEvent maps topics and data, ignores foreign events', () => {
  const e = parseEvent(raw('1', 'subscribe', '125000000'), decode);
  assert.deepEqual(e, {
    id: '1',
    type: 'subscribe',
    timestamp: '2026-01-01T00:00:00Z',
    subscriber: 'GSUB',
    merchant: 'GMERCH',
    amount: '125000000',
  });
  assert.equal(parseEvent(raw('2', 'other', '1'), decode), null);
  assert.equal(parseEvent({ ...raw('3', 'executed', '1'), topic: [] }, decode), null);
});

test('fetchEventHistory follows cursor across pages, newest first', async () => {
  const pages = [[raw('a', 'subscribe', '1'), raw('b', 'executed', '2')], [raw('c', 'executed', '3')], []];
  const requests: unknown[] = [];
  const server: EventsServer = {
    getLatestLedger: async () => ({ sequence: 500 }),
    getEvents: async (req) => {
      requests.push(req);
      const events = pages.shift() ?? [];
      return { events, latestLedger: 500 };
    },
  };
  const out = await fetchEventHistory(server, 'CABC', decode, 100, 2);
  assert.deepEqual(out.map((e) => e.id), ['c', 'b', 'a']);
  assert.equal((requests[0] as { startLedger: number }).startLedger, 400);
  assert.equal((requests[1] as { cursor: string }).cursor, 'b');
});

test('paginate slices and clamps pages', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  assert.deepEqual(paginate(items, 1, 10).rows, items.slice(0, 10));
  assert.equal(paginate(items, 3, 10).rows.length, 5);
  assert.equal(paginate(items, 99, 10).page, 3);
  assert.equal(paginate(items, 0, 10).page, 1);
  assert.equal(paginate([], 1, 10).totalPages, 1);
});

test('formatAmount converts stroops', () => {
  assert.equal(formatAmount('125000000'), '12.5');
  assert.equal(formatAmount('10000000'), '1');
  assert.equal(formatAmount('1'), '0.0000001');
});

test('eventsToCsv writes header, rows and escapes cells', () => {
  const events: HistoryEvent[] = [
    { id: '1', type: 'executed', timestamp: 'T', subscriber: 'S', merchant: '=cmd,"x"', amount: '10000000' },
  ];
  const lines = eventsToCsv(events).split('\n');
  assert.equal(lines[0], 'event_type,timestamp,subscriber,merchant,amount');
  assert.equal(lines[1], `executed,T,S,"'=cmd,""x""",1`);
});
