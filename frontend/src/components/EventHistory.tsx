'use client';

/**
 * EventHistory.tsx
 *
 * On-chain event history viewer for the SubscriptionProtocol contract.
 * Fetches contract events via Stellar RPC getEvents, renders them in a
 * paginated table (event type, timestamp, subscriber/merchant address,
 * amount), and provides a client-side CSV export.
 *
 * Requirements: issue #4 — EventHistory component
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Server, SorobanRpc } from '@stellar/stellar-sdk';
import { CONTRACT_ID, NETWORK_PASSPHRASE, RPC_URL } from '@/constants/network';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  type: string;          // 'subscribe' | 'executed'
  txHash: string;
  ledger: number;
  timestamp: string;     // ISO string (from ledger close time)
  subscriber: string;
  merchant: string;
  amount: string;        // raw i128 amount as string
  contractId: string;
}

const PAGE_SIZE = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Decode an i128 SCVal (i128 object or i256) into a plain JS string. */
function decodeI128(val: unknown): string {
  if (!val || typeof val !== 'object') return '';
  const v = val as Record<string, unknown>;
  if (v.i128 && typeof v.i128 === 'object') {
    const parts = (v.i128 as Record<string, number>);
    const hi = parts.hi ?? 0;
    const lo = parts.lo ?? 0;
    // hi is signed 64-bit; combine into a BigInt for correctness
    const big = (BigInt(hi) << 64n) | BigInt(lo >>> 0);
    return big.toString();
  }
  if (v.i256) return JSON.stringify(v.i256);
  return '';
}

/** Decode an SCVal address (Address object) into its G... string. */
function decodeAddress(val: unknown): string {
  if (!val || typeof val !== 'object') return '';
  const v = val as Record<string, unknown>;
  const inner = v.address as Record<string, unknown> | undefined;
  if (!inner) return '';
  const acc = inner.account as Record<string, unknown> | undefined;
  if (acc && typeof acc.publicKey === 'string') return acc.publicKey;
  const contractIn = inner.contract as Record<string, unknown> | undefined;
  if (contractIn && typeof contractIn.contractId === 'string') {
    return contractIn.contractId;
  }
  return '';
}

