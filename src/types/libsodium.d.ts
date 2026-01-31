declare module 'libsodium-wrappers-sumo' {
    export interface Sodium {
        ready: Promise<void>;
        crypto_secretbox_KEYBYTES: number;
        crypto_secretbox_NONCEBYTES: number;
        crypto_secretbox_keygen(): Uint8Array;
        crypto_secretbox_easy(
            message: Uint8Array,
            nonce: Uint8Array,
            key: Uint8Array
        ): Uint8Array;
        crypto_secretbox_open_easy(
            ciphertext: Uint8Array,
            nonce: Uint8Array,
            key: Uint8Array
        ): Uint8Array | null;
        crypto_generichash(
            hashLength: number,
            message: Uint8Array
        ): Uint8Array;
        randombytes_buf(length: number): Uint8Array;
        to_base64(data: Uint8Array): string;
        from_base64(base64: string): Uint8Array;
        to_hex(data: Uint8Array): string;
    }

    const sodium: Sodium;
    export default sodium;
}
