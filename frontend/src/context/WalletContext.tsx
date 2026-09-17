'use client';

/**
 * WalletContext.tsx
 *
 * React context for Freighter wallet state with mobile browser deep-link support.
 * Wrap the app in <WalletProvider> to make wallet state available
 * to all child components via useWallet().
 *
 * Requirements: 9.1–9.6 + Mobile deep-linking
 */

import React, {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  connectWallet,
  detectFreighter,
  isMobileDevice,
  getConnectionMethod,
  getFreighterDeepLink,
  type ConnectionMethod,
} from '@/lib/wallet_manager';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletContextValue {
  /** Connected account public key, or null when disconnected. */
  publicKey: string | null;
  /** True while a connect request is in flight. */
  isConnecting: boolean;
  /** Error message from the last failed connect attempt. */
  connectError: string | null;
  /** True when Freighter extension is detected in the browser. */
  freighterInstalled: boolean;
  /** True when client is running on a mobile browser (iOS, Android). */
  isMobile: boolean;
  /** Active connection strategy: 'extension' | 'deep-link' | 'none' */
  connectionMethod: ConnectionMethod;
  /** Deep link URL to launch Freighter mobile application */
  deepLinkUrl: string;
  /** Trigger wallet connection — opens Freighter permission dialog or mobile app. */
  connect: () => Promise<void>;
  /** Clear publicKey and return to disconnected state. */
  disconnect: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const WalletContext = createContext<WalletContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [freighterInstalled, setFreighterInstalled] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [connectionMethod, setConnectionMethod] = useState<ConnectionMethod>('none');
  const [deepLinkUrl, setDeepLinkUrl] = useState('');

  useEffect(() => {
    const mobile = isMobileDevice();
    setIsMobile(mobile);
    setDeepLinkUrl(getFreighterDeepLink());

    detectFreighter().then((installed) => {
      setFreighterInstalled(installed);
      if (installed) {
        setConnectionMethod('extension');
      } else if (mobile) {
        setConnectionMethod('deep-link');
      } else {
        setConnectionMethod('none');
      }
    });
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setConnectError(null);

    try {
      const installed = await detectFreighter();
      setFreighterInstalled(installed);

      if (!installed && isMobileDevice()) {
        const link = getFreighterDeepLink();
        if (typeof window !== 'undefined') {
          window.location.href = link;
        }
        setConnectError('Redirecting to Freighter mobile app...');
        return;
      }

      if (!installed) {
        setConnectError(
          'Freighter is not installed. Install it from https://www.freighter.app',
        );
        return;
      }

      const key = await connectWallet();
      setPublicKey(key);
      setConnectionMethod('extension');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Wallet connection failed.';
      setConnectError(msg);
      setPublicKey(null);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    setConnectError(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        publicKey,
        isConnecting,
        connectError,
        freighterInstalled,
        isMobile,
        connectionMethod,
        deepLinkUrl,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
