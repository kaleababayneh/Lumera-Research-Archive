/**
 * Drafts Module
 * Handles encrypted draft creation, saving, loading, and collaboration
 */

import {
} from '@lumera-protocol/sdk-js';
import { getConnectedAddress, isWalletConnected, signMessage } from './wallet';
import {
    initCrypto,
    generateDocumentKey,
    encryptDocument,
    decryptDocument,
    deriveKeyFromSignature,
    encryptKeyForCollaborator,
    decryptKeyShare,
    generateDraftId,
    toBase64,
    fromBase64,
    type EncryptedKeyShare,
} from './crypto';
import {
    type Draft,
    type DraftVersion,
    type Collaborator,
    type Author,
    type EncryptedDraftManifest,
    type CollaborationInvitation,
    type StoredDraft,
    parseEncryptedDraftManifest,
} from './paper';
import { getActionsByCreator } from './lumescope';
import { getLumeraClient } from './cascade';

// Storage keys
const DRAFTS_STORAGE_KEY = 'lumera_research_archive_drafts';
const DERIVED_KEY_MESSAGE = 'Lumera Research Archive: Derive encryption key';

// Cached derived key for current session
let cachedDerivedKey: Uint8Array | null = null;
// Promise to track ongoing key derivation (prevents race conditions)
let keyDerivationPromise: Promise<Uint8Array> | null = null;

/**
 * Initialize the drafts module
 * Uses the shared Lumera client from cascade module
 * Note: Key derivation is now lazy - only happens when user opens a draft
 */
export async function initDrafts(): Promise<void> {
    await initCrypto();

    if (!isWalletConnected()) {
        throw new Error('Wallet must be connected');
    }

    const address = getConnectedAddress();
    if (!address) throw new Error('No wallet address');

    // Verify Lumera client is available (should be initialized by initializeCascadeClient)
    const client = getLumeraClient();
    if (!client) {
        throw new Error('Lumera client not initialized. Call initializeCascadeClient first.');
    }

    // Key derivation is now LAZY - only happens when user opens a draft to edit
    // This avoids signing prompts just for browsing the draft list
    console.log('📝 Drafts module initialized (key derivation will happen on first draft access)');
}

/**
 * Get or derive the user's encryption key from wallet signature
 * Uses a lock to prevent multiple concurrent signing prompts
 */
async function getOrDeriveDerivedKey(): Promise<Uint8Array> {
    // Return cached key if available
    if (cachedDerivedKey) {
        return cachedDerivedKey;
    }

    // If already deriving, wait for that to complete (prevents race condition)
    if (keyDerivationPromise) {
        return keyDerivationPromise;
    }

    // Start derivation and cache the promise to prevent duplicate signing prompts
    keyDerivationPromise = (async () => {
        console.log('🔐 Deriving encryption key from wallet signature...');
        const signature = await signMessage(DERIVED_KEY_MESSAGE);
        cachedDerivedKey = deriveKeyFromSignature(signature);
        keyDerivationPromise = null; // Clear the promise after completion
        console.log('🔐 Encryption key derived and cached');
        return cachedDerivedKey;
    })();

    return keyDerivationPromise;
}

/**
 * Clear cached derived key and any pending derivation (on disconnect)
 */
export function clearDerivedKey(): void {
    cachedDerivedKey = null;
    keyDerivationPromise = null;
}

/**
 * Create a new private draft
 */
