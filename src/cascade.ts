/**
 * Cascade Module
 * Handles file upload and download operations using Lumera's Cascade storage
 * Extended for Research Archive functionality
 */

import {
    createLumeraClient,
    type LumeraClient,
    getKeplrSigner,
} from '@lumera-protocol/sdk-js';
import { getConnectedAddress, isWalletConnected } from './wallet';
import { GAS_PRICE, CHAIN_ID, LUMESCOPE_API_BASE } from './config';
import {
    type ResearchPaper,
    type Author,
    type StoredPaper,
    createPaperManifest,
    parsePaperManifest,
    extractContent,
} from './paper';
import { getActionsByCreator } from './lumescope';

// Lumera client instance
let lumeraClient: LumeraClient | null = null;

// localStorage fallback when Lumescope is unavailable
const PAPERS_STORAGE_KEY = 'lumera_research_archive_papers_fallback';

/**
 * Initialize the Lumera client with the connected wallet
 * Must be called after wallet connection
 */
export async function initializeCascadeClient(): Promise<void> {
    if (!isWalletConnected()) {
        throw new Error('Wallet must be connected before initializing Cascade client');
    }

    const address = getConnectedAddress();

    if (!address) {
        throw new Error('Unable to get wallet address');
    }

    try {
        // Use the SDK's getKeplrSigner which returns a UniversalSigner
        // that properly supports signArbitrary for ADR-036 signing
        const signer = await getKeplrSigner(CHAIN_ID);

        // Create the Lumera client using the testnet preset
        lumeraClient = await createLumeraClient({
            preset: 'testnet',
            signer: signer,
            address: address,
            gasPrice: GAS_PRICE,
        });

        console.log('Cascade client initialized');
    } catch (error) {
        console.error('Failed to initialize Cascade client:', error);
        throw new Error(
            error instanceof Error
                ? error.message
                : 'Failed to initialize Cascade client'
        );
    }
}

/**
 * Get the Lumera client instance
 */
export function getLumeraClient(): LumeraClient | null {
    return lumeraClient;
}

/**
 * Upload a research paper to Cascade permanent storage
 *
 * @param title - Paper title
 * @param abstract - Paper abstract
 * @param authors - List of authors
 * @param keywords - Keywords for discovery
 * @param citations - Action IDs of cited papers
 * @param content - Paper content as string
 * @param fileName - Original filename
 * @param onProgress - Optional callback for upload progress
 * @returns The action ID for retrieving the paper
 */
