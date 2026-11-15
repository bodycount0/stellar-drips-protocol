import { SorobanRpc } from '@stellar/stellar-sdk';
import { NEXT_PUBLIC_RPC_URL, NEXT_PUBLIC_CONTRACT_ID } from '../constants/network';

export interface ContractEventItem {
  id: string;
  type: 'subscribe' | 'executed' | 'unknown';
  subscriber: string;
  merchant: string;
  amount: string;
  ledger: number;
  txHash: string;
}

export async function fetchContractEvents(
  rpcUrl: string = NEXT_PUBLIC_RPC_URL,
  contractId: string = NEXT_PUBLIC_CONTRACT_ID,
  startLedger?: number
): Promise<ContractEventItem[]> {
  if (!contractId) return [];

  const server = new SorobanRpc.Server(rpcUrl);

  let start = startLedger;
  if (!start) {
    try {
      const latestLedger = await server.getLatestLedger();
      start = Math.max(1, latestLedger.sequence - 100000);
    } catch {
      start = 1;
    }
  }

  try {
    const response = await server.getEvents({
      startLedger: start,
      filters: [
        {
          type: 'contract',
          contractIds: [contractId],
        },
      ],
      limit: 100,
    });

    const parsedEvents: ContractEventItem[] = response.events.map((evt, idx) => {
      let type: 'subscribe' | 'executed' | 'unknown' = 'unknown';
      let subscriber = '';
      let merchant = '';
      let amount = '0';

      try {
        const topic0 = evt.topic[0]?.toXDR('base64');
        const rawTopicStr = evt.topic.map((t) => t.toString()).join(' ');

        if (rawTopicStr.includes('subscribe') || topic0?.includes('subscribe')) {
          type = 'subscribe';
        } else if (rawTopicStr.includes('executed') || topic0?.includes('executed')) {
          type = 'executed';
        }

        if (evt.topic.length >= 3) {
          subscriber = evt.topic[1]?.toString() || '';
          merchant = evt.topic[2]?.toString() || '';
        }

        if (evt.value) {
          amount = evt.value.toString();
        }
      } catch (err) {
        console.warn('Failed parsing event values', err);
      }

      return {
        id: `${evt.id || idx}-${evt.ledger}`,
        type,
        subscriber,
        merchant,
        amount,
        ledger: evt.ledger,
        txHash: evt.txHash || '',
      };
    });

    return parsedEvents.reverse();
  } catch (error) {
    console.error('Error fetching contract events:', error);
    return [];
  }
}

export function exportEventsToCsv(events: ContractEventItem[]) {
  if (!events.length) return;

  const headers = ['Event ID', 'Type', 'Subscriber', 'Merchant', 'Amount', 'Ledger', 'Tx Hash'];
  const rows = events.map((e) => [
    e.id,
    e.type,
    e.subscriber,
    e.merchant,
    e.amount,
    e.ledger.toString(),
    e.txHash,
  ]);

  const csvContent =
    'data:text/csv;charset=utf-8,' +
    [headers.join(','), ...rows.map((r) => r.map((cell) => `"${cell}"`).join(','))].join('\n');

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `soroban_subscription_events_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
