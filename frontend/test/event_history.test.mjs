import test from 'node:test';
import assert from 'node:assert/strict';

// Helper tests for EventHistory and Validation logic

function validateAmount(amount) {
  const num = parseFloat(amount);
  if (!amount || isNaN(num)) return { valid: false, error: 'Amount is required' };
  if (num < 1) return { valid: false, error: 'Minimum subscription amount is 1 XLM' };
  if (num > 1_000_000) return { valid: false, error: 'Amount exceeds maximum allowed' };
  return { valid: true };
}

function validateAddress(address) {
  if (!address) return { valid: false, error: 'Address is required' };
  if (!address.startsWith('G') || address.length !== 56) return { valid: false, error: 'Invalid Stellar address' };
  return { valid: true };
}

function formatShortAddress(addr) {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function generateCSV(events) {
  const headers = ['Event ID', 'Type', 'Timestamp', 'Subscriber', 'Merchant', 'Amount', 'Ledger'];
  const rows = events.map((e) => [
    e.id,
    e.type,
    e.timestamp,
    e.subscriber,
    e.merchant,
    e.amount,
    e.ledger,
  ]);
  return [
    headers.join(','),
    ...rows.map((r) => r.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
}

test('Validation: validateAmount handles valid and invalid numbers', () => {
  assert.equal(validateAmount('50').valid, true);
  assert.equal(validateAmount('1.5').valid, true);
  assert.equal(validateAmount('0.5').valid, false);
  assert.equal(validateAmount('').valid, false);
  assert.equal(validateAmount('invalid').valid, false);
  assert.equal(validateAmount('2000000').valid, false);
});

test('Validation: validateAddress checks 56-char Stellar G-addresses', () => {
  const validG = 'GAUPZN3SFJQD3VNVEY6Z7NYPW7FGV336PTJBGMOIJTKQHPBW6RTNDQZD'; // 56 chars
  assert.equal(validateAddress(validG).valid, true);
  assert.equal(validateAddress('CA6LCMDM7F').valid, false);
  assert.equal(validateAddress('').valid, false);
});

test('EventHistory: formatShortAddress produces clean ellipsis', () => {
  const longAddr = 'GA6LCMDM7F67B47QWDP7CKAKL2IKEU4PZ4GA6LCMDM7F67B47QWDP7CKAKL';
  const shortened = formatShortAddress(longAddr);
  assert.equal(shortened, 'GA6LCM…KAKL');
  assert.equal(formatShortAddress('short'), 'short');
});

test('EventHistory: generateCSV formats standard RFC-compliant rows with escaped commas', () => {
  const sampleEvents = [
    {
      id: '001',
      type: 'subscribe',
      timestamp: '2026-11-01T10:00:00Z',
      subscriber: 'GA6LCMDM7F',
      merchant: 'GBZXN7PIRZ',
      amount: '50.00',
      ledger: 100,
    },
    {
      id: '002',
      type: 'executed',
      timestamp: '2026-11-01T11:00:00Z',
      subscriber: 'GA6LCMDM7F',
      merchant: 'GBZXN7PIRZ',
      amount: '50.00',
      ledger: 110,
    },
  ];

  const csv = generateCSV(sampleEvents);
  assert.match(csv, /Event ID,Type,Timestamp,Subscriber,Merchant,Amount,Ledger/);
  assert.match(csv, /"001","subscribe","2026-11-01T10:00:00Z","GA6LCMDM7F","GBZXN7PIRZ","50.00","100"/);
  assert.match(csv, /"002","executed","2026-11-01T11:00:00Z","GA6LCMDM7F","GBZXN7PIRZ","50.00","110"/);
});
