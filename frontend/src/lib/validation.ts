// validation.ts — minimum balance check added (closes #1)
export function validateAmount(amount: string) {
  const num = parseFloat(amount);
  if (!amount || isNaN(num)) return { valid:false, error:"Amount is required" };
  if (num < 1) return { valid:false, error:"Minimum subscription amount is 1 XLM" };
  if (num > 1_000_000) return { valid:false, error:"Amount exceeds maximum allowed" };
  return { valid:true };
}
export function validateAddress(address: string) {
  if (!address) return { valid:false, error:"Address is required" };
  if (!address.startsWith("G") || address.length !== 56) return { valid:false, error:"Invalid Stellar address" };
  return { valid:true };
}