export async function createDraft(
    title: string,
    content: string,
    metadata: {
        abstract?: string;
        authors?: Author[];
        keywords?: string[];
        citations?: string[];
    } = {},
    onProgress?: (progress: number) => void
): Promise<Draft> {
    const lumeraClient = getLumeraClient();
    if (!lumeraClient) {
        throw new Error('Cascade client not initialized');
    }

    const owner = getConnectedAddress();
    if (!owner) throw new Error('Not connected');

    onProgress?.(5);

    // Generate document encryption key
    const documentKey = generateDocumentKey();

    // Encrypt content
    const contentBytes = new TextEncoder().encode(content);
    const encrypted = encryptDocument(contentBytes, documentKey);
    onProgress?.(15);

    // Encrypt document key with owner's derived key
    const derivedKey = await getOrDeriveDerivedKey();
    const ownerKeyShare = encryptKeyForCollaborator(documentKey, derivedKey, owner);
    onProgress?.(20);

    // Create draft ID
    const draftId = generateDraftId();

    // Create manifest for Cascade (metadata is public, content is encrypted)
    const manifest: EncryptedDraftManifest = {
        version: 1,
        type: 'encrypted_draft',
        metadata: {
            title,
            abstract: metadata.abstract || '',
            authors: metadata.authors || [{ name: owner, wallet: owner }],
            keywords: metadata.keywords || [],
            citations: metadata.citations || [],
            draftId,
            version: 1,
            createdBy: owner,
            createdAt: Date.now(),
        },
        encrypted,
    };

    // Upload to Cascade
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    onProgress?.(30);

    const expirationTime = Math.floor(Date.now() / 1000) + 90000 * 30;
    const uploadResult = await lumeraClient.Cascade.uploader.uploadFile(manifestBytes, {
        fileName: `draft_${draftId}_v1.json`,
        isPublic: true,
        expirationTime: expirationTime.toString(),
        taskOptions: { pollInterval: 2000, timeout: 300000 },
    });

    onProgress?.(90);

    const actionId = (uploadResult as { action_id?: string }).action_id ||
        uploadResult.taskId || `draft-${Date.now()}`;

    // Create draft record
    const now = Date.now();
    const draft: Draft = {
        draftId,
        title,
        status: 'draft',
        ownerEncryptedKey: ownerKeyShare.encryptedKey,
        ownerKeyNonce: ownerKeyShare.nonce,
        owner,
        collaborators: [],
        versions: [
            {
                version: 1,
                actionId,
                createdAt: now,
                createdBy: owner,
                message: 'Initial draft',
            },
        ],
        createdAt: now,
        updatedAt: now,
    };

    // Save to localStorage
    saveDraft(draft);
    onProgress?.(100);

    console.log(`📝 Created draft: ${draftId} (action: ${actionId})`);
    return draft;
}

/**
 * Save a new version of an existing draft
 */
export async function saveDraftVersion(
    draftId: string,
    content: string,
    message?: string,
    onProgress?: (progress: number) => void
): Promise<DraftVersion> {
    const lumeraClient = getLumeraClient();
    if (!lumeraClient) throw new Error('Cascade client not initialized');

    const draft = getDraft(draftId);
    if (!draft) throw new Error('Draft not found');

    const owner = getConnectedAddress();
    if (!owner) throw new Error('Not connected');

    onProgress?.(5);

    // Get document key
    const documentKey = await getDocumentKey(draft);
    onProgress?.(15);

    // Encrypt new content
    const contentBytes = new TextEncoder().encode(content);
    const encrypted = encryptDocument(contentBytes, documentKey);
    onProgress?.(25);

    // Get latest version metadata
    const latestVersion = draft.versions[draft.versions.length - 1];
    const newVersionNum = latestVersion.version + 1;

    // Create manifest
    const manifest: EncryptedDraftManifest = {
        version: 1,
        type: 'encrypted_draft',
        metadata: {
            title: draft.title,
            abstract: '',
            authors: [{ name: owner, wallet: owner }],
            keywords: [],
            citations: [],
            draftId,
            version: newVersionNum,
            createdBy: owner,
            createdAt: Date.now(),
        },
        encrypted,
    };

    // Upload to Cascade
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    onProgress?.(40);

    const expirationTime = Math.floor(Date.now() / 1000) + 90000 * 30;
    const uploadResult = await lumeraClient.Cascade.uploader.uploadFile(manifestBytes, {
        fileName: `draft_${draftId}_v${newVersionNum}.json`,
        isPublic: true,
        expirationTime: expirationTime.toString(),
        taskOptions: { pollInterval: 2000, timeout: 300000 },
    });

    onProgress?.(90);

    const actionId = (uploadResult as { action_id?: string }).action_id ||
        uploadResult.taskId || `draft-${Date.now()}`;

    // Create version record
    const version: DraftVersion = {
        version: newVersionNum,
        actionId,
        createdAt: Date.now(),
        createdBy: owner,
        message,
    };

    // Update draft
    draft.versions.push(version);
    draft.updatedAt = Date.now();
    saveDraft(draft);
    onProgress?.(100);

    console.log(`📝 Saved version ${newVersionNum} of draft ${draftId}`);
    return version;
}

/**
 * Load and decrypt a draft's content
 */
