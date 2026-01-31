/**
 * Paper & Draft Data Models
 * Types and interfaces for the Research Archive with collaborative drafts
 */

import type { EncryptedDocument, EncryptedKeyShare } from './crypto';

// ============================================================
// DOCUMENT STATUS & TYPES
// ============================================================

/**
 * Document lifecycle status
 */
export type DocumentStatus = 'draft' | 'shared' | 'published';

// ============================================================
// AUTHOR & COLLABORATOR
// ============================================================

/**
 * Author information for a research paper
 */
export interface Author {
    /** Author's display name */
    name: string;
    /** Optional wallet address for verification */
    wallet?: string;
    /** Institution or organization */
    affiliation?: string;
    /** ORCID identifier if available */
    orcid?: string;
}

/**
 * Collaborator with access to a draft
 */
export interface Collaborator {
    /** Wallet address */
    wallet: string;
    /** Display name */
    name: string;
    /** Document key encrypted for this wallet */
    keyShare: EncryptedKeyShare;
    /** When they were added */
    addedAt: number;
    /** Who added them */
    addedBy: string;
    /** Document key (base64) for regenerating share link - only stored for owner */
    documentKeyBase64?: string;
}

// ============================================================
// DRAFT MODELS
// ============================================================

/**
 * Draft version stored on Cascade (encrypted)
 */
export interface DraftVersion {
    /** Version number */
    version: number;
    /** Cascade action ID for this version */
    actionId: string;
    /** When created */
    createdAt: number;
    /** Wallet that created this version */
    createdBy: string;
    /** Commit message */
    message?: string;
}

/**
 * Draft metadata (stored locally, not on Cascade)
 */
export interface Draft {
    /** Unique draft identifier */
    draftId: string;
    /** Draft title */
    title: string;
    /** Current status */
    status: DocumentStatus;
    /** Document key encrypted with owner's derived key (base64) */
    ownerEncryptedKey: string;
    /** Nonce for owner's key encryption (base64) */
    ownerKeyNonce: string;
    /** Owner's wallet address */
    owner: string;
    /** List of collaborators with their key shares */
    collaborators: Collaborator[];
    /** Version history */
    versions: DraftVersion[];
    /** When the draft was created */
    createdAt: number;
    /** When last modified */
    updatedAt: number;
}

/**
 * Encrypted draft manifest stored on Cascade
 */
export interface EncryptedDraftManifest {
    /** Manifest version */
    version: number;
    /** Type identifier */
    type: 'encrypted_draft';
    /** Draft metadata (title, authors, etc. - unencrypted for discovery) */
    metadata: {
        title: string;
        abstract?: string;
        authors: Author[];
        keywords: string[];
        citations: string[];
        draftId: string;
        version: number;
        createdBy: string;
        createdAt: number;
    };
    /** Encrypted content */
    encrypted: EncryptedDocument;
}

/**
 * Collaboration invitation (stored on Cascade)
 * Allows collaborators to discover drafts they've been invited to
 */
export interface CollaborationInvitation {
    version: number;
    type: 'draft_invitation';
    draftId: string;
    draftTitle: string;
    owner: string;
    ownerName?: string;
    invitedWallet: string;
    keyShare: {
        wallet: string;
        encryptedKey: string;
        nonce: string;
    };
    latestVersion: number;
    latestActionId: string;
    createdAt: number;
    invitedBy: string;
}

/**
 * Stored draft reference (for local tracking)
 */
export interface StoredDraft {
    draftId: string;
    title: string;
    status: DocumentStatus;
    collaboratorCount: number;
    latestVersion: number;
    updatedAt: number;
    /** Owner's wallet address (optional - for invited drafts display) */
    owner?: string;
}

// ============================================================
// PUBLISHED PAPER MODELS (existing)
// ============================================================

/**
 * Research paper metadata stored alongside the document
 */
export interface ResearchPaper {
    /** Cascade action ID - serves as permanent identifier */
    actionId: string;
    /** Paper title */
    title: string;
    /** Abstract/summary of the paper */
    abstract: string;
    /** List of authors */
    authors: Author[];
    /** Keywords for discovery */
    keywords: string[];
    /** Action IDs of papers this paper cites */
    citations: string[];
    /** Wallet address that submitted the paper */
    submittedBy: string;
    /** Unix timestamp of submission */
    submittedAt: number;
    /** BLAKE3 hash of the content for integrity verification */
    contentHash: string;
    /** Original filename */
    fileName: string;
    /** File size in bytes */
    fileSize: number;
    /** Original draft ID if published from draft */
    fromDraftId?: string;
}

/**
 * Paper manifest - the JSON structure stored on Cascade
 * This wraps the paper content with metadata
 */
export interface PaperManifest {
    /** Manifest version for future compatibility */
    version: number;
    /** Type identifier */
    type: 'research_paper';
    /** Paper metadata */
    metadata: Omit<ResearchPaper, 'actionId'>;
    /** Base64-encoded paper content */
    content: string;
}

/**
 * Stored paper reference (for local tracking)
 */
export interface StoredPaper {
    actionId: string;
    title: string;
    authors: string[]; // Author names for display
    submittedAt: number;
    fileSize: number;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Create a paper manifest from metadata and content
 */
export function createPaperManifest(
    metadata: Omit<ResearchPaper, 'actionId'>,
    content: Uint8Array
): PaperManifest {
    // Convert content to base64
    const contentBase64 = btoa(String.fromCharCode(...content));

    return {
        version: 1,
        type: 'research_paper',
        metadata,
        content: contentBase64,
    };
}

/**
 * Parse a paper manifest from Cascade data
 */
export function parsePaperManifest(data: string): PaperManifest | null {
    try {
        const manifest = JSON.parse(data);
        if (manifest.type !== 'research_paper') {
            return null;
        }
        return manifest as PaperManifest;
    } catch {
        return null;
    }
}

/**
 * Parse an encrypted draft manifest from Cascade data
 */
export function parseEncryptedDraftManifest(
    data: string
): EncryptedDraftManifest | null {
    try {
        const manifest = JSON.parse(data);
        if (manifest.type !== 'encrypted_draft') {
            return null;
        }
        return manifest as EncryptedDraftManifest;
    } catch {
        return null;
    }
}

/**
 * Extract content bytes from a paper manifest
 */
export function extractContent(manifest: PaperManifest): Uint8Array {
    const binaryString = atob(manifest.content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/**
 * Format a Lumera paper URI from action ID
 */
export function formatPaperUri(actionId: string): string {
    return `lumera://${actionId}`;
}

/**
 * Parse action ID from a Lumera paper URI
 */
export function parsePaperUri(uri: string): string | null {
    const match = uri.match(/^lumera:\/\/(\d+)$/);
    return match ? match[1] : null;
}

/**
 * Format a draft URI
 */
export function formatDraftUri(draftId: string): string {
    return `draft://${draftId}`;
}
