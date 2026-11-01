// validation.ts — form validation and invariants for Stellar Drips

export interface FieldErrors {
  merchantAddress?: string;
  tokenAddress?: string;
  amount?: string;
  interval?: string;
}

export const DEFAULT_INTERVAL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export function validateAmount(amount: string) {
  const num = parseFloat(amount);
  if (!amount || isNaN(num)) return { valid: false, error: 'Amount is required' };
  if (num < 1) return { valid: false, error: 'Minimum subscription amount is 1 XLM' };
  if (num > 1_000_000) return { valid: false, error: 'Amount exceeds maximum allowed' };
  return { valid: true };
}

export function validateAddress(address: string) {
  if (!address) return { valid: false, error: 'Address is required' };
  if (!address.startsWith('G') || address.length !== 56) return { valid: false, error: 'Invalid Stellar address' };
  return { valid: true };
}

export function validateSubscriptionForm(fields: {
  merchantAddress: string;
  tokenAddress: string;
  amount: string;
  interval: string;
}): FieldErrors {
  const errors: FieldErrors = {};

  const merchantVal = validateAddress(fields.merchantAddress.trim());
  if (!merchantVal.valid) {
    errors.merchantAddress = merchantVal.error;
  }

  if (!fields.tokenAddress.trim()) {
    errors.tokenAddress = 'Token address is required';
  }

  const amountVal = validateAmount(fields.amount.trim());
  if (!amountVal.valid) {
    errors.amount = amountVal.error;
  }

  const intNum = Number(fields.interval);
  if (!fields.interval.trim() || isNaN(intNum) || intNum < 86400 || intNum > 31536000) {
    errors.interval = 'Interval must be between 86400 and 31536000 seconds';
  }

  return errors;
}

export function isFormValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
