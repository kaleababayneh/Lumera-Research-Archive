/**
 * Lumescope API Client
 * Fetches actions and metadata from Lumescope indexer
 */

import { LUMESCOPE_API_BASE, LIMIT } from './config';

/**
 * Lumescope action response
 */
export interface LumescopeAction {
    /** Action ID (e.g., "12345") */
    id: string;
    /** Action type (e.g., "ACTION_TYPE_CASCADE") */
    type: string;
    /** Creator wallet address */
    creator: string;
    /** Action state (e.g., "ACTION_STATE_DONE") */
    state: string;
    /** Decoded action data (contains metadata) */
    decoded?: {
        data_hash: string;
        file_name: string;
        public: boolean;
        [key: string]: any;
    };
    /** MIME type (for Cascade actions) */
    mime_type?: string;
    /** File size in bytes */
    size?: number;
    /** Block height */
    block_height?: number;
    /** Schema version */
    schema_version?: string;
}

/**
 * Helper to get metadata from action
 * Metadata can be embedded in decoded.file_name as JSON
 */
export function getActionMetadata(action: LumescopeAction): any {
    // For research papers, metadata is in the file content (JSON manifest)
    // We'll need to download and parse it, but for now return decoded info
    return action.decoded || {};
}

/**
 * Lumescope paginated response
 */
interface LumescopeResponse {
    items: LumescopeAction[];
    cursor?: string;
    total?: number;
}

/**
 * Fetch actions by creator address
 */
export async function getActionsByCreator(
    creatorAddress: string,
    type?: 'cascade' | 'sense',
    limit = 100
): Promise<LumescopeAction[]> {
    const params = new URLSearchParams({
        creator: creatorAddress,
        limit: LIMIT.toString(),
    });

    // Note: Lumescope doesn't support filtering by type in the query
    // We'll filter client-side instead

    const url = `${LUMESCOPE_API_BASE}/v1/actions?${params}`;

    try {
        console.log('🔍 Querying Lumescope:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Lumescope API error: ${response.status} ${response.statusText}`);
        }

        const data: LumescopeResponse = await response.json();
        console.log('📦 Lumescope response:', {
            total: data.total,
            itemCount: data.items?.length || 0,
            items: data.items,
        });

        // Filter by type client-side if specified
        let items = data.items || [];
        if (type) {
            const typeFilter = type === 'cascade' ? 'ACTION_TYPE_CASCADE' : 'ACTION_TYPE_SENSE';
            items = items.filter(item => item.type === typeFilter);
            console.log(`📦 After filtering for ${typeFilter}:`, items.length);
        }

        return items;
    } catch (error) {
        console.error('Failed to fetch actions from Lumescope:', error);
        throw new Error(
            error instanceof Error
                ? `Lumescope error: ${error.message}`
                : 'Failed to connect to Lumescope'
        );
    }
}

/**
 * Fetch ALL actions (no creator filter)
 */
export async function getAllActions(limit = 100): Promise<LumescopeAction[]> {
    const params = new URLSearchParams({
        limit: LIMIT.toString(),
    });

    const url = `${LUMESCOPE_API_BASE}/v1/actions?${params}`;

    try {
        console.log('🔍 Querying all actions from Lumescope');
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Lumescope API error: ${response.status}`);
        }

        const data: LumescopeResponse = await response.json();
        console.log(`📦 Total actions: ${data.items?.length || 0}`);

        return data.items || [];
    } catch (error) {
        console.error('Lumescope query failed:', error);
        return [];
    }
}

/**
 * Fetch a specific action by ID
 */
export async function getAction(actionId: string): Promise<LumescopeAction | null> {
    const url = `${LUMESCOPE_API_BASE}/v1/actions/${actionId}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) {
                return null;
            }
            throw new Error(`Lumescope API error: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error(`Failed to fetch action ${actionId}:`, error);
        return null;
    }
}

/**
 * Check if Lumescope is available
 */
export async function checkLumescopeHealth(): Promise<boolean> {
    try {
        const response = await fetch(`${LUMESCOPE_API_BASE}/healthz`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000),
        });
        return response.ok;
    } catch {
        return false;
    }
}
