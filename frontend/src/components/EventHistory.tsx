'use client';

import { useEffect, useState, useMemo } from 'react';
import { fetchContractEvents, exportEventsToCsv, ContractEventItem } from '../lib/events';
import { NEXT_PUBLIC_RPC_URL, NEXT_PUBLIC_CONTRACT_ID } from '../constants/network';

const PAGE_SIZE = 5;

export function EventHistory() {
  const [events, setEvents] = useState<ContractEventItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);

  const loadEvents = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchContractEvents(NEXT_PUBLIC_RPC_URL, NEXT_PUBLIC_CONTRACT_ID);
      setEvents(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load contract events');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, []);

  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      if (filterType !== 'all' && evt.type !== filterType) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          evt.subscriber.toLowerCase().includes(term) ||
          evt.merchant.toLowerCase().includes(term) ||
          evt.txHash.toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [events, filterType, searchTerm]);

  const totalPages = Math.ceil(filteredEvents.length / PAGE_SIZE) || 1;
  const paginatedEvents = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredEvents.slice(start, start + PAGE_SIZE);
  }, [filteredEvents, currentPage]);

  const analytics = useMemo(() => {
    const totalSubscribe = events.filter((e) => e.type === 'subscribe').length;
    const totalExecuted = events.filter((e) => e.type === 'executed').length;
    const totalVolume = events.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    return { totalSubscribe, totalExecuted, totalVolume };
  }, [events]);

  return (
    <div className="w-full max-w-lg bg-gray-900 border border-gray-800 rounded-2xl p-6 mt-6 shadow-lg">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Event History & Analytics</h2>
          <p className="text-xs text-gray-400">
            Real-time Soroban RPC subscription contract events
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={loadEvents}
            disabled={isLoading}
            className="px-3 py-1.5 text-xs font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors border border-gray-700 disabled:opacity-50"
          >
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={() => exportEventsToCsv(filteredEvents)}
            disabled={!filteredEvents.length}
            className="px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-950/40 hover:bg-emerald-900/50 rounded-lg transition-colors border border-emerald-800 disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Analytics Summary Cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-3 text-center">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">
            Subscribed
          </span>
          <div className="text-xl font-bold text-indigo-400 mt-0.5">
            {analytics.totalSubscribe}
          </div>
        </div>
        <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-3 text-center">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">
            Executed
          </span>
          <div className="text-xl font-bold text-emerald-400 mt-0.5">
            {analytics.totalExecuted}
          </div>
        </div>
        <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-3 text-center">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">
            Total Units
          </span>
          <div className="text-xl font-bold text-amber-400 mt-0.5">
            {analytics.totalVolume.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          type="text"
          placeholder="Filter address or tx..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          className="flex-1 bg-gray-950 border border-gray-800 text-xs text-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
        />
        <select
          value={filterType}
          onChange={(e) => {
            setFilterType(e.target.value);
            setCurrentPage(1);
          }}
          className="bg-gray-950 border border-gray-800 text-xs text-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
        >
          <option value="all">All Events</option>
          <option value="subscribe">Subscribe</option>
          <option value="executed">Executed</option>
        </select>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-3 mb-4 text-xs text-red-400 bg-red-950/40 border border-red-900 rounded-lg">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-left text-xs text-gray-300">
          <thead className="bg-gray-950 text-gray-400 uppercase border-b border-gray-800 font-semibold">
            <tr>
              <th className="py-2.5 px-3">Type</th>
              <th className="py-2.5 px-3">Subscriber</th>
              <th className="py-2.5 px-3">Merchant</th>
              <th className="py-2.5 px-3 text-right">Amount</th>
              <th className="py-2.5 px-3 text-right">Ledger</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 bg-gray-900/50">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-500">
                  Loading events…
                </td>
              </tr>
            ) : paginatedEvents.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-500">
                  No events found.
                </td>
              </tr>
            ) : (
              paginatedEvents.map((evt) => (
                <tr key={evt.id} className="hover:bg-gray-800/40">
                  <td className="py-2.5 px-3">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        evt.type === 'subscribe'
                          ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                          : evt.type === 'executed'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : 'bg-gray-800 text-gray-400'
                      }`}
                    >
                      {evt.type}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-mono">
                    {evt.subscriber
                      ? `${evt.subscriber.slice(0, 4)}…${evt.subscriber.slice(-4)}`
                      : '-'}
                  </td>
                  <td className="py-2.5 px-3 font-mono">
                    {evt.merchant
                      ? `${evt.merchant.slice(0, 4)}…${evt.merchant.slice(-4)}`
                      : '-'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-medium text-white">
                    {evt.amount}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-gray-400">
                    {evt.ledger}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-xs text-gray-400">
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex space-x-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-2.5 py-1 rounded bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50"
            >
              Prev
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-2.5 py-1 rounded bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