export async function loadDraftContent(
    draftId: string,
    versionIndex?: number,
    onProgress?: (progress: number) => void
): Promise<{ content: string; version: DraftVersion }> {
    const lumeraClient = getLumeraClient();
    if (!lumeraClient) throw new Error('Cascade client not initialized');

    const draft = getDraft(draftId);
    if (!draft) throw new Error('Draft not found');

    onProgress?.(10);

    // Get version to load
    const version = versionIndex !== undefined
        ? draft.versions[versionIndex]
        : draft.versions[draft.versions.length - 1];

    if (!version) throw new Error('Version not found');

    // Download from Cascade
    console.log(`📥 Downloading draft content from Action ID: ${version.actionId}...`);
    const downloadStream = await lumeraClient.Cascade.downloader.download(version.actionId);
    onProgress?.(30);

    // Read stream
    const reader = downloadStream.getReader();
    const chunks: Uint8Array[] = [];
    let done = false;
    while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) chunks.push(result.value);
    }

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const downloadedBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        downloadedBytes.set(chunk, offset);
        offset += chunk.length;
    }
    onProgress?.(50);

    // Parse manifest
    const manifestJson = new TextDecoder().decode(downloadedBytes);
    const manifest = parseEncryptedDraftManifest(manifestJson);
    if (!manifest) {
        console.error('❌ Failed to parse draft manifest');
        throw new Error('Invalid draft data');
    }
    console.log('📄 Manifest parsed successfully, metadata:', manifest.metadata);
    onProgress?.(60);

    // Get document key
    const documentKey = await getDocumentKey(draft);
    onProgress?.(75);

    // Decrypt content
    console.log('🔓 Decrypting document content...');
    const decryptedBytes = decryptDocument(manifest.encrypted, documentKey);
    const content = new TextDecoder().decode(decryptedBytes);
    console.log(`✅ Content decrypted (${content.length} chars)`);
    onProgress?.(100);

    console.log(`📖 Loaded draft ${draftId} version ${version.version}`);
    return { content, version };
}

/**
 * Add a collaborator to a draft
 * Returns the document key (base64) for secure link sharing
 */
export async function addCollaborator(
    draftId: string,
    collaboratorWallet: string,
    collaboratorName: string
): Promise<{ collaborator: Collaborator; invitationId?: string; documentKeyBase64: string }> {
    const draft = getDraft(draftId);
    if (!draft) throw new Error('Draft not found');

    const owner = getConnectedAddress();
    if (!owner) throw new Error('Not connected');
    if (draft.owner !== owner) throw new Error('Only owner can add collaborators');

    // Check if already a collaborator
    if (draft.collaborators.some((c) => c.wallet === collaboratorWallet)) {
        throw new Error('Already a collaborator');
    }

    // Get document key - this will be shared via the secure link
    const documentKey = await getDocumentKey(draft);
    const documentKeyBase64 = toBase64(documentKey);

    // Create a placeholder key share - the real key comes from the link
    // We still need to store something to track that this wallet is invited
    const keyShare: EncryptedKeyShare = {
        wallet: collaboratorWallet,
        encryptedKey: '', // Empty - key comes from URL
        nonce: '',
    };

    const collaborator: Collaborator = {
        wallet: collaboratorWallet,
        name: collaboratorName,
        keyShare,
        addedAt: Date.now(),
        addedBy: owner,
        documentKeyBase64, // Store for regenerating share link
    };

    draft.collaborators.push(collaborator);
    draft.status = 'shared';
    draft.updatedAt = Date.now();
    saveDraft(draft);

    // Upload invitation to Cascade so collaborator can discover the draft
    let invitationId: string | undefined;
    try {
        invitationId = await uploadCollaborationInvitation(draft, collaborator);
        console.log(`✉️ Invitation uploaded: ${invitationId}`);
    } catch (error) {
        console.error('Failed to upload invitation:', error);
        // Don't fail the whole operation if invitation upload fails
    }

    console.log(`👥 Added collaborator ${collaboratorWallet} to draft ${draftId}`);
    return { collaborator, invitationId, documentKeyBase64 };
}

/**
 * Generate a secure shareable link for a collaboration invitation
 * The document key is in the URL hash (fragment) which is NOT sent to servers
 * Security: Link contains key, but collaborator wallet must also be on the invite list
 */
export function generateShareLink(draftId: string, documentKeyBase64: string): string {
    const baseUrl = window.location.origin;
    // Use URL hash (#) for the key - this part is never sent to web servers
    // Format: /app?draft=ID#key=BASE64_KEY
    return `${baseUrl}/?draft=${draftId}#key=${encodeURIComponent(documentKeyBase64)}`;
}

/**
 * Parse a secure share link and extract draft ID and key
 */
export function parseShareLink(): { draftId: string | null; documentKey: string | null } {
    const urlParams = new URLSearchParams(window.location.search);
    const draftId = urlParams.get('draft');

    // Key is in the hash (fragment)
    const hash = window.location.hash;
    let documentKey: string | null = null;

    if (hash && hash.includes('key=')) {
        const keyMatch = hash.match(/key=([^&]+)/);
        if (keyMatch) {
            documentKey = decodeURIComponent(keyMatch[1]);
        }
    }

    return { draftId, documentKey };
}

/**
 * Process a secure share link - imports the draft with the provided key
 * Requires: 1) Valid key from link, 2) Wallet must be on collaborators list
 */
