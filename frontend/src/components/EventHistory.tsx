'use client';

/**
 * EventHistory.tsx
 *
 * On-chain subscription analytics & lifecycle event history viewer (`subscribe` and `executed`)
 * powered by Stellar Soroban RPC `getEvents`, with client-side filtering, pagination, and CSV export.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CONTRACT_ID, RPC_URL } from '@/constants/network';
import {
  computeSubscriptionAnalytics,
  eventsToCsv,
  fetchContractEvents,
  paginateEvents,
  type SubscriptionLifecycleEvent,
} from '@/lib/event_history';

interface EventHistoryProps {
  contractId?: string;
  rpcUrl?: string;
  pageSize?: number;
  initialEvents?: SubscriptionLifecycleEvent[];
}

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr || '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function EventHistory({
  contractId = CONTRACT_ID,
  rpcUrl = RPC_URL,
  pageSize = 10,
  initialEvents,
}: EventHistoryProps) {
  const [events, setEvents] = useState<SubscriptionLifecycleEvent[]>(initialEvents ?? []);
  const [latestLedger, setLatestLedger] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filter & pagination state
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'subscribe' | 'executed'>('ALL');
  const [addressQuery, setAddressQuery] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  const loadEvents = useCallback(async () => {
    if (!contractId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchContractEvents({ contractId, rpcUrl });
      setEvents(res.events);
      setLatestLedger(res.latestLedger);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to fetch on-chain events: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  }, [contractId, rpcUrl]);

  useEffect(() => {
    if (!initialEvents) {
      void loadEvents();
    }
  }, [initialEvents, loadEvents]);

  // Filter events by type and address substring
  const filteredEvents = useMemo(() => {
    const q = addressQuery.trim().toLowerCase();
    return events.filter((ev) => {
      if (typeFilter !== 'ALL' && ev.eventType !== typeFilter) {
        return false;
      }
      if (q) {
        const matchSub = ev.subscriber.toLowerCase().includes(q);
        const matchMer = ev.merchant.toLowerCase().includes(q);
        const matchAddr = ev.address.toLowerCase().includes(q);
        if (!matchSub && !matchMer && !matchAddr) return false;
      }
      return true;
    });
  }, [events, typeFilter, addressQuery]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [typeFilter, addressQuery]);

  const analytics = useMemo(
    () => computeSubscriptionAnalytics(filteredEvents, latestLedger),
    [filteredEvents, latestLedger]
  );

  const paginated = useMemo(
    () => paginateEvents(filteredEvents, page, pageSize),
    [filteredEvents, page, pageSize]
  );

  function handleExportCsv() {
    const csvContent = eventsToCsv(filteredEvents);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `soroban-subscription-events-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <section
      aria-label="On-chain subscription analytics and event history"
      className="w-full max-w-4xl mx-auto mt-10 bg-gray-900 rounded-2xl shadow-xl p-6 md:p-8 text-white"
    >
      {/* Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold">On-Chain Subscription Analytics & Event History</h2>
          <p className="text-gray-400 text-sm">
            Live Soroban contract lifecycle events (<code className="text-blue-300">subscribe</code> &amp;{' '}
            <code className="text-green-300">executed</code>) via Stellar RPC <code className="text-gray-300">getEvents</code>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void loadEvents()}
            disabled={isLoading || !contractId}
            className="rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 px-3 py-2 text-xs font-semibold border border-gray-700 transition-colors"
          >
            {isLoading ? 'Syncing…' : 'Refresh RPC'}
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredEvents.length === 0}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-xs font-semibold transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Analytics KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl bg-gray-800/80 border border-gray-700 p-4">
          <p className="text-xs text-gray-400">Subscriptions Created</p>
          <p className="text-2xl font-bold text-blue-400 mt-1">{analytics.totalSubscriptions}</p>
          <p className="text-[11px] text-gray-500 mt-1">
            Authorized volume: {analytics.totalSubscribedVolume}
          </p>
        </div>

        <div className="rounded-xl bg-gray-800/80 border border-gray-700 p-4">
          <p className="text-xs text-gray-400">Executed Payments</p>
          <p className="text-2xl font-bold text-green-400 mt-1">{analytics.totalExecutedPayments}</p>
          <p className="text-[11px] text-gray-500 mt-1">
            Settled volume: {analytics.totalSettledVolume}
          </p>
        </div>

        <div className="rounded-xl bg-gray-800/80 border border-gray-700 p-4">
          <p className="text-xs text-gray-400">Active Participants</p>
          <p className="text-2xl font-bold text-white mt-1">{analytics.uniqueSubscribers}</p>
          <p className="text-[11px] text-gray-500 mt-1">
            Merchants: {analytics.uniqueMerchants}
          </p>
        </div>

        <div className="rounded-xl bg-gray-800/80 border border-gray-700 p-4">
          <p className="text-xs text-gray-400">Latest Synced Ledger</p>
          <p className="text-2xl font-bold text-purple-300 mt-1">
            {analytics.latestLedger > 0 ? `#${analytics.latestLedger}` : '—'}
          </p>
          <p className="text-[11px] text-gray-500 mt-1">
            Total events: {analytics.totalEvents}
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <select
          aria-label="Filter by event type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'ALL' | 'subscribe' | 'executed')}
          className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="ALL">All Lifecycle Events</option>
          <option value="subscribe">subscribe (New Subscriptions)</option>
          <option value="executed">executed (Recurring Settlements)</option>
        </select>

        <input
          type="text"
          aria-label="Filter by Stellar address"
          placeholder="Filter by subscriber or merchant G-address…"
          value={addressQuery}
          onChange={(e) => setAddressQuery(e.target.value)}
          className="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mb-5 rounded-lg bg-red-900/60 border border-red-600 p-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {/* Paginated Events Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-800/90 text-xs uppercase text-gray-400">
            <tr>
              <th className="px-4 py-3">Event Type</th>
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">Address (Subscriber)</th>
              <th className="px-4 py-3">Merchant</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-right">Ledger</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {paginated.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  {isLoading
                    ? 'Fetching contract events from Stellar RPC…'
                    : 'No on-chain contract events found for the current filter.'}
                </td>
              </tr>
            ) : (
              paginated.items.map((ev) => (
                <tr key={ev.id} className="hover:bg-gray-800/40 transition-colors">
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        ev.eventType === 'subscribe'
                          ? 'bg-blue-900/60 text-blue-300 border border-blue-700'
                          : ev.eventType === 'executed'
                            ? 'bg-green-900/60 text-green-300 border border-green-700'
                            : 'bg-gray-800 text-gray-300'
                      }`}
                    >
                      {ev.eventType}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-300">
                    {ev.timestamp}
                  </td>
                  <td
                    className="px-4 py-3 font-mono text-xs text-white"
                    title={ev.address}
                  >
                    {shortenAddress(ev.address)}
                  </td>
                  <td
                    className="px-4 py-3 font-mono text-xs text-gray-300"
                    title={ev.merchant}
                  >
                    {shortenAddress(ev.merchant)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-white">
                    {ev.amount}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-400">
                    #{ev.ledger}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="mt-4 flex items-center justify-between text-xs text-gray-400">
        <span>
          Showing {paginated.items.length} of {paginated.totalItems} event(s) — Page{' '}
          {paginated.page} of {paginated.totalPages}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={paginated.page <= 1}
            className="rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 font-semibold text-white"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(paginated.totalPages, p + 1))}
            disabled={paginated.page >= paginated.totalPages}
            className="rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 font-semibold text-white"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