export async function uploadPaper(
    title: string,
    abstract: string,
    authors: Author[],
    keywords: string[],
    citations: string[],
    content: string,
    fileName: string,
    onProgress?: (progress: number) => void
): Promise<string> {
    if (!lumeraClient) {
        throw new Error('Cascade client not initialized. Please connect wallet first.');
    }

    if (!content.trim()) {
        throw new Error('Paper content cannot be empty');
    }

    if (!title.trim()) {
        throw new Error('Paper title is required');
    }

    const address = getConnectedAddress();
    if (!address) {
        throw new Error('Wallet not connected');
    }

    try {
        console.log(`Uploading paper "${title}"...`);
        onProgress?.(5);

        // Convert content to bytes
        const contentBytes = new TextEncoder().encode(content);

        // Create paper metadata
        const metadata: Omit<ResearchPaper, 'actionId'> = {
            title,
            abstract,
            authors,
            keywords,
            citations,
            submittedBy: address,
            submittedAt: Date.now(),
            contentHash: '', // Will be filled by SDK
            fileName,
            fileSize: contentBytes.length,
        };

        // Create paper manifest (wraps content with metadata)
        const manifest = createPaperManifest(metadata, contentBytes);
        const manifestJson = JSON.stringify(manifest);
        const manifestBytes = new TextEncoder().encode(manifestJson);

        onProgress?.(10);

        // Calculate expiration time (25 hours from now)
        // Blockchain requires minimum 24 hours (86400 seconds)
        const expirationTime = Math.floor(Date.now() / 1000) + 90000;

        console.log('📦 Upload details:', {
            manifestSize: manifestBytes.length,
            fileName: `${title.replace(/[^a-zA-Z0-9]/g, '_')}.json`,
            isPublic: true,
            expirationTime: expirationTime.toString(),
        });

        // Upload to Cascade
        const uploadResult = await lumeraClient.Cascade.uploader.uploadFile(manifestBytes, {
            fileName: `${title.replace(/[^a-zA-Z0-9]/g, '_')}.json`,
            isPublic: true,
            expirationTime: expirationTime.toString(),
            taskOptions: {
                pollInterval: 2000,
                timeout: 300000,
            },
        });

        onProgress?.(90);
        console.log('✅ Upload completed successfully:', JSON.stringify(uploadResult, null, 2));

        // Get action ID from result
        const actionId = (uploadResult as { action_id?: string }).action_id ||
            uploadResult.taskId ||
            `paper-${Date.now()}`;

        // Save to localStorage fallback for offline access
        savePaperToFallback({
            actionId,
            title,
            authors: authors.map((a) => a.name),
            submittedAt: Date.now(),
            fileSize: contentBytes.length,
        });

        onProgress?.(100);
        return actionId;
    } catch (error) {
        console.error('❌ Failed to upload paper:', error);
        console.error('Error details:', {
            name: error instanceof Error ? error.name : 'Unknown',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        throw new Error(
            error instanceof Error
                ? error.message
                : 'Failed to upload paper to Cascade'
        );
    }
}

/**
 * Download and parse a research paper from Cascade
 *
 * @param actionId - The action ID from the upload
 * @param onProgress - Optional callback for download progress
 * @returns The parsed paper manifest with content
 */
export async function downloadPaper(
    actionId: string,
    onProgress?: (progress: number) => void
): Promise<{ paper: ResearchPaper; content: string }> {
    if (!lumeraClient) {
        throw new Error('Cascade client not initialized. Please connect wallet first.');
    }

    try {
        console.log(`Downloading paper with action ID: ${actionId}`);
        onProgress?.(10);

        // Download from Cascade as stream
        const downloadStream = await lumeraClient.Cascade.downloader.download(actionId);
        onProgress?.(30);

        // Read the stream
        const reader = downloadStream.getReader();
        const chunks: Uint8Array[] = [];

        let done = false;
        while (!done) {
            const result = await reader.read();
            done = result.done;
            if (result.value) {
                chunks.push(result.value);
            }
        }
        onProgress?.(60);

        // Combine chunks
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const downloadedBytes = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            downloadedBytes.set(chunk, offset);
            offset += chunk.length;
        }

        // Parse as JSON manifest
        const manifestJson = new TextDecoder().decode(downloadedBytes);
        const manifest = parsePaperManifest(manifestJson);

        if (!manifest) {
            throw new Error('Downloaded data is not a valid research paper');
        }

        onProgress?.(80);

        // Extract content from manifest
        const contentBytes = extractContent(manifest);
        const content = new TextDecoder().decode(contentBytes);

        // Reconstruct full paper object
        const paper: ResearchPaper = {
            actionId,
            ...manifest.metadata,
        };

        onProgress?.(100);
        console.log('Download completed');

        return { paper, content };
    } catch (error) {
        console.error('Failed to download paper:', error);
        throw new Error(
            error instanceof Error
                ? error.message
                : 'Failed to download paper from Cascade'
        );
    }
}

/**
 * Fetch user's published papers from Lumescope
 * Discovers all Cascade actions created by the wallet address
 * Falls back to localStorage if Lumescope is unavailable
 */
export async function fetchUserPapers(walletAddress: string): Promise<StoredPaper[]> {
    try {
        const actions = await getActionsByCreator(walletAddress, 'cascade');
        console.log('📄 Total Cascade actions found:', actions.length);

        // Filter for research papers
        // We need to download and parse each action to check if it's a research paper
        // For now, filter by mime_type and file_name pattern
        const paperActions = actions.filter((action) => {
            const isJson = action.mime_type === 'application/json';
            const isDone = action.state === 'ACTION_STATE_DONE';
            const fileName = action.decoded?.file_name || '';
            const looksLikePaper = fileName.endsWith('.json') && !fileName.includes('draft_') && !fileName.startsWith('invitation_');

            console.log(`Action ${action.id}:`, {
                mimeType: action.mime_type,
                fileName,
                state: action.state,
                isJson,
                isDone,
                looksLikePaper,
                willInclude: isJson && isDone && looksLikePaper,
            });

            return isJson && isDone && looksLikePaper;
        });

        console.log('📄 Research papers after filtering:', paperActions.length);

        // For now, we'll need to download each paper to get full metadata
        // As a temporary solution, use filename and action ID
        const papers = paperActions.map((action) => ({
            actionId: action.id,
            title: action.decoded?.file_name?.replace('.json', '') || 'Untitled',
            authors: [walletAddress], // We'd need to download to get real authors
            submittedAt: Date.now(), // We'd need block timestamp
            fileSize: action.size || 0,
        }));

        // Cache in localStorage for offline access
        localStorage.setItem(PAPERS_STORAGE_KEY, JSON.stringify(papers));
        return papers;
    } catch (error) {
        console.warn('Lumescope unavailable, using localStorage fallback:', error);

        // Fallback to localStorage
        try {
            const stored = localStorage.getItem(PAPERS_STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    }
}

/**
 * Save paper to localStorage fallback (called after upload)
 */
export function savePaperToFallback(paper: StoredPaper): void {
    try {
        const papers = JSON.parse(localStorage.getItem(PAPERS_STORAGE_KEY) || '[]');
        papers.push(paper);
        localStorage.setItem(PAPERS_STORAGE_KEY, JSON.stringify(papers));
    } catch (error) {
        console.error('Failed to save paper to fallback:', error);
    }
}

/**
 * Fetch ALL published papers from Lumescope (not just user's papers)
 * Shows all research papers on the blockchain
 */
export async function fetchAllPublications(): Promise<StoredPaper[]> {
    try {
        // Query Lumescope for all Cascade actions (no creator filter)
        const url = `${LUMESCOPE_API_BASE}/v1/actions?limit=100`;
        console.log('🔍 Querying all publications:', url);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Lumescope API error: ${response.status}`);
        }

        const data = await response.json();
        const actions = data.items || [];

        // Filter for Cascade actions that look like research papers
        const paperActions = actions.filter((action: any) => {
            const isJson = action.mime_type === 'application/json';
            const isDone = action.state === 'ACTION_STATE_DONE';
            const fileName = action.decoded?.file_name || '';
            const looksLikePaper = fileName.endsWith('.json') && !fileName.includes('draft_') && !fileName.startsWith('invitation_');
            const isCascade = action.type === 'ACTION_TYPE_CASCADE';

            return isCascade && isJson && isDone && looksLikePaper;
        });

        console.log('📚 Total publications found:', paperActions.length);

        // Convert to StoredPaper format
        const papers = paperActions.map((action: any) => ({
            actionId: action.id,
            title: action.decoded?.file_name?.replace('.json', '') || 'Untitled',
            authors: [action.creator], // We'd need to download to get real authors
            submittedAt: Date.now(),
            fileSize: action.size || 0,
        }));

        return papers;
    } catch (error) {
        console.error('Failed to fetch publications from Lumescope:', error);
        return [];
    }
}