export async function processSecureShareLink(
    draftId: string,
    documentKeyBase64: string
): Promise<{ success: boolean; message: string }> {
    const wallet = getConnectedAddress();
    if (!wallet) {
        return { success: false, message: 'Please connect your wallet first' };
    }

    // Check if draft already exists locally with keys
    const existingDraft = getDraft(draftId);
    if (existingDraft) {
        // Check if this wallet is the owner
        if (existingDraft.owner === wallet) {
            return { success: true, message: 'You are the owner of this draft' };
        }

        // Check if already a collaborator with a key
        const existingCollab = existingDraft.collaborators.find(c => c.wallet === wallet);
        if (existingCollab && existingCollab.keyShare.encryptedKey) {
            return { success: true, message: 'You already have access to this draft' };
        }

        // Update collaborator with the key from the link
        if (existingCollab) {
            // Store the document key encrypted with the user's derived key
            const derivedKey = await getOrDeriveDerivedKey();
            const documentKey = fromBase64(documentKeyBase64);
            const keyShare = encryptKeyForCollaborator(documentKey, derivedKey, wallet);

            existingCollab.keyShare = keyShare;
            saveDraft(existingDraft);

            return { success: true, message: 'Access key imported successfully!' };
        }

        return { success: false, message: 'You are not invited to this draft' };
    }

    // Draft doesn't exist locally - need to fetch from Cascade
    // First, verify this wallet is invited by checking the invitation on Cascade
    try {
        const isInvited = await verifyInvitationOnCascade(draftId, wallet);
        if (!isInvited) {
            return { success: false, message: 'You are not invited to this draft. The link may be invalid or meant for someone else.' };
        }

        // Fetch draft info from Cascade and create local entry
        const draftCreated = await importDraftFromCascade(draftId, wallet, documentKeyBase64);
        if (draftCreated) {
            return { success: true, message: 'Draft imported successfully! You can now edit it.' };
        } else {
            return { success: false, message: 'Failed to import draft from Cascade' };
        }
    } catch (error) {
        console.error('Error processing share link:', error);
        return { success: false, message: 'Failed to verify invitation' };
    }
}

/**
 * Verify that a wallet has an invitation for a draft on Cascade
 */
async function verifyInvitationOnCascade(draftId: string, wallet: string): Promise<boolean> {
    try {
        const { getAllActions } = await import('./lumescope');
        const actions = await getAllActions(100);

        // Look for an invitation file for this wallet and draft
        const invitation = actions.find((action) => {
            const fileName = action.decoded?.file_name || '';
            return (
                action.type === 'ACTION_TYPE_CASCADE' &&
                action.state === 'ACTION_STATE_DONE' &&
                fileName === `invitation_${wallet}_${draftId}.json`
            );
        });

        return !!invitation;
    } catch (error) {
        console.error('Failed to verify invitation:', error);
        return false;
    }
}

/**
 * Import a draft from Cascade using information from the share link
 */
async function importDraftFromCascade(
    draftId: string,
    wallet: string,
    documentKeyBase64: string
): Promise<boolean> {
    try {
        const lumeraClient = getLumeraClient();
        if (!lumeraClient) throw new Error('Cascade client not initialized');

        // Find the invitation to get draft details
        const { getAllActions } = await import('./lumescope');
        const actions = await getAllActions(100);

        const invitationAction = actions.find((action) => {
            const fileName = action.decoded?.file_name || '';
            return (
                action.type === 'ACTION_TYPE_CASCADE' &&
                action.state === 'ACTION_STATE_DONE' &&
                fileName === `invitation_${wallet}_${draftId}.json`
            );
        });

        if (!invitationAction) {
            console.error('Invitation not found on Cascade');
            return false;
        }

        // Download and parse the invitation
        const downloadStream = await lumeraClient.Cascade.downloader.download(invitationAction.id);
        const reader = downloadStream.getReader();
        const chunks: Uint8Array[] = [];
        let done = false;
        while (!done) {
            const result = await reader.read();
            done = result.done;
            if (result.value) chunks.push(result.value);
        }

        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        const downloadedBytes = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            downloadedBytes.set(chunk, offset);
            offset += chunk.length;
        }

        const invitationJson = new TextDecoder().decode(downloadedBytes);
        const invitation: CollaborationInvitation = JSON.parse(invitationJson);

        // Encrypt the document key with user's derived key for local storage
        const derivedKey = await getOrDeriveDerivedKey();
        const documentKey = fromBase64(documentKeyBase64);
        const keyShare = encryptKeyForCollaborator(documentKey, derivedKey, wallet);

        // Create the draft locally
        const draft: Draft = {
            draftId: invitation.draftId,
            title: invitation.draftTitle,
            owner: invitation.owner,
            collaborators: [{
                wallet: wallet,
                name: wallet,
                keyShare: keyShare,
                addedAt: invitation.createdAt,
                addedBy: invitation.invitedBy,
            }],
            status: 'shared',
            versions: [{
                version: invitation.latestVersion,
                actionId: invitation.latestActionId,
                createdAt: invitation.createdAt,
                createdBy: invitation.owner,
                message: 'Shared draft',
            }],
            ownerEncryptedKey: '',
            ownerKeyNonce: '',
            createdAt: invitation.createdAt,
            updatedAt: Date.now(),
        };

        saveDraft(draft);
        console.log(`✅ Imported draft: ${invitation.draftTitle}`);
        return true;
    } catch (error) {
        console.error('Failed to import draft:', error);
        return false;
    }
}

