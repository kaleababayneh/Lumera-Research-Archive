/**
 * Wallet Module
 * Handles Leap wallet connection and state management
 */

import { CHAIN_ID, LUMERA_CHAIN_INFO } from './config';
console.log('LUMERA_CHAIN_INFO', LUMERA_CHAIN_INFO);
// Session storage key
const WALLET_SESSION_KEY = 'lumera_connected_wallet';

// Wallet state
let connectedAddress: string | null = null;
let isConnected = false;

/**
 * Initialize wallet state from session storage
 * Call this on app startup to restore previous connection
 */
export function initializeWalletState(): void {
    const savedAddress = sessionStorage.getItem(WALLET_SESSION_KEY);
    if (savedAddress) {
        connectedAddress = savedAddress;
        isConnected = true;
        console.log('🔄 Restored wallet connection from session:', savedAddress);
    }
}

/**
 * Check if Leap wallet extension is installed
 */
export function isLeapInstalled(): boolean {
    return typeof window.leap !== 'undefined';
}

/**
 * @deprecated Use isLeapInstalled instead
 */
export const isKeplrInstalled = isLeapInstalled;

/**
 * Connect to Leap wallet
 * Suggests the Lumera chain if not already added and enables it
 * @returns The connected wallet address
 * @throws Error if Leap is not installed or user rejects connection
 */
export async function connectWallet(): Promise<string> {
    if (!isLeapInstalled()) {
        throw new Error(
            'Leap wallet is not installed. Please install Leap extension from https://www.leapwallet.io/'
        );
    }

    const leap = window.leap!;

    try {
        // Suggest the Lumera testnet chain to Leap
        await (leap as unknown as { experimentalSuggestChain: (info: typeof LUMERA_CHAIN_INFO) => Promise<void> })
             .experimentalSuggestChain(LUMERA_CHAIN_INFO);

        // Enable the chain (prompts user for permission)
        await leap.enable(CHAIN_ID);

        // Get the user's account using getKey
        const key = await (leap as unknown as { getKey: (chainId: string) => Promise<{ bech32Address: string }> })
            .getKey(CHAIN_ID);
        connectedAddress = key.bech32Address;
        isConnected = true;

        // Save to session storage
        sessionStorage.setItem(WALLET_SESSION_KEY, connectedAddress);

        console.log('Wallet connected:', connectedAddress);
        return connectedAddress;
    } catch (error) {
        console.error('Failed to connect wallet:', error);
        throw new Error(
            error instanceof Error
                ? error.message
                : 'Failed to connect to Leap wallet'
        );
    }
}

/**
 * Disconnect the wallet (clears local state)
 */
export function disconnectWallet(): void {
    connectedAddress = null;
    isConnected = false;

    // Clear from session storage
    sessionStorage.removeItem(WALLET_SESSION_KEY);

    console.log('Wallet disconnected');
}

/**
 * Get the currently connected wallet address
 */
export function getConnectedAddress(): string | null {
    return connectedAddress;
}

/**
 * Check if a wallet is currently connected
 */
export function isWalletConnected(): boolean {
    return isConnected && connectedAddress !== null;
}

/**
 * Format address for display (truncate middle)
 */
export function formatAddress(address: string): string {
    if (address.length <= 16) return address;
    return `${address.slice(0, 10)}...${address.slice(-6)}`;
}

/**
 * Sign a message with the connected wallet
 * Used for deriving encryption keys deterministically
 */
export async function signMessage(message: string): Promise<Uint8Array> {
    if (!isLeapInstalled()) {
        throw new Error('Leap not installed');
    }

    if (!connectedAddress) {
        throw new Error('Wallet not connected');
    }

    const leap = window.leap!;

    // Use signArbitrary for ADR-036 signing
    const signResult = await (leap as unknown as {
        signArbitrary: (
            chainId: string,
            signer: string,
            data: string
        ) => Promise<{ signature: string }>;
    }).signArbitrary(CHAIN_ID, connectedAddress, message);

    // Decode base64 signature to bytes
    const binaryString = atob(signResult.signature);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
}
