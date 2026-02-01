/**
 * Lumera Testnet Chain Configuration
 * Used for Keplr wallet integration
 */

// Lumera Testnet Configuration
export const CHAIN_ID = 'lumera-testnet-2';
export const CHAIN_NAME = 'Lumera Testnet';
export const RPC_ENDPOINT = 'https://rpc.testnet.lumera.io';
export const LCD_ENDPOINT = 'https://lcd.testnet.lumera.io';

export const LIMIT = 10000;

// Token configuration
export const DENOM = 'ulume';
export const DISPLAY_DENOM = 'LUME';
export const DECIMALS = 6;

// Gas configuration
export const GAS_PRICE = '0.025ulume';

// Lumescope API endpoint (local instance)
export const LUMESCOPE_API_BASE = 'http://localhost:18080';

/**
 * Keplr chain info for Lumera Testnet
 * This is used to suggest the chain to the Keplr wallet
 */
export const LUMERA_CHAIN_INFO = {
    chainId: CHAIN_ID,
    chainName: CHAIN_NAME,
    rpc: RPC_ENDPOINT,
    rest: LCD_ENDPOINT,
    bip44: {
        coinType: 118, // Cosmos coin type
    },
    bech32Config: {
        bech32PrefixAccAddr: 'lumera',
        bech32PrefixAccPub: 'lumerapub',
        bech32PrefixValAddr: 'lumeravaloper',
        bech32PrefixValPub: 'lumeravaloperpub',
        bech32PrefixConsAddr: 'lumeravalcons',
        bech32PrefixConsPub: 'lumeravalconspub',
    },
    currencies: [
        {
            coinDenom: DISPLAY_DENOM,
            coinMinimalDenom: DENOM,
            coinDecimals: DECIMALS,
        },
    ],
    feeCurrencies: [
        {
            coinDenom: DISPLAY_DENOM,
            coinMinimalDenom: DENOM,
            coinDecimals: DECIMALS,
            gasPriceStep: {
                low: 0.01,
                average: 0.025,
                high: 0.04,
            },
        },
    ],
    stakeCurrency: {
        coinDenom: DISPLAY_DENOM,
        coinMinimalDenom: DENOM,
        coinDecimals: DECIMALS,
    },
    features: ['stargate', 'ibc-transfer'],
};