/**
 * Upload collaboration invitation to Cascade
 * This allows the collaborator to discover the draft via Lumescope
 */
async function uploadCollaborationInvitation(
    draft: Draft,
    collaborator: Collaborator
): Promise<string> {
    const lumeraClient = getLumeraClient();
    if (!lumeraClient) throw new Error('Cascade client not initialized');

    const latestVersion = draft.versions[draft.versions.length - 1];

    const invitation: CollaborationInvitation = {
        version: 1,
        type: 'draft_invitation',
        draftId: draft.draftId,
        draftTitle: draft.title,
        owner: draft.owner,
        ownerName: draft.owner,
        invitedWallet: collaborator.wallet,
        keyShare: {
            wallet: collaborator.wallet,
            encryptedKey: collaborator.keyShare.encryptedKey,
            nonce: collaborator.keyShare.nonce,
        },
        latestVersion: latestVersion.version,
        latestActionId: latestVersion.actionId,
        createdAt: Date.now(),
        invitedBy: draft.owner,
    };

    const invitationJson = JSON.stringify(invitation);
    const invitationBytes = new TextEncoder().encode(invitationJson);
    const fileName = `invitation_${collaborator.wallet}_${draft.draftId}.json`;

    const expirationTime = Math.floor(Date.now() / 1000) + 90000 * 30;
    const uploadResult = await lumeraClient.Cascade.uploader.uploadFile(invitationBytes, {
        fileName,
        isPublic: true,
        expirationTime: expirationTime.toString(),
        taskOptions: { pollInterval: 2000, timeout: 300000 },
    });

    // Extract action ID from result
    const actionId = uploadResult.taskId || (uploadResult as any).actionId || '';
    console.log('✉️ Invitation uploaded, action ID:', actionId);
    console.log('Upload result:', uploadResult);
    return actionId;
}

/**
 * Get document key for a draft
 */
async function getDocumentKey(draft: Draft): Promise<Uint8Array> {
    const wallet = getConnectedAddress();
    if (!wallet) throw new Error('Not connected');

    const derivedKey = await getOrDeriveDerivedKey();

    // If owner, use owner's key share
    if (draft.owner === wallet) {
        const ownerShare: EncryptedKeyShare = {
            wallet,
            encryptedKey: draft.ownerEncryptedKey,
            nonce: draft.ownerKeyNonce,
        };
        return decryptKeyShare(ownerShare, derivedKey);
    }

    // If collaborator, find their key share
    const collaborator = draft.collaborators.find((c) => c.wallet === wallet);
    if (collaborator) {
        console.log('🔑 Found collaborator key share for wallet:', wallet);
        
        // Check if the key share is valid (not empty)
        if (!collaborator.keyShare.encryptedKey || !collaborator.keyShare.nonce) {
            throw new Error('NO_KEY_SHARE: You need to use the invitation link to access this draft. Please ask the draft owner to send you the secure link.');
        }
        
        return decryptKeyShare(collaborator.keyShare, derivedKey);
    }

    console.error('❌ No key access found for wallet:', wallet);
    throw new Error('No access to this draft');
}

// ============================================================
// LOCAL STORAGE
// ============================================================

/**
 * Get all drafts from localStorage
 */
