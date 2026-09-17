/**
 * wallet_manager.ts
 *
 * Freighter wallet integration layer supporting desktop extension
 * and mobile browser deep-linking.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4 + Mobile deep-linking
 */

import {
  isConnected,
  isAllowed,
  setAllowed,
  requestAccess,
  getAddress,
  signTransaction,
} from '@stellar/freighter-api';

export type ConnectionMethod = 'extension' | 'deep-link' | 'none';

// ─── Mobile Detection ─────────────────────────────────────────────────────────

/**
 * Returns true if the client environment is a mobile browser (iOS, Android, etc.)
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const userAgent = navigator.userAgent || navigator.vendor || (window as unknown as { opera?: string }).opera || '';
  return /android|iphone|ipad|ipod|windows phone|mobile/i.test(userAgent);
}

/**
 * Generates a deep link to launch Freighter mobile application.
 * If targetUrl is omitted, defaults to the current window location.
 */
export function getFreighterDeepLink(targetUrl?: string): string {
  const destination = targetUrl || (typeof window !== 'undefined' ? window.location.href : 'https://drips.stellar.org');
  return `https://freighter.app/open?url=${encodeURIComponent(destination)}`;
}

/**
 * Determines current viable connection method.
 */
export async function getConnectionMethod(): Promise<ConnectionMethod> {
  const hasExtension = await detectFreighter();
  if (hasExtension) {
    return 'extension';
  }
  if (isMobileDevice()) {
    return 'deep-link';
  }
  return 'none';
}

// ─── Freighter detection ──────────────────────────────────────────────────────

/**
 * Returns true if the Freighter browser extension is installed and enabled.
 * Does NOT trigger any permission dialogs.
 */
export async function detectFreighter(): Promise<boolean> {
  try {
    const result = await isConnected();
    return result.isConnected === true;
  } catch {
    return false;
  }
}

// ─── Wallet connection ────────────────────────────────────────────────────────

/**
 * Request wallet access and return the connected Stellar public key (G-address).
 *
 * - On desktop: interacts with Freighter extension.
 * - On mobile without extension: opens Freighter deep-link or provides instructions.
 * - Throws if user denies or wallet is unavailable.
 *
 * @returns Stellar G-address of the connected account.
 */
export async function connectWallet(): Promise<string> {
  const installed = await detectFreighter();

  if (!installed) {
    if (isMobileDevice()) {
      const deepLink = getFreighterDeepLink();
      if (typeof window !== 'undefined') {
        window.location.href = deepLink;
      }
      throw new Error(
        `Redirecting to Freighter mobile wallet... If the app does not open, install it from ${deepLink}`,
      );
    }

    throw new Error(
      'Freighter wallet is not installed. ' +
        'Install it from https://www.freighter.app to continue.',
    );
  }

  // Grant site allowance if not already granted
  try {
    const allowed = await isAllowed();
    if (!allowed.isAllowed) {
      await setAllowed();
    }
  } catch (err) {
    console.warn('isAllowed/setAllowed check skipped or not required:', err);
  }

  // Request explicit account access for this session
  const access = await requestAccess();
  if (access.error) {
    throw new Error(`Access was denied: ${access.error}`);
  }

  if (access.address) {
    return access.address;
  }

  // Fallback to getAddress
  const addrResult = await getAddress();
  if (addrResult.error) {
    throw new Error(`Could not retrieve public key: ${addrResult.error}`);
  }
  if (!addrResult.address) {
    throw new Error('Freighter returned an empty public key.');
  }

  return addrResult.address;
}

// ─── Transaction signing ──────────────────────────────────────────────────────

/**
 * Sign a Stellar transaction XDR using the connected Freighter account.
 *
 * @param xdr              Base-64 encoded unsigned transaction XDR.
 * @param networkPassphrase Stellar network passphrase (testnet or mainnet).
 * @returns Signed transaction XDR as a base-64 string.
 * @throws  If Freighter returns an error or the user rejects the request.
 */
export async function signTx(
  xdr: string,
  networkPassphrase: string,
): Promise<string> {
  const result = await signTransaction(xdr, { networkPassphrase });

  if ('error' in result && result.error) {
    throw new Error(`Transaction signing failed: ${result.error}`);
  }

  const signed = (result as { signedTxXdr: string }).signedTxXdr;
  if (!signed) {
    throw new Error('Freighter returned an empty signed transaction XDR.');
  }

  return signed;
}
