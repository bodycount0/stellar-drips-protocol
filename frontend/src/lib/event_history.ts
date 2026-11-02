/**
 * event_history.ts — helpers for the on-chain event history viewer.
 *
 * Pure functions (no network, no SDK imports) so they can be unit tested.
 * The contract emits `subscribe` and `executed` events with topics
 * (symbol, subscriber, merchant) and an i128 amount as data.
 */

export type EventType = 'subscribe' | 'executed';

export interface HistoryEvent {
  id: string;
  type: EventType;
  timestamp: string; // ISO-8601
  subscriber: string;
  merchant: string;
  amount: string; // stroops, as a decimal string
}

/** Minimal shape of an entry returned by Stellar RPC getEvents. */
export interface RawEvent {
  id: string;
  ledgerClosedAt: string;
  topic: unknown[];
  value: unknown;
}

/** Minimal shape of the RPC server we need (lets tests inject a mock). */
export interface EventsServer {
  getEvents(request: {
    startLedger?: number;
    cursor?: string;
    filters: { type: 'contract'; contractIds: string[] }[];
    limit?: number;
  }): Promise<{ events: RawEvent[]; latestLedger: number; cursor?: string }>;
  getLatestLedger(): Promise<{ sequence: number }>;
}

const EVENT_TYPES: EventType[] = ['subscribe', 'executed'];

/** Convert one raw RPC event to a HistoryEvent; null if it is not ours. */
export function parseEvent(
  raw: RawEvent,
  decode: (v: unknown) => unknown,
): HistoryEvent | null {
  if (!raw.topic || raw.topic.length < 3) return null;
  const [name, subscriber, merchant] = raw.topic.map((t) => decode(t));
  if (!EVENT_TYPES.includes(name as EventType)) return null;
  return {
    id: raw.id,
    type: name as EventType,
    timestamp: raw.ledgerClosedAt,
    subscriber: String(subscriber),
    merchant: String(merchant),
    amount: String(decode(raw.value)),
  };
}

/**
 * Fetch every contract event, following the RPC cursor until a page comes
 * back empty. Newest events are returned first.
 */
export async function fetchEventHistory(
  server: EventsServer,
  contractId: string,
  decode: (v: unknown) => unknown,
  lookbackLedgers = 100_000,
  pageSize = 200,
): Promise<HistoryEvent[]> {
  const filters = [{ type: 'contract' as const, contractIds: [contractId] }];
  const latest = await server.getLatestLedger();
  const out: HistoryEvent[] = [];
  let cursor: string | undefined;

  for (;;) {
    const res = await server.getEvents(
      cursor
        ? { cursor, filters, limit: pageSize }
        : {
            startLedger: Math.max(1, latest.sequence - lookbackLedgers),
            filters,
            limit: pageSize,
          },
    );
    if (res.events.length === 0) break;
    for (const raw of res.events) {
      const parsed = parseEvent(raw, decode);
      if (parsed) out.push(parsed);
    }
    const next = res.cursor ?? res.events[res.events.length - 1].id;
    if (next === cursor) break;
    cursor = next;
  }
  return out.reverse();
}

/** Return the 1-indexed page of items plus the total page count. */
export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): { rows: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  return { rows: items.slice((p - 1) * pageSize, p * pageSize), page: p, totalPages };
}

/** Stroops (7 decimals) to a display string, e.g. "12.5". */
export function formatAmount(stroops: string): string {
  const n = BigInt(stroops);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 10_000_000n;
  const frac = (abs % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

function csvCell(value: string): string {
  // Neutralise spreadsheet formula injection, then quote if needed.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Build the CSV text for the given events. */
export function eventsToCsv(events: HistoryEvent[]): string {
  const header = ['event_type', 'timestamp', 'subscriber', 'merchant', 'amount'];
  const lines = events.map((e) =>
    [e.type, e.timestamp, e.subscriber, e.merchant, formatAmount(e.amount)]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}