export function getAllDrafts(): Draft[] {
    try {
        const stored = localStorage.getItem(DRAFTS_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

/**
 * Get a specific draft
 */
export function getDraft(draftId: string): Draft | null {
    const drafts = getAllDrafts();
    return drafts.find((d) => d.draftId === draftId) || null;
}

/**
 * Save a draft to localStorage
 */
function saveDraft(draft: Draft): void {
    const drafts = getAllDrafts();
    const index = drafts.findIndex((d) => d.draftId === draft.draftId);
    if (index >= 0) {
        drafts[index] = draft;
    } else {
        drafts.push(draft);
    }
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

/**
 * Get stored draft summaries for display
 */
export function getStoredDrafts(): StoredDraft[] {
    return getAllDrafts().map((d) => ({
        draftId: d.draftId,
        title: d.title,
        status: d.status,
        collaboratorCount: d.collaborators.length,
        latestVersion: d.versions[d.versions.length - 1]?.version || 1,
        updatedAt: d.updatedAt,
    }));
}

/**
 * Fetch collaboration invitations for the current user
 * 
 * NOTE: We no longer auto-download invitations because:
 * 1. The invitation file doesn't contain a usable key (key comes from share link URL)
 * 2. Downloading triggers unnecessary SDK signatures
 * 3. The draft is only useful AFTER user clicks the share link anyway
 * 
 * Invitations are now discovered when user clicks the share link.
 * This function is kept for backwards compatibility but does nothing.
 */
async function fetchCollaborationInvitations(walletAddress: string): Promise<void> {
    // Intentionally empty - invitations are processed when user clicks share link
    // This avoids unnecessary SDK downloads and signature prompts
    console.log(`📬 Invitation discovery is now link-based (no auto-download)`);
}

/**
 * Process a collaboration invitation
 */
async function processInvitation(actionId: string): Promise<void> {
    const lumeraClient = getLumeraClient();
    if (!lumeraClient) throw new Error('Cascade client not initialized');

    const downloadStream = await lumeraClient.Cascade.downloader.download(actionId);
    const reader = downloadStream.getReader();
    const chunks: Uint8Array[] = [];
    let done = false;
    while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) chunks.push(result.value);
    }

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const downloadedBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        downloadedBytes.set(chunk, offset);
        offset += chunk.length;
    }

    const invitationJson = new TextDecoder().decode(downloadedBytes);
    const invitation: CollaborationInvitation = JSON.parse(invitationJson);

    console.log(`📬 Processing invitation for draft: ${invitation.draftTitle}`);

    const existingDraft = getDraft(invitation.draftId);

    // Check if current user is already a collaborator
    if (existingDraft) {
        const isAlreadyCollaborator = existingDraft.collaborators.some(
            c => c.wallet === invitation.invitedWallet
        );

        if (isAlreadyCollaborator) {
            console.log(`Already a collaborator on draft ${invitation.draftId}`);
            return;
        }

        // Add as collaborator to existing draft
        const collaborator: Collaborator = {
            wallet: invitation.invitedWallet,
            name: invitation.invitedWallet,
            keyShare: {
                wallet: invitation.keyShare.wallet,
                encryptedKey: invitation.keyShare.encryptedKey,
                nonce: invitation.keyShare.nonce,
            },
            addedAt: invitation.createdAt,
            addedBy: invitation.invitedBy,
        };

        existingDraft.collaborators.push(collaborator);
        existingDraft.status = 'shared';
        existingDraft.updatedAt = Date.now();
        saveDraft(existingDraft);
        console.log(`✅ Added as collaborator to existing draft: ${invitation.draftTitle}`);
        return;
    }

    // Create new draft from invitation
    const draft: Draft = {
        draftId: invitation.draftId,
        title: invitation.draftTitle,
        owner: invitation.owner,
        collaborators: [],
        status: 'shared',
        versions: [
            {
                version: invitation.latestVersion,
                actionId: invitation.latestActionId,
                createdAt: invitation.createdAt,
                createdBy: invitation.owner,
                message: 'Shared draft',
            },
        ],
        ownerEncryptedKey: '',
        ownerKeyNonce: '',
        createdAt: invitation.createdAt,
        updatedAt: invitation.createdAt,
    };

    const collaborator: Collaborator = {
        wallet: invitation.invitedWallet,
        name: invitation.invitedWallet,
        keyShare: {
            wallet: invitation.keyShare.wallet,
            encryptedKey: invitation.keyShare.encryptedKey,
            nonce: invitation.keyShare.nonce,
        },
        addedAt: invitation.createdAt,
        addedBy: invitation.invitedBy,
    };

    draft.collaborators.push(collaborator);
    saveDraft(draft);
    console.log(`✅ Added shared draft: ${invitation.draftTitle}`);
}

/**
 * Fetch user's drafts from Lumescope and merge with local encrypted keys
 * This discovers all encrypted drafts created by the wallet address
 * AND syncs versions from collaborators
 * Falls back to localStorage-only if Lumescope is unavailable
 */
export async function fetchUserDrafts(walletAddress: string): Promise<StoredDraft[]> {
    // First, check for collaboration invitations (only new ones, skips already-processed)

    await fetchCollaborationInvitations(walletAddress);

    try {
        // Get drafts created by this wallet
        const actions = await getActionsByCreator(walletAddress, 'ACTION_TYPE_CASCADE');

        // Filter for encrypted drafts (by filename pattern)
        const draftActions = actions.filter((action) => {
            const fileName = action.decoded?.file_name || '';
            return (
                fileName.startsWith('draft_') &&
                fileName.endsWith('.json') &&
                action.state === 'ACTION_STATE_DONE'
            );
        });

        // Group by draftId to reconstruct version history
        // We'll need to download and parse each draft to get full metadata
        // For now, extract draftId from filename: draft_{draftId}_v{version}.json
        const draftMap = new Map<string, any[]>();
        for (const action of draftActions) {
            const fileName = action.decoded?.file_name || '';
            const match = fileName.match(/draft_([^_]+)_v(\d+)\.json/);
            if (!match) continue;

            const draftId = match[1];
            const version = parseInt(match[2], 10);

            if (!draftMap.has(draftId)) {
                draftMap.set(draftId, []);
            }
            draftMap.get(draftId)!.push({
                version,
                actionId: action.id,
                createdAt: Date.now(),
                createdBy: action.creator,
                title: `Draft ${draftId}`,
            });
        }

        // IMPORTANT: Also fetch ALL actions to find versions created by collaborators
        // This is necessary because collaborators' saves are under THEIR wallet, not the owner's
        const { getAllActions } = await import('./lumescope');
        const allActions = await getAllActions(200);
        
        // For each draft the owner created, check for additional versions from collaborators
        for (const [draftId, _versions] of draftMap.entries()) {
            const collaboratorVersions = allActions.filter((action) => {
                const fileName = action.decoded?.file_name || '';
                const match = fileName.match(/draft_([^_]+)_v(\d+)\.json/);
                return (
                    match && 
                    match[1] === draftId && 
                    action.state === 'ACTION_STATE_DONE' &&
                    action.creator !== walletAddress // Only collaborator versions
                );
            });

            for (const action of collaboratorVersions) {
                const fileName = action.decoded?.file_name || '';
                const match = fileName.match(/draft_([^_]+)_v(\d+)\.json/);
                if (!match) continue;

                const version = parseInt(match[2], 10);
                const existsInMap = draftMap.get(draftId)!.some(v => v.version === version);
                
                if (!existsInMap) {
                    console.log(`📥 Found collaborator version for draft ${draftId}: v${version} by ${action.creator}`);
                    draftMap.get(draftId)!.push({
                        version,
                        actionId: action.id,
                        createdAt: Date.now(),
                        createdBy: action.creator,
                        title: `Draft ${draftId}`,
                    });
                }
            }
        }

        // Convert to StoredDraft format
        const storedDrafts: StoredDraft[] = [];
        for (const [draftId, versions] of draftMap.entries()) {
            // Sort versions
            versions.sort((a, b) => a.version - b.version);
            const latestVersion = versions[versions.length - 1];

            // Check if we have keys for this draft in localStorage
            const localDraft = getDraft(draftId);
            const hasKeys = !!localDraft;

            // Sync versions from Cascade to local draft
            if (localDraft) {
                const localLatestVersion = localDraft.versions[localDraft.versions.length - 1]?.version || 0;
                
                // If Cascade has newer versions, update local draft
                if (latestVersion.version > localLatestVersion) {
                    console.log(`📥 Syncing new versions for draft ${draftId}: local v${localLatestVersion} -> cascade v${latestVersion.version}`);
                    
                    // Add missing versions to local draft
                    for (const v of versions) {
                        const exists = localDraft.versions.some(lv => lv.version === v.version);
                        if (!exists) {
                            localDraft.versions.push({
                                version: v.version,
                                actionId: v.actionId,
                                createdAt: v.createdAt,
                                createdBy: v.createdBy,
                                message: 'Synced from Cascade',
                            });
                        }
                    }
                    
                    // Sort versions
                    localDraft.versions.sort((a, b) => a.version - b.version);
                    localDraft.updatedAt = Date.now();
                    saveDraft(localDraft);
                }
            }

            storedDrafts.push({
                draftId,
                title: hasKeys ? localDraft!.title : latestVersion.title,
                status: hasKeys ? localDraft!.status : 'draft',
                collaboratorCount: hasKeys ? localDraft!.collaborators.length : 0,
                latestVersion: latestVersion.version,
                updatedAt: latestVersion.createdAt,
            });

            // If we don't have local keys, we can't decrypt this draft
            // (e.g., if localStorage was cleared or viewing from another device)
            // In this case, we still show it but user can't open it
        }

        return storedDrafts;
    } catch (error) {
        console.warn('Lumescope unavailable, using localStorage-only drafts:', error);

        // Fallback to localStorage-only (drafts created on this device)
        return getStoredDrafts();
    }
}

/**
 * Delete a draft
 */
export function deleteDraft(draftId: string): void {
    const drafts = getAllDrafts().filter((d) => d.draftId !== draftId);
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

/**
 * Fetch drafts that the user has been invited to collaborate on
 * These are drafts where the user is NOT the owner but IS a collaborator
 * Also syncs version info from Cascade
 */
export async function fetchInvitedDrafts(walletAddress: string): Promise<StoredDraft[]> {
    // First, ensure we've checked for collaboration invitations
    await fetchCollaborationInvitations(walletAddress);

    // Get all drafts from localStorage
    const allDrafts = getAllDrafts();

    // Filter for drafts where user is a collaborator but not the owner
    const invitedDrafts = allDrafts.filter(draft => {
        const isOwner = draft.owner === walletAddress;
        const isCollaborator = draft.collaborators.some(c => c.wallet === walletAddress);
        return !isOwner && isCollaborator;
    });

    // Sync versions from Cascade for each invited draft
    try {
        const { getAllActions } = await import('./lumescope');
        const actions = await getAllActions(100);

        for (const draft of invitedDrafts) {
            // Find all versions of this draft on Cascade
            const draftVersions = actions.filter((action) => {
                const fileName = action.decoded?.file_name || '';
                const match = fileName.match(/draft_([^_]+)_v(\d+)\.json/);
                return match && match[1] === draft.draftId && action.state === 'ACTION_STATE_DONE';
            });

            // Parse versions
            const cascadeVersions = draftVersions.map((action) => {
                const fileName = action.decoded?.file_name || '';
                const match = fileName.match(/draft_([^_]+)_v(\d+)\.json/);
                return {
                    version: match ? parseInt(match[2], 10) : 0,
                    actionId: action.id,
                    createdAt: Date.now(),
                    createdBy: action.creator,
                };
            }).filter(v => v.version > 0);

            if (cascadeVersions.length > 0) {
                cascadeVersions.sort((a, b) => a.version - b.version);
                const latestCascadeVersion = cascadeVersions[cascadeVersions.length - 1];
                const localLatestVersion = draft.versions[draft.versions.length - 1]?.version || 0;

                if (latestCascadeVersion.version > localLatestVersion) {
                    console.log(`📥 Syncing invited draft ${draft.draftId}: local v${localLatestVersion} -> cascade v${latestCascadeVersion.version}`);

                    // Add missing versions
                    for (const cv of cascadeVersions) {
                        const exists = draft.versions.some(v => v.version === cv.version);
                        if (!exists) {
                            draft.versions.push({
                                version: cv.version,
                                actionId: cv.actionId,
                                createdAt: cv.createdAt,
                                createdBy: cv.createdBy,
                                message: 'Synced from Cascade',
                            });
                        }
                    }

                    // Sort and save
                    draft.versions.sort((a, b) => a.version - b.version);
                    draft.updatedAt = Date.now();
                    saveDraft(draft);
                }
            }
        }
    } catch (error) {
        console.warn('Failed to sync invited drafts from Cascade:', error);
    }

    // Convert to StoredDraft format
    return invitedDrafts.map(draft => ({
        draftId: draft.draftId,
        title: draft.title,
        status: draft.status,
        collaboratorCount: draft.collaborators.length,
        latestVersion: draft.versions[draft.versions.length - 1]?.version || 1,
        updatedAt: draft.updatedAt,
        owner: draft.owner,
    }));
}

/**
 * Check if user is the owner of a draft
 */
export function isDraftOwner(draftId: string): boolean {
    const draft = getDraft(draftId);
    const wallet = getConnectedAddress();
    return draft !== null && wallet !== null && draft.owner === wallet;
}

/**
 * Check if user has access to a draft (owner or collaborator)
 */
export function hasAccessToDraft(draftId: string): boolean {
    const draft = getDraft(draftId);
    const wallet = getConnectedAddress();
    if (!draft || !wallet) return false;

    if (draft.owner === wallet) return true;
    return draft.collaborators.some(c => c.wallet === wallet);
}

/**
 * Check if user has a valid encryption key for a draft
 * Returns true if owner or if collaborator with valid keyShare
 */
export function hasValidKeyForDraft(draftId: string): boolean {
    const draft = getDraft(draftId);
    const wallet = getConnectedAddress();
    if (!draft || !wallet) return false;

    // Owner always has key
    if (draft.owner === wallet && draft.ownerEncryptedKey) {
        return true;
    }

    // Check collaborator key
    const collaborator = draft.collaborators.find(c => c.wallet === wallet);
    if (collaborator && collaborator.keyShare.encryptedKey && collaborator.keyShare.nonce) {
        return true;
    }

    return false;
}