/** Build a CSV string from the filtered rows. */
function buildCsv(rows: EventRow[]): string {
  const header = ['type', 'timestamp', 'ledger', 'subscriber', 'merchant', 'amount', 'tx_hash'];
  const lines = rows.map((r) =>
    [
      r.type,
      r.timestamp,
      String(r.ledger),
      r.subscriber,
      r.merchant,
      r.amount,
      r.txHash,
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

/** Trigger a client-side download of the given text as a CSV file. */
function downloadCsv(rows: EventRow[]): void {
  const date = new Date().toISOString().slice(0, 10);
  const csv = buildCsv(rows);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `subscription-events-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EventHistory() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [sinceLedger, setSinceLedger] = useState<number | ''>('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'subscribe' | 'executed'>('all');

  // Keep a cursor (paging token) for "next page". We store the last row's
  // paging token so getEvents can resume from where we left off.
  const cursorRef = useRef<string | null>(null);

  const server = useMemo(() => new Server(RPC_URL, { allowHttp: true }), []);

  /** Normalize a getEvents result into our EventRow shape. */
  const normalizeEvents = useCallback(
    (events: SorobanRpc.Api.EventResponse[]): EventRow[] =>
      events.map((ev) => {
        const topic = ev.topic ?? [];
        // topic[0] is the event name symbol; topic[1..] are the addresses.
        const name = topic[0];
        const type = name === 'subscribe' ? 'subscribe' : 'executed';
        const subscriber = decodeAddress(topic[1]);
        const merchant = decodeAddress(topic[2]);
        const amount = decodeI128(ev.value);
        // No ledger close time in event object; use ledger seq as a proxy.
        return {
          id: ev.id,
          type,
          txHash: ev.tx_hash ?? '',
          ledger: ev.ledger ?? 0,
          timestamp: new Date(ev.ledger_close_time ?? Date.now()).toISOString(),
          subscriber,
          merchant,
          amount,
          contractId: ev.contract_id ?? '',
        };
      }),
    [],
  );

  /** Fetch one page of events, appending to the list. */
  const fetchEvents = useCallback(
    async (cursor: string | null, append: boolean) => {
      if (!CONTRACT_ID) {
        setError('No contract ID configured. Set NEXT_PUBLIC_CONTRACT_ID.');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const filters: SorobanRpc.Api.EventFilter[] = [
          {
            type: 'contract',
            contractIds: [CONTRACT_ID],
          },
        ];
        const opts: SorobanRpc.Api.GetEventsRequest = {
          startLedger: sinceLedger === '' ? 1 : Number(sinceLedger),
          filters,
          limit: PAGE_SIZE,
        };
        if (cursor) {
          opts.pagination = { cursor };
        }

        const res = await server.getEvents(opts);
        const events = res.events ?? [];
        const next = normalizeEvents(events);

        setRows((prev) => (append ? [...prev, ...next] : next));
        // If a full page came back, there may be more.
        setHasMore(events.length === PAGE_SIZE);
        if (events.length > 0) {
          cursorRef.current = events[events.length - 1].paging_token ?? null;
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        setError(`Failed to fetch events: ${raw}`);
      } finally {
        setLoading(false);
      }
    },
    [server, normalizeEvents, sinceLedger],
  );

  // Initial load.
  useEffect(() => {
    fetchEvents(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredRows = useMemo(() => {
    if (typeFilter === 'all') return rows;
    return rows.filter((r) => r.type === typeFilter);
  }, [rows, typeFilter]);

  const handleExport = useCallback(() => {
    downloadCsv(filteredRows.length > 0 ? filteredRows : rows);
  }, [filteredRows, rows]);

  return (
    <section className="w-full max-w-3xl mx-auto">
      <div className="rounded-2xl bg-gray-900 shadow-xl p-6 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-bold">Event History</h2>
            <p className="text-gray-400 text-sm mt-1">
              On-chain lifecycle events from the subscription contract.
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={filteredRows.length === 0}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40
                       disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold
                       transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400
                       whitespace-nowrap"
          >
            Export CSV
          </button>
        </div>

        {/* Filters bar */}
        <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
          <label className="flex items-center gap-2 text-gray-300">
            Type
            <select
              value={typeFilter}
              onChange={(e) =>
                setTypeFilter(e.target.value as 'all' | 'subscribe' | 'executed')
              }
              className="rounded-md bg-gray-800 border border-gray-700 px-2 py-1 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All</option>
              <option value="subscribe">subscribe</option>
              <option value="executed">executed</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-gray-300">
            Since ledger
            <input
              type="number"
              min={1}
              value={sinceLedger}
              onChange={(e) =>
                setSinceLedger(e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder="1"
              className="w-24 rounded-md bg-gray-800 border border-gray-700 px-2 py-1 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <button
            onClick={() => {
              cursorRef.current = null;
              fetchEvents(null, false);
            }}
            className="rounded-md border border-gray-600 hover:bg-gray-800 px-3 py-1 text-sm
                       transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            Refresh
          </button>
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg bg-red-900/60 border border-red-600 p-3 text-sm text-red-200"
          >
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-gray-400 text-sm">
            <svg
              className="animate-spin h-4 w-4 text-blue-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
            Loading events…
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filteredRows.length === 0 && (
          <p className="py-8 text-center text-gray-500 text-sm">
            No events found{!CONTRACT_ID ? ' (contract ID not configured)' : ''}.
          </p>
        )}

        {/* Table */}
        {filteredRows.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-lg border border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 bg-gray-800/60">
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Timestamp</th>
                    <th className="px-3 py-2 font-medium">Ledger</th>
                    <th className="px-3 py-2 font-medium">Subscriber</th>
                    <th className="px-3 py-2 font-medium">Merchant</th>
                    <th className="px-3 py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-gray-800 hover:bg-gray-800/40"
                    >
                      <td className="px-3 py-2">
                        <span
                          className={
                            'inline-block rounded px-2 py-0.5 text-xs font-semibold ' +
                            (r.type === 'subscribe'
                              ? 'bg-blue-900/60 text-blue-300'
                              : 'bg-emerald-900/60 text-emerald-300')
                          }
                        >
                          {r.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-300 whitespace-nowrap font-mono text-xs">
                        {new Date(r.timestamp).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-gray-400 font-mono text-xs">
                        {r.ledger}
                      </td>
                      <td className="px-3 py-2 text-gray-300 font-mono text-xs break-all">
                        {r.subscriber || '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-300 font-mono text-xs break-all">
                        {r.merchant || '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-gray-200">
                        {r.amount || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={() => fetchEvents(null, false)}
                className="rounded-md border border-gray-600 hover:bg-gray-800 px-3 py-1 text-sm
                           transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                First page
              </button>
              <button
                onClick={() => fetchEvents(cursorRef.current, true)}
                disabled={!hasMore}
                className="rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40
                           disabled:cursor-not-allowed px-4 py-1 text-sm font-semibold
                           transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                Load more
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}