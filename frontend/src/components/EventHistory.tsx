'use client';

/**
 * EventHistory — paginated table of the contract's on-chain events
 * (fetched with Stellar RPC getEvents) with CSV export.
 */

import { useCallback, useEffect, useState } from 'react';
import { SorobanRpc, scValToNative } from '@stellar/stellar-sdk';
import { CONTRACT_ID, RPC_URL } from '@/constants/network';
import {
  eventsToCsv,
  fetchEventHistory,
  formatAmount,
  paginate,
  type EventsServer,
  type HistoryEvent,
} from '@/lib/event_history';

const PAGE_SIZE = 10;

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export default function EventHistory() {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    if (!CONTRACT_ID) {
      setError('Contract ID is not configured (NEXT_PUBLIC_CONTRACT_ID).');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const server = new SorobanRpc.Server(RPC_URL) as unknown as EventsServer;
      const result = await fetchEventHistory(server, CONTRACT_ID, (v) =>
        scValToNative(v as Parameters<typeof scValToNative>[0]),
      );
      setEvents(result);
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = () => {
    const blob = new Blob([eventsToCsv(events)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'event-history.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const { rows, page: current, totalPages } = paginate(events, page, PAGE_SIZE);

  return (
    <section className="w-full max-w-3xl mt-8 bg-gray-900 rounded-2xl p-6 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Event history</h2>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 px-3 py-1.5 text-xs"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button
            onClick={exportCsv}
            disabled={events.length === 0}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-red-900/60 border border-red-600 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-gray-400 border-b border-gray-800">
            <tr>
              <th className="py-2 pr-4">Event</th>
              <th className="py-2 pr-4">Time</th>
              <th className="py-2 pr-4">Subscriber</th>
              <th className="py-2 pr-4">Merchant</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-500">
                  {loading ? 'Loading events…' : 'No events found.'}
                </td>
              </tr>
            ) : (
              rows.map((e) => (
                <tr key={e.id} className="border-b border-gray-800/50">
                  <td className="py-2 pr-4 capitalize">{e.type}</td>
                  <td className="py-2 pr-4">{new Date(e.timestamp).toLocaleString()}</td>
                  <td className="py-2 pr-4 font-mono" title={e.subscriber}>{short(e.subscriber)}</td>
                  <td className="py-2 pr-4 font-mono" title={e.merchant}>{short(e.merchant)}</td>
                  <td className="py-2 text-right">{formatAmount(e.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 text-xs text-gray-400">
        <button
          onClick={() => setPage(current - 1)}
          disabled={current <= 1}
          className="rounded px-2 py-1 hover:text-white disabled:opacity-40"
        >
          Previous
        </button>
        <span>
          Page {current} of {totalPages}
        </span>
        <button
          onClick={() => setPage(current + 1)}
          disabled={current >= totalPages}
          className="rounded px-2 py-1 hover:text-white disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </section>
  );
}
