/**
 * event_history.ts
 *
 * Fetches, decodes, aggregates, paginates, and exports on-chain Soroban
 * subscription lifecycle events (`subscribe` and `executed`) via Stellar RPC `getEvents`.
 */

import { SorobanRpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { CONTRACT_ID, RPC_URL } from '@/constants/network';

export type LifecycleEventType = 'subscribe' | 'executed' | string;

export interface SubscriptionLifecycleEvent {
  id: string;
  eventType: LifecycleEventType;
  subscriber: string;
  merchant: string;
  address: string;
  amount: string;
  timestamp: string;
  ledger: number;
  txHash?: string;
}

export interface SubscriptionAnalyticsSummary {
  totalEvents: number;
  totalSubscriptions: number;
  totalExecutedPayments: number;
  totalSubscribedVolume: string;
  totalSettledVolume: string;
  uniqueSubscribers: number;
  uniqueMerchants: number;
  latestLedger: number;
}

export interface PaginatedEventsResult {
  items: SubscriptionLifecycleEvent[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

const DEFAULT_LEDGER_LOOKBACK = 17_280; // ~24 hours of Stellar ledgers (~5s each)

/**
 * Safely decode a Soroban ScVal (or base64 XDR string / native value) into a JS primitive/string.
 */
export function decodeScValLike(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (
      trimmed === 'subscribe' ||
      trimmed === 'executed' ||
      trimmed.startsWith('G') ||
      trimmed.startsWith('C') ||
      /^-?\d+$/.test(trimmed)
    ) {
      return trimmed;
    }
    try {
      const parsedXdr = xdr.ScVal.fromXDR(trimmed, 'base64');
      const native = scValToNative(parsedXdr);
      return String(native ?? '');
    } catch {
      return trimmed;
    }
  }
  if (typeof val === 'number' || typeof val === 'bigint') {
    return String(val);
  }
  try {
    const native = scValToNative(val as xdr.ScVal);
    return String(native ?? '');
  } catch {
    return String(val);
  }
}

/**
 * Parse a raw Soroban RPC event object into a structured SubscriptionLifecycleEvent.
 *
 * Contract event layout (from contracts/subscription/src/events.rs):
 *   Topics: (symbol("subscribe" | "executed"), subscriber: Address, merchant: Address)
 *   Data:   amount (i128)
 */
export function parseRawSorobanEvent(raw: Record<string, unknown>, index = 0): SubscriptionLifecycleEvent {
  const topicsRaw = Array.isArray(raw.topic)
    ? raw.topic
    : Array.isArray(raw.topics)
      ? raw.topics
      : [];

  const eventType = decodeScValLike(topicsRaw[0]) || 'unknown';
  const subscriber = decodeScValLike(topicsRaw[1]) || '';
  const merchant = decodeScValLike(topicsRaw[2]) || '';

  const rawValue =
    raw.value !== undefined && typeof raw.value === 'object' && raw.value !== null && 'xdr' in (raw.value as Record<string, unknown>)
      ? (raw.value as Record<string, unknown>).xdr
      : raw.value;
  const amount = decodeScValLike(rawValue) || '0';

  const ledger = typeof raw.ledger === 'number' ? raw.ledger : Number(raw.ledger ?? 0);
  const timestamp =
    typeof raw.ledgerClosedAt === 'string' && raw.ledgerClosedAt
      ? raw.ledgerClosedAt
      : typeof raw.timestamp === 'string' && raw.timestamp
        ? raw.timestamp
        : new Date().toISOString();

  const id =
    typeof raw.id === 'string' && raw.id
      ? raw.id
      : `${ledger}-${index}`;

  const txHash =
    typeof raw.txHash === 'string' && raw.txHash
      ? raw.txHash
      : undefined;

  return {
    id,
    eventType,
    subscriber,
    merchant,
    address: subscriber || merchant,
    amount,
    timestamp,
    ledger,
    txHash,
  };
}

/**
 * Fetch contract lifecycle events via Stellar Soroban RPC `getEvents`.
 */
export async function fetchContractEvents(options?: {
  contractId?: string;
  rpcUrl?: string;
  startLedger?: number;
  limit?: number;
  rpcServer?: {
    getLatestLedger: () => Promise<{ sequence: number }>;
    getEvents: (req: unknown) => Promise<{ events?: unknown[]; latestLedger?: number }>;
  };
}): Promise<{ events: SubscriptionLifecycleEvent[]; latestLedger: number }> {
  const contractId = (options?.contractId ?? CONTRACT_ID).trim();
  const rpcUrl = (options?.rpcUrl ?? RPC_URL).trim();
  const limit = options?.limit ?? 200;

  if (!contractId) {
    return { events: [], latestLedger: 0 };
  }

  const server =
    options?.rpcServer ??
    new SorobanRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });

  const latest = await server.getLatestLedger();
  const startLedger =
    options?.startLedger ?? Math.max(1, latest.sequence - DEFAULT_LEDGER_LOOKBACK);

  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: 'contract',
        contractIds: [contractId],
      },
    ],
    limit,
  });

  const rawList = Array.isArray(response?.events) ? response.events : [];
  const parsed = rawList.map((item, idx) =>
    parseRawSorobanEvent(item as Record<string, unknown>, idx)
  );

  parsed.sort((a, b) => {
    if (b.ledger !== a.ledger) return b.ledger - a.ledger;
    return b.id.localeCompare(a.id);
  });

  return {
    events: parsed,
    latestLedger: response?.latestLedger ?? latest.sequence,
  };
}

/**
 * Compute aggregate on-chain subscription metrics from parsed events.
 */
export function computeSubscriptionAnalytics(
  events: SubscriptionLifecycleEvent[],
  latestLedger = 0
): SubscriptionAnalyticsSummary {
  let totalSubscriptions = 0;
  let totalExecutedPayments = 0;
  let subscribedVol = 0n;
  let settledVol = 0n;
  const subscribers = new Set<string>();
  const merchants = new Set<string>();
  let maxLedger = latestLedger;

  for (const ev of events) {
    if (ev.subscriber) subscribers.add(ev.subscriber);
    if (ev.merchant) merchants.add(ev.merchant);
    if (ev.ledger > maxLedger) maxLedger = ev.ledger;

    let amt = 0n;
    try {
      amt = BigInt(ev.amount || '0');
    } catch {
      amt = 0n;
    }

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

/**
 * Paginate an array of SubscriptionLifecycleEvent items.
 */
export function paginateEvents(
  events: SubscriptionLifecycleEvent[],
  page: number,
  pageSize: number
): PaginatedEventsResult {
  const safePageSize = Math.max(1, pageSize);
  const totalItems = events.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * safePageSize;
  const items = events.slice(start, start + safePageSize);

  return {
    items,
    page: safePage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
  };
}

function escapeCsvCell(value: string | number | undefined): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert an array of SubscriptionLifecycleEvent records into an RFC 4180 CSV string.
 */
export function eventsToCsv(events: SubscriptionLifecycleEvent[]): string {
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
      escapeCsvCell(ev.id),
      escapeCsvCell(ev.eventType),
      escapeCsvCell(ev.timestamp),
      escapeCsvCell(ev.address),
      escapeCsvCell(ev.subscriber),
      escapeCsvCell(ev.merchant),
      escapeCsvCell(ev.amount),
      escapeCsvCell(ev.ledger),
      escapeCsvCell(ev.txHash ?? ''),
    ].join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}
