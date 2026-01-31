/**
 * Crypto Module
 * End-to-end encryption for collaborative drafts using libsodium
 */

import sodium from 'libsodium-wrappers-sumo';

// Ensure libsodium is ready
let sodiumReady = false;

export async function initCrypto(): Promise<void> {
    if (!sodiumReady) {
        await sodium.ready;
        sodiumReady = true;
        console.log('🔐 Crypto module initialized');
    }
}

/**
 * Encrypted document structure
 */
export interface EncryptedDocument {
    /** Encrypted content (base64) */
    ciphertext: string;
    /** Nonce used for encryption (base64) */
    nonce: string;
    /** Algorithm identifier */
    algorithm: 'xchacha20-poly1305';
}

/**
 * Encrypted key share for a collaborator
 */
export interface EncryptedKeyShare {
    /** Wallet address of the collaborator */
    wallet: string;
    /** Encrypted document key (base64) */
    encryptedKey: string;
    /** Nonce used for encryption (base64) */
    nonce: string;
}

/**
 * Generate a random document encryption key
 */
export function generateDocumentKey(): Uint8Array {
    if (!sodiumReady) {
        throw new Error('Crypto not initialized. Call initCrypto() first.');
    }
    return sodium.crypto_secretbox_keygen();
}

/**
 * Encrypt document content with a document key
 * Uses XChaCha20-Poly1305 for authenticated encryption
 */
export function encryptDocument(
    content: Uint8Array,
    documentKey: Uint8Array
): EncryptedDocument {
    if (!sodiumReady) {
        throw new Error('Crypto not initialized');
    }

    // Generate random nonce
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);

    // Encrypt with XChaCha20-Poly1305
    const ciphertext = sodium.crypto_secretbox_easy(content, nonce, documentKey);

    return {
        ciphertext: sodium.to_base64(ciphertext),
        nonce: sodium.to_base64(nonce),
        algorithm: 'xchacha20-poly1305',
    };
}

/**
 * Decrypt document content with a document key
 */
export function decryptDocument(
    encrypted: EncryptedDocument,
    documentKey: Uint8Array
): Uint8Array {
    if (!sodiumReady) {
        throw new Error('Crypto not initialized');
    }

    const ciphertext = sodium.from_base64(encrypted.ciphertext);
    const nonce = sodium.from_base64(encrypted.nonce);

    const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, documentKey);

    if (!plaintext) {
        throw new Error('Decryption failed - invalid key or corrupted data');
    }

    return plaintext;
}

/**
 * Derive an encryption key from a wallet signature
 * Uses the signature as entropy to derive a deterministic key
 */
export function deriveKeyFromSignature(signature: Uint8Array): Uint8Array {
    if (!sodiumReady) {
        throw new Error('Crypto not initialized');
    }

    // Use BLAKE2b to hash the signature into a fixed-size key
    return sodium.crypto_generichash(
        sodium.crypto_secretbox_KEYBYTES,
        signature
    );
}

/**
 * Encrypt a document key for sharing with a collaborator
 * Uses their wallet-derived key
 */
export function encryptKeyForCollaborator(
    documentKey: Uint8Array,
    collaboratorDerivedKey: Uint8Array,
    collaboratorWallet: string
): EncryptedKeyShare {
    if (!sodiumReady) {
        throw new Error('Crypto not initialized');
    }

    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const encryptedKey = sodium.crypto_secretbox_easy(
        documentKey,
        nonce,
        collaboratorDerivedKey
    );

    return {
        wallet: collaboratorWallet,
        encryptedKey: sodium.to_base64(encryptedKey),
        nonce: sodium.to_base64(nonce),
    };
}

/**
 * Decrypt a key share to retrieve the document key
 */
export function decryptKeyShare(
    share: EncryptedKeyShare,
    derivedKey: Uint8Array
): Uint8Array {
    if (!sodiumReady) {
        throw new Error('Crypto not initialized');
    }

    const encryptedKey = sodium.from_base64(share.encryptedKey);
    const nonce = sodium.from_base64(share.nonce);

    const documentKey = sodium.crypto_secretbox_open_easy(encryptedKey, nonce, derivedKey);

    if (!documentKey) {
        throw new Error('Failed to decrypt key share - invalid credentials');
    }

    return documentKey;
}

/**
 * Convert Uint8Array to base64 string
 */
export function toBase64(data: Uint8Array): string {
    return sodium.to_base64(data);
}

/**
 * Convert base64 string to Uint8Array
 */
export function fromBase64(base64: string): Uint8Array {
    return sodium.from_base64(base64);
}

/**
 * Generate a unique draft ID
 */
export function generateDraftId(): string {
    const randomBytes = sodium.randombytes_buf(8);
    return sodium.to_hex(randomBytes);
}
