/**
 * Wallet Module
 * Handles wallet connection and state management
 * Supports Keplr and Leap wallets
 */

import { CHAIN_ID, LUMERA_CHAIN_INFO } from './config';
console.log('LUMERA_CHAIN_INFO', LUMERA_CHAIN_INFO);

// Supported wallet types
export type WalletType = 'keplr' | 'leap';

// Session storage keys
const WALLET_SESSION_KEY = 'lumera_connected_wallet';
const WALLET_TYPE_SESSION_KEY = 'lumera_wallet_type';

// Wallet state
let connectedAddress: string | null = null;
let isConnected = false;
let activeWalletType: WalletType | null = null;

/**
 * Initialize wallet state from session storage
 * Call this on app startup to restore previous connection
 */
export function initializeWalletState(): void {
    const savedAddress = sessionStorage.getItem(WALLET_SESSION_KEY);
    const savedType = sessionStorage.getItem(WALLET_TYPE_SESSION_KEY) as WalletType | null;
    if (savedAddress && savedType) {
        connectedAddress = savedAddress;
        activeWalletType = savedType;
        isConnected = true;
        console.log(`🔄 Restored ${savedType} wallet connection from session:`, savedAddress);
    }
}

/**
 * Check if Keplr wallet extension is installed
 */
export function isKeplrInstalled(): boolean {
    return typeof window.keplr !== 'undefined';
}

/**
 * Check if Leap wallet extension is installed
 */
export function isLeapInstalled(): boolean {
    return typeof window.leap !== 'undefined';
}

/**
 * Get list of available (installed) wallets
 */
export function getAvailableWallets(): WalletType[] {
    const wallets: WalletType[] = [];
    if (isKeplrInstalled()) wallets.push('keplr');
    if (isLeapInstalled()) wallets.push('leap');
    return wallets;
}

/**
 * Get the currently active wallet type
 */
export function getActiveWalletType(): WalletType | null {
    return activeWalletType;
}

/**
 * Get the wallet provider from the window object
 */
function getWalletProvider(type: WalletType) {
    if (type === 'keplr') return window.keplr;
    if (type === 'leap') return window.leap;
    return undefined;
}

/**
 * Connect to a wallet
 * Suggests the Lumera chain if not already added and enables it
 * @param type - Which wallet to connect ('keplr' or 'leap')
 * @returns The connected wallet address
 * @throws Error if wallet is not installed or user rejects connection
 */
export async function connectWallet(type: WalletType): Promise<string> {
    const provider = getWalletProvider(type);
    const walletName = type === 'keplr' ? 'Keplr' : 'Leap';

    if (!provider) {
        const installUrl = type === 'keplr'
            ? 'https://www.keplr.app/'
            : 'https://www.leapwallet.io/';
        throw new Error(
            `${walletName} wallet is not installed. Please install it from ${installUrl}`
        );
    }

    try {
        // Suggest the Lumera testnet chain
        await (provider as any).experimentalSuggestChain(LUMERA_CHAIN_INFO);

        // Enable the chain (prompts user for permission)
        await provider.enable(CHAIN_ID);

        // Get the user's account using getKey
        const key = await (provider as any).getKey(CHAIN_ID);
        const address: string = key.bech32Address;
        connectedAddress = address;
        isConnected = true;
        activeWalletType = type;

        // Save to session storage
        sessionStorage.setItem(WALLET_SESSION_KEY, address);
        sessionStorage.setItem(WALLET_TYPE_SESSION_KEY, type);

        console.log(`Wallet connected via ${walletName}:`, address);
        return address;
    } catch (error) {
        console.error(`Failed to connect ${walletName} wallet:`, error);
        throw new Error(
            error instanceof Error
                ? error.message
                : `Failed to connect to ${walletName} wallet`
        );
    }
}

/**
 * Disconnect the wallet (clears local state)
 */
export function disconnectWallet(): void {
    connectedAddress = null;
    isConnected = false;
    activeWalletType = null;

    // Clear from session storage
    sessionStorage.removeItem(WALLET_SESSION_KEY);
    sessionStorage.removeItem(WALLET_TYPE_SESSION_KEY);

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
    if (!activeWalletType) {
        throw new Error('No wallet connected');
    }

    const provider = getWalletProvider(activeWalletType);
    if (!provider) {
        throw new Error(`${activeWalletType} wallet not available`);
    }

    if (!connectedAddress) {
        throw new Error('Wallet not connected');
    }

    // Use signArbitrary for ADR-036 signing
    const signResult = await (provider as any).signArbitrary(CHAIN_ID, connectedAddress, message);

    // Decode base64 signature to bytes
    const binaryString = atob(signResult.signature);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
}
