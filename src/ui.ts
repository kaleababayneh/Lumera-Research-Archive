/**
 * UI Module
 * Handles DOM manipulation and user interactions for Research Archive
 */

import {
    connectWallet,
    disconnectWallet,
    getConnectedAddress,
    isWalletConnected,
    isKeplrInstalled,
    formatAddress,
} from './wallet';
import {
    initializeCascadeClient,
    uploadPaper,
    downloadPaper,
    fetchUserPapers,
    fetchAllPublications,
} from './cascade';
import {
    initDrafts,
    createDraft,
    saveDraftVersion,
    loadDraftContent,
    addCollaborator,
    fetchUserDrafts,
    fetchInvitedDrafts,
    getDraft,
    clearDerivedKey,
    isDraftOwner,
} from './drafts';
import { type Author, formatPaperUri, type Draft } from './paper';

// Current state
let currentTab: string = 'drafts';
console.log('🌐 UI module loaded', currentTab);
let currentDraftId: string | null = null;

// DOM Elements (initialized in initUI)
let walletButton: HTMLButtonElement;
let walletStatus: HTMLElement;
let tabNav: HTMLElement;
let statusMessage: HTMLElement;

/**
 * Initialize the UI
 */
export function initUI(): void {
    // Get DOM elements
    walletButton = document.getElementById('wallet-button') as HTMLButtonElement;
    walletStatus = document.getElementById('wallet-status') as HTMLElement;
    tabNav = document.getElementById('tab-nav') as HTMLElement;
    statusMessage = document.getElementById('status-message') as HTMLElement;

    // Setup event listeners
    walletButton.addEventListener('click', handleWalletClick);

    // Tab navigation
    document.querySelectorAll('.tab-button').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const tab = (e.target as HTMLElement).dataset.tab!;
            switchTab(tab);
        });
    });

    // Drafts tab
    document.getElementById('new-draft-button')?.addEventListener('click', handleNewDraft);
    document.getElementById('save-draft-button')?.addEventListener('click', handleSaveDraft);
    document.getElementById('publish-draft-button')?.addEventListener('click', handlePublishDraft);
    document.getElementById('close-editor-button')?.addEventListener('click', closeEditor);
    document.getElementById('add-collaborator-button')?.addEventListener('click', handleAddCollaborator);

    // Publish tab
    document.getElementById('upload-form')?.addEventListener('submit', handleUpload);

    // Check Keplr availability
    if (!isKeplrInstalled()) {
        showStatus('Keplr wallet not detected. Please install Keplr extension.', 'error');
        walletButton.textContent = 'Install Keplr';
        walletButton.addEventListener('click', () => {
            window.open('https://www.keplr.app/', '_blank');
        });
    }

    updateUI();
}

/**
 * Switch between tabs
 */
function switchTab(tab: string): void {
    currentTab = tab;

    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach((btn) => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach((content) => {
        content.classList.toggle('active', content.id === `tab-${tab}`);
        content.classList.toggle('hidden', content.id !== `tab-${tab}`);
    });

    // Load publications when switching to that tab
    if (tab === 'publications') {
        renderPublicationsList();
    }

    // Load invited drafts when switching to that tab
    if (tab === 'invited') {
        renderInvitedDraftsList();
    }
}

/**
 * Handle wallet connect/disconnect
 */
async function handleWalletClick(): Promise<void> {
    if (isWalletConnected()) {
        disconnectWallet();
        clearDerivedKey();
        closeEditor();
        updateUI();
        showStatus('Wallet disconnected', 'info');
    } else {
        walletButton.disabled = true;
        walletButton.textContent = 'Connecting...';

        try {
            await connectWallet();
            await initializeCascadeClient();
            await initDrafts();
            updateUI();
            
            // Check for pending share link
            await processPendingShareLink();
            
            showStatus('Wallet connected! Ready to create encrypted drafts.', 'success');
        } catch (error) {
            console.error('Connection error:', error);
            showStatus(
                error instanceof Error ? error.message : 'Failed to connect wallet',
                'error'
            );
            updateUI();
        }
    }
}

/**
 * Process a pending secure share link after wallet connection
 */
async function processPendingShareLink(): Promise<void> {
    const pendingLinkJson = sessionStorage.getItem('pendingShareLink');
    if (!pendingLinkJson) return;

    try {
        const { draftId, documentKey } = JSON.parse(pendingLinkJson);
        sessionStorage.removeItem('pendingShareLink');

        console.log(`🔐 Processing secure share link for draft: ${draftId}`);
        showStatus('Processing invitation link...', 'info');

        const { processSecureShareLink } = await import('./drafts');
        const result = await processSecureShareLink(draftId, documentKey);

        if (result.success) {
            showStatus(`✅ ${result.message}`, 'success');
            renderDraftsList();
            renderInvitedDraftsList();
            
            // Switch to invited drafts tab
            switchTab('invited');
        } else {
            showStatus(`❌ ${result.message}`, 'error');
        }
    } catch (error) {
        console.error('Failed to process share link:', error);
        showStatus('Failed to process invitation link', 'error');
    }
}

// ============================================================
// DRAFTS TAB
// ============================================================

/**
 * Handle creating a new draft
 */
async function handleNewDraft(): Promise<void> {
    if (!isWalletConnected()) return;

    const title = prompt('Draft title:');
    if (!title) return;

    const progressDiv = document.getElementById('draft-progress') as HTMLElement;
    progressDiv.classList.remove('hidden');

    try {
        const draft = await createDraft(title, '', {}, (progress) => {
            const fill = progressDiv.querySelector('.progress-fill') as HTMLElement;
            const text = progressDiv.querySelector('.progress-text') as HTMLElement;
            if (fill) fill.style.width = `${progress}%`;
            if (text) text.textContent = progress < 50 ? 'Encrypting...' : 'Uploading...';
        });

        showStatus(`Draft "${title}" created with encryption!`, 'success');
        openDraftEditor(draft.draftId);
        renderDraftsList();
    } catch (error) {
        console.error('Create draft error:', error);
        showStatus(
            error instanceof Error ? error.message : 'Failed to create draft',
            'error'
        );
    } finally {
        progressDiv.classList.add('hidden');
    }
}

/**
 * Open the draft editor
 */
async function openDraftEditor(draftId: string): Promise<void> {
    currentDraftId = draftId;
    const draft = getDraft(draftId);
    if (!draft) return;

    const editorSection = document.getElementById('draft-editor-section') as HTMLElement;
    const titleInput = document.getElementById('draft-title') as HTMLInputElement;
    const contentInput = document.getElementById('draft-content') as HTMLTextAreaElement;
    const editorTitle = document.getElementById('draft-editor-title') as HTMLElement;
    const statusBadge = document.getElementById('draft-status-badge') as HTMLElement;
    const collaboratorsPanel = document.querySelector('.collaborators-panel') as HTMLElement;
    const publishButton = document.getElementById('publish-draft-button') as HTMLButtonElement;
    const saveButton = document.getElementById('save-draft-button') as HTMLButtonElement;

    editorSection.classList.remove('hidden');
    titleInput.value = draft.title;
    editorTitle.textContent = draft.title;
    
    // Reset editor state
    contentInput.disabled = false;
    contentInput.placeholder = 'Write your paper here...\n\nYour content is encrypted and only visible to you and collaborators.';
    if (saveButton) saveButton.disabled = false;
    if (publishButton) publishButton.disabled = false;

    // Check if user is the owner
    const isOwner = isDraftOwner(draftId);

    // Update status badge
    if (draft.status === 'draft') {
        statusBadge.textContent = '🔒 Private';
        statusBadge.className = 'status-badge draft';
    } else {
        const roleText = isOwner ? 'Owner' : 'Collaborator';
        statusBadge.textContent = `👥 ${roleText} (${draft.collaborators.length} invited)`;
        statusBadge.className = 'status-badge shared';
    }

    // Show/hide collaborators panel based on ownership
    // Only owners can add collaborators
    if (collaboratorsPanel) {
        if (isOwner) {
            collaboratorsPanel.classList.remove('hidden');
        } else {
            collaboratorsPanel.classList.add('hidden');
        }
    }

    // Show/hide publish button - all collaborators can publish
    if (publishButton) {
        publishButton.style.display = 'inline-block';
    }

    // Load content if exists
    if (draft.versions.length > 0) {
        try {
            const { content } = await loadDraftContent(draftId);
            contentInput.value = content;
        } catch (error) {
            console.error('Load content error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to decrypt draft content';
            
            // Check if this is a missing key error
            if (errorMessage.includes('NO_KEY_SHARE')) {
                contentInput.value = '';
                contentInput.placeholder = '🔐 You need the invitation link to access this draft content.\n\nPlease ask the draft owner to send you the secure invitation link.';
                showStatus('⚠️ Missing encryption key. You need to use the invitation link to access this draft.', 'error');
                
                // Disable editing until key is imported
                contentInput.disabled = true;
                const saveBtn = document.getElementById('save-draft-button') as HTMLButtonElement;
                const publishBtn = document.getElementById('publish-draft-button') as HTMLButtonElement;
                if (saveBtn) saveBtn.disabled = true;
                if (publishBtn) publishBtn.disabled = true;
            } else {
                showStatus(errorMessage, 'error');
            }
        }
    }

    // Render collaborators
    renderCollaborators(draft);
}

/**
 * Close the editor
 */
function closeEditor(): void {
    currentDraftId = null;
    const editorSection = document.getElementById('draft-editor-section') as HTMLElement;
    editorSection.classList.add('hidden');
}

/**
 * Save the current draft
 */
async function handleSaveDraft(): Promise<void> {
    if (!currentDraftId) return;

    const content = (document.getElementById('draft-content') as HTMLTextAreaElement).value;
    const progressDiv = document.getElementById('draft-progress') as HTMLElement;
    progressDiv.classList.remove('hidden');

    try {
        await saveDraftVersion(currentDraftId, content, undefined, (progress) => {
            const fill = progressDiv.querySelector('.progress-fill') as HTMLElement;
            const text = progressDiv.querySelector('.progress-text') as HTMLElement;
            if (fill) fill.style.width = `${progress}%`;
            if (text) text.textContent = progress < 50 ? 'Encrypting...' : 'Saving...';
        });

        showStatus('Draft saved and encrypted!', 'success');
        renderDraftsList();
    } catch (error) {
        console.error('Save error:', error);
        showStatus(
            error instanceof Error ? error.message : 'Failed to save draft',
            'error'
        );
    } finally {
        progressDiv.classList.add('hidden');
    }
}

/**
 * Add a collaborator to current draft
 */
async function handleAddCollaborator(): Promise<void> {
    if (!currentDraftId) return;

    const walletInput = document.getElementById('collaborator-wallet') as HTMLInputElement;
    const nameInput = document.getElementById('collaborator-name') as HTMLInputElement;

    const wallet = walletInput.value.trim();
    const name = nameInput.value.trim() || wallet;

    if (!wallet) {
        showStatus('Enter a wallet address', 'error');
        return;
    }

    try {
        const result = await addCollaborator(currentDraftId, wallet, name);
        console.log('🔗 Add collaborator result:', result);
        console.log('🔗 Document key base64:', result.documentKeyBase64 ? 'present' : 'missing');

        walletInput.value = '';
        nameInput.value = '';

        const draft = getDraft(currentDraftId);
        if (draft) renderCollaborators(draft);

        // Show success message - user can copy link from the collaborator list
        showStatus(`Added ${name}. Click 📋 to copy their invitation link.`, 'success');

    } catch (error) {
        console.error('Add collaborator error:', error);
        showStatus(
            error instanceof Error ? error.message : 'Failed to add collaborator',
            'error'
        );
    }
}

/**
 * Render collaborators list with copy link buttons for owner
 */
function renderCollaborators(draft: Draft): void {
    const container = document.getElementById('collaborators-list') as HTMLElement;
    const currentAddress = getConnectedAddress();
    const isOwner = draft.owner === currentAddress;

    if (draft.collaborators.length === 0) {
        container.innerHTML = '<p class="empty-state-small">Only you have access</p>';
        return;
    }

    container.innerHTML = draft.collaborators
        .map(
            (c, index) => `
            <div class="collaborator-item">
                <div class="collaborator-info">
                    <span class="collaborator-name">${escapeHtml(c.name)}</span>
                    <span class="collaborator-wallet">${formatAddress(c.wallet)}</span>
                </div>
                ${isOwner && c.documentKeyBase64 ? `
                    <button class="copy-link-btn" data-index="${index}" title="Copy invitation link">
                        📋
                    </button>
                ` : ''}
            </div>
        `
        )
        .join('');

    // Add click handlers for copy buttons
    if (isOwner) {
        container.querySelectorAll('.copy-link-btn').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const index = parseInt((btn as HTMLElement).dataset.index || '0', 10);
                const collaborator = draft.collaborators[index];
                
                if (collaborator?.documentKeyBase64) {
                    const { generateShareLink } = await import('./drafts');
                    const shareLink = generateShareLink(draft.draftId, collaborator.documentKeyBase64);
                    
                    try {
                        await navigator.clipboard.writeText(shareLink);
                        btn.textContent = '✅';
                        setTimeout(() => {
                            btn.textContent = '📋';
                        }, 2000);
                    } catch (err) {
                        console.error('Failed to copy:', err);
                        showStatus('Failed to copy link', 'error');
                    }
                }
            });
        });
    }
}

/**
 * Render drafts list
 */
async function renderDraftsList(): Promise<void> {
    const container = document.getElementById('drafts-container') as HTMLElement;
    const address = getConnectedAddress();

    if (!address) {
        container.innerHTML = '<p class="empty-state">Connect wallet to view drafts.</p>';
        return;
    }

    // Show loading state
    container.innerHTML = '<p class="empty-state">Loading drafts from Lumescope...</p>';

    try {
        const drafts = await fetchUserDrafts(address);

        if (drafts.length === 0) {
            container.innerHTML = '<p class="empty-state">No drafts yet. Create your first private draft!</p>';
            return;
        }

        container.innerHTML = drafts
            .map((d) => {
                const statusIcon = d.status === 'draft' ? '🔒' : '👥';
                const date = new Date(d.updatedAt).toLocaleDateString();
                return `
                <div class="draft-card" data-draft-id="${d.draftId}">
                    <div class="draft-info">
                        <h3 class="draft-title">${escapeHtml(d.title)}</h3>
                        <p class="draft-meta">
                            <span class="draft-status">${statusIcon} ${d.status}</span>
                            <span>v${d.latestVersion}</span>
                            <span>${date}</span>
                        </p>
                    </div>
                    <button class="view-button edit-draft-btn" data-draft-id="${d.draftId}">Edit</button>
                </div>
            `;
            })
            .join('');

        // Add click handlers
        container.querySelectorAll('.edit-draft-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const draftId = (btn as HTMLElement).dataset.draftId!;
                openDraftEditor(draftId);
            });
        });
    } catch (error) {
        console.error('Failed to load drafts:', error);
        // Fallback is handled in fetchUserDrafts, so this shouldn't error
        // But if it does, show empty state
        container.innerHTML = '<p class="empty-state">No drafts yet. Create your first private draft!</p>';
    }
}

// ============================================================
// INVITED DRAFTS TAB
// ============================================================

/**
 * Render list of drafts the user has been invited to collaborate on
 */
async function renderInvitedDraftsList(): Promise<void> {
    const container = document.getElementById('invited-drafts-container') as HTMLElement;
    const address = getConnectedAddress();

    if (!address) {
        container.innerHTML = '<p class="empty-state">Connect wallet to view invited drafts.</p>';
        return;
    }

    // Show loading state
    container.innerHTML = '<p class="empty-state">Loading invited drafts...</p>';

    try {
        const drafts = await fetchInvitedDrafts(address);
        const { hasValidKeyForDraft } = await import('./drafts');

        if (drafts.length === 0) {
            container.innerHTML = '<p class="empty-state">No invitations yet. When someone invites you to collaborate, their drafts will appear here.</p>';
            return;
        }

        container.innerHTML = drafts
            .map((d) => {
                const date = new Date(d.updatedAt).toLocaleDateString();
                const ownerDisplay = d.owner ? formatAddress(d.owner) : 'Unknown';
                const hasKey = hasValidKeyForDraft(d.draftId);
                const keyStatus = hasKey 
                    ? '<span style="color: #4caf50;">🔓 Access granted</span>'
                    : '<span style="color: #ff9800;">🔐 Needs invitation link</span>';
                
                return `
                <div class="draft-card invited ${!hasKey ? 'needs-key' : ''}" data-draft-id="${d.draftId}">
                    <div class="draft-info">
                        <h3 class="draft-title">${escapeHtml(d.title)}</h3>
                        <p class="draft-meta">
                            <span class="draft-status">📨 Invited</span>
                            <span>Owner: ${ownerDisplay}</span>
                            <span>v${d.latestVersion}</span>
                            <span>${date}</span>
                        </p>
                        <p class="draft-key-status">${keyStatus}</p>
                    </div>
                    <button class="view-button edit-invited-draft-btn" data-draft-id="${d.draftId}">${hasKey ? 'Open' : 'View'}</button>
                </div>
            `;
            })
            .join('');

        // Add click handlers
        container.querySelectorAll('.edit-invited-draft-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const draftId = (btn as HTMLElement).dataset.draftId!;
                openDraftEditor(draftId);
                // Switch to drafts tab to show the editor
                switchTab('drafts');
            });
        });
    } catch (error) {
        console.error('Failed to load invited drafts:', error);
        container.innerHTML = '<p class="empty-state">Failed to load invited drafts. Please try again.</p>';
    }
}

/**
 * Handle publishing a draft as a public paper
 */
async function handlePublishDraft(): Promise<void> {
    if (!currentDraftId) {
        showStatus('No draft selected', 'error');
        return;
    }

    const draft = getDraft(currentDraftId);
    if (!draft) {
        showStatus('Draft not found', 'error');
        return;
    }

    // Build the complete authors list for display in confirmation
    const allAuthors: string[] = [draft.owner];
    draft.collaborators.forEach(c => {
        if (!allAuthors.includes(c.wallet)) {
            allAuthors.push(c.wallet);
        }
    });
    const authorsDisplay = allAuthors.map(a => formatAddress(a)).join(', ');

    // Confirm publication
    const confirmed = confirm(
        `Are you sure you want to publish "${draft.title}" to the public archive?\n\n` +
        `Authors: ${authorsDisplay}\n\n` +
        `This will:\n` +
        `• Make the paper permanently public and visible to everyone\n` +
        `• Delete the draft from all collaborators' draft lists`
    );

    if (!confirmed) return;

    const titleInput = document.getElementById('draft-title') as HTMLInputElement;
    const contentInput = document.getElementById('draft-content') as HTMLTextAreaElement;
    
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title || !content) {
        showStatus('Please fill in title and content before publishing', 'error');
        return;
    }

    const progressDiv = document.getElementById('draft-progress') as HTMLElement;
    progressDiv.classList.remove('hidden');

    try {
        // Build authors list - owner first, then collaborators
        const authors: Author[] = [{ name: draft.owner, wallet: draft.owner }];
        draft.collaborators.forEach(c => {
            // Avoid duplicates
            if (c.wallet !== draft.owner) {
                authors.push({ name: c.name, wallet: c.wallet });
            }
        });

        // Publish using the uploadPaper function
        const actionId = await uploadPaper(
            title,
            '', // abstract - could be extracted from content or prompted
            authors,
            [], // keywords
            [], // citations
            content,
            `${title.replace(/[^a-zA-Z0-9]/g, '_')}.txt`,
            (progress) => {
                const fill = progressDiv.querySelector('.progress-fill') as HTMLElement;
                const text = progressDiv.querySelector('.progress-text') as HTMLElement;
                if (fill) fill.style.width = `${progress}%`;
                if (text) {
                    if (progress < 20) text.textContent = 'Preparing...';
                    else if (progress < 50) text.textContent = 'Signing...';
                    else if (progress < 90) text.textContent = 'Publishing...';
                    else text.textContent = 'Finalizing...';
                }
            }
        );

        // Delete the draft from localStorage after successful publication
        // This removes it from both owner and collaborators' draft lists
        const { deleteDraft } = await import('./drafts');
        deleteDraft(currentDraftId);
        console.log(`🗑️ Draft ${currentDraftId} deleted after publication`);

        showStatus(`Paper published! URI: ${formatPaperUri(actionId)}`, 'success');
        closeEditor();
        
        // Refresh all lists
        renderPapersList();
        renderDraftsList();
        renderInvitedDraftsList();
        
        // Switch to archive tab to show the published paper
        switchTab('archive');
    } catch (error) {
        console.error('Publish draft error:', error);
        showStatus(
            error instanceof Error ? error.message : 'Failed to publish draft',
            'error'
        );
    } finally {
        progressDiv.classList.add('hidden');
    }
}

// ============================================================
// PUBLISH TAB
// ============================================================

/**
 * Handle paper publication
 */
async function handleUpload(event: Event): Promise<void> {
    event.preventDefault();

    const title = (document.getElementById('paper-title') as HTMLInputElement).value.trim();
    const abstract = (document.getElementById('paper-abstract') as HTMLTextAreaElement).value.trim();
    const authorsRaw = (document.getElementById('paper-authors') as HTMLInputElement).value.trim();
    const keywordsRaw = (document.getElementById('paper-keywords') as HTMLInputElement).value.trim();
    const citationsRaw = (document.getElementById('paper-citations') as HTMLInputElement).value.trim();
    const content = (document.getElementById('paper-content') as HTMLTextAreaElement).value.trim();

    if (!title || !abstract || !authorsRaw || !content) {
        showStatus('Please fill in all required fields', 'error');
        return;
    }

    if (!isWalletConnected()) {
        showStatus('Please connect your wallet first', 'error');
        return;
    }

    const authors: Author[] = authorsRaw
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name)
        .map((name) => ({ name }));

    const keywords = keywordsRaw.split(',').map((k) => k.trim()).filter((k) => k);
    const citations = citationsRaw.split(',').map((c) => c.trim()).filter((c) => c && /^\d+$/.test(c));

    const uploadButton = document.getElementById('upload-button') as HTMLButtonElement;
    const uploadProgress = document.getElementById('upload-progress') as HTMLElement;

    uploadButton.disabled = true;
    uploadProgress.classList.remove('hidden');

    try {
        const actionId = await uploadPaper(
            title,
            abstract,
            authors,
            keywords,
            citations,
            content,
            `${title.replace(/[^a-zA-Z0-9]/g, '_')}.txt`,
            (progress) => {
                const fill = uploadProgress.querySelector('.progress-fill') as HTMLElement;
                const text = uploadProgress.querySelector('.progress-text') as HTMLElement;
                if (fill) fill.style.width = `${progress}%`;
                if (text) {
                    if (progress < 20) text.textContent = 'Signing...';
                    else if (progress < 50) text.textContent = 'Registering...';
                    else if (progress < 90) text.textContent = 'Uploading...';
                    else text.textContent = 'Finalizing...';
                }
            }
        );

        // Clear form
        (document.getElementById('paper-title') as HTMLInputElement).value = '';
        (document.getElementById('paper-abstract') as HTMLTextAreaElement).value = '';
        (document.getElementById('paper-authors') as HTMLInputElement).value = '';
        (document.getElementById('paper-keywords') as HTMLInputElement).value = '';
        (document.getElementById('paper-citations') as HTMLInputElement).value = '';
        (document.getElementById('paper-content') as HTMLTextAreaElement).value = '';

        renderPapersList();
        showStatus(`Paper published! URI: ${formatPaperUri(actionId)}`, 'success');
    } catch (error) {
        console.error('Upload error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to publish paper';
        console.error('Full upload error details:', {
            error,
            title,
            abstract: abstract.substring(0, 100),
            authorCount: authors.length,
        });
        showStatus(
            `Publish failed: ${errorMessage}`,
            'error'
        );
    } finally {
        uploadButton.disabled = false;
        uploadProgress.classList.add('hidden');
    }
}

// ============================================================
// ARCHIVE TAB
// ============================================================

/**
 * Render published papers list
 */
async function renderPapersList(): Promise<void> {
    const container = document.getElementById('papers-container') as HTMLElement;
    const address = getConnectedAddress();

    if (!address) {
        container.innerHTML = '<p class="empty-state">Connect wallet to view papers.</p>';
        return;
    }

    // Show loading state
    container.innerHTML = '<p class="empty-state">Loading papers from Lumescope...</p>';

    try {
        const papers = await fetchUserPapers(address);

        if (papers.length === 0) {
            container.innerHTML = '<p class="empty-state">No papers published yet.</p>';
            return;
        }

        container.innerHTML = papers
            .map((paper) => {
                const date = new Date(paper.submittedAt).toLocaleDateString();
                const uri = formatPaperUri(paper.actionId);
                return `
                <div class="paper-card">
                    <div class="paper-info">
                        <h3 class="paper-title">${escapeHtml(paper.title)}</h3>
                        <p class="paper-authors">${escapeHtml(paper.authors.join(', '))}</p>
                        <p class="paper-meta">
                            <span class="paper-uri">${uri}</span>
                            <span>${date}</span>
                        </p>
                    </div>
                    <button class="view-button" data-action-id="${paper.actionId}">View</button>
                </div>
            `;
            })
            .join('');

        container.querySelectorAll('.view-button').forEach((btn) => {
            btn.addEventListener('click', () => {
                const actionId = (btn as HTMLElement).dataset.actionId!;
                handleViewPaper(actionId);
            });
        });
    } catch (error) {
        console.error('Failed to load papers:', error);
        // Fallback is handled in fetchUserPapers, so this shouldn't error
        // But if it does, show empty state
        container.innerHTML = '<p class="empty-state">No papers published yet.</p>';
    }
}

/**
 * Render all publications from blockchain
 */
async function renderPublicationsList(): Promise<void> {
    const container = document.getElementById('publications-container') as HTMLElement;

    // Show loading state
    container.innerHTML = '<p class="empty-state">Loading all publications from Lumescope...</p>';

    try {
        const papers = await fetchAllPublications();

        if (papers.length === 0) {
            container.innerHTML = '<p class="empty-state">No publications found on the blockchain yet.</p>';
            return;
        }

        container.innerHTML = papers
            .map((paper) => {
                const date = new Date(paper.submittedAt).toLocaleDateString();
                const uri = formatPaperUri(paper.actionId);
                return `
                <div class="paper-card">
                    <div class="paper-info">
                        <h3 class="paper-title">${escapeHtml(paper.title)}</h3>
                        <p class="paper-authors">${escapeHtml(paper.authors.join(', '))}</p>
                        <p class="paper-meta">
                            <span class="paper-uri">${uri}</span>
                            <span>${date}</span>
                        </p>
                    </div>
                    <button class="view-button" data-action-id="${paper.actionId}">View</button>
                </div>
            `;
            })
            .join('');

        container.querySelectorAll('.view-button').forEach((btn) => {
            btn.addEventListener('click', () => {
                const actionId = (btn as HTMLElement).dataset.actionId!;
                handleViewPublication(actionId);
            });
        });
    } catch (error) {
        console.error('Failed to load publications:', error);
        container.innerHTML = '<p class="empty-state">Failed to load publications. Please try again.</p>';
    }
}

/**
 * View a publication (in Publications tab)
 */
async function handleViewPublication(actionId: string): Promise<void> {
    if (!isWalletConnected()) {
        showStatus('Connect wallet to view papers', 'error');
        return;
    }

    try {
        const { paper, content } = await downloadPaper(actionId);

        const viewerContainer = document.getElementById('publications-viewer-container') as HTMLElement;
        (document.getElementById('pub-view-title') as HTMLElement).textContent = paper.title;
        (document.getElementById('pub-view-authors') as HTMLElement).textContent = paper.authors.map((a) => a.name).join(', ');
        (document.getElementById('pub-view-meta') as HTMLElement).innerHTML = `
            <strong>URI:</strong> ${formatPaperUri(paper.actionId)} |
            <strong>Submitted:</strong> ${new Date(paper.submittedAt).toLocaleDateString()}
        `;
        (document.getElementById('pub-view-abstract') as HTMLElement).textContent = paper.abstract;

        // Keywords
        const keywordsContainer = document.getElementById('pub-view-keywords') as HTMLElement;
        if (paper.keywords && paper.keywords.length > 0) {
            keywordsContainer.innerHTML = paper.keywords.map((kw) => `<span class="keyword">${escapeHtml(kw)}</span>`).join('');
            (document.getElementById('pub-view-keywords-container') as HTMLElement).style.display = 'block';
        } else {
            (document.getElementById('pub-view-keywords-container') as HTMLElement).style.display = 'none';
        }

        // Citations
        const citationsList = document.getElementById('pub-view-citations') as HTMLElement;
        if (paper.citations && paper.citations.length > 0) {
            citationsList.innerHTML = paper.citations
                .map((uri) => `<li><a href="#" class="citation-link" data-uri="${escapeHtml(uri)}">${escapeHtml(uri)}</a></li>`)
                .join('');
            (document.getElementById('pub-view-citations-container') as HTMLElement).style.display = 'block';

            // Handle citation clicks
            citationsList.querySelectorAll('.citation-link').forEach((link) => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const uri = (link as HTMLElement).dataset.uri!;
                    const citedActionId = uri.replace('lumera://', '');
                    handleViewPublication(citedActionId);
                });
            });
        } else {
            (document.getElementById('pub-view-citations-container') as HTMLElement).style.display = 'none';
        }

        // Content
        (document.getElementById('pub-view-content') as HTMLElement).textContent = content;

        // Show viewer
        viewerContainer.classList.remove('hidden');
        viewerContainer.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        console.error('Failed to load paper:', error);
        showStatus('Failed to load paper details', 'error');
    }
}

/**
 * View a published paper
 */
async function handleViewPaper(actionId: string): Promise<void> {
    if (!isWalletConnected()) {
        showStatus('Connect wallet to view papers', 'error');
        return;
    }

    try {
        const { paper, content } = await downloadPaper(actionId);

        const viewerContainer = document.getElementById('paper-viewer-container') as HTMLElement;
        (document.getElementById('view-title') as HTMLElement).textContent = paper.title;
        (document.getElementById('view-authors') as HTMLElement).textContent = paper.authors.map((a) => a.name).join(', ');
        (document.getElementById('view-meta') as HTMLElement).innerHTML = `
            <strong>URI:</strong> ${formatPaperUri(paper.actionId)} |
            <strong>Submitted:</strong> ${new Date(paper.submittedAt).toLocaleDateString()}
        `;
        (document.getElementById('view-abstract') as HTMLElement).textContent = paper.abstract;

        // Keywords
        const keywordsContainer = document.getElementById('view-keywords-container') as HTMLElement;
        if (paper.keywords.length > 0) {
            (document.getElementById('view-keywords') as HTMLElement).innerHTML = paper.keywords
                .map((k) => `<span class="keyword-tag">${escapeHtml(k)}</span>`)
                .join(' ');
            keywordsContainer.classList.remove('hidden');
        } else {
            keywordsContainer.classList.add('hidden');
        }

        // Citations
        const citationsContainer = document.getElementById('view-citations-container') as HTMLElement;
        if (paper.citations.length > 0) {
            (document.getElementById('view-citations') as HTMLElement).innerHTML = paper.citations
                .map((c) => `<li><a href="#" class="citation-link" data-cite="${c}">${formatPaperUri(c)}</a></li>`)
                .join('');
            citationsContainer.classList.remove('hidden');
        } else {
            citationsContainer.classList.add('hidden');
        }

        (document.getElementById('view-content') as HTMLElement).textContent = content;
        viewerContainer.classList.remove('hidden');
        viewerContainer.scrollIntoView({ behavior: 'smooth' });

        showStatus('Paper loaded!', 'success');
    } catch (error) {
        console.error('Download error:', error);
        showStatus(
            error instanceof Error ? error.message : 'Failed to load paper',
            'error'
        );
    }
}

// ============================================================
// COMMON
// ============================================================

/**
 * Update UI based on wallet state
 */
function updateUI(): void {
    const connected = isWalletConnected();
    const address = getConnectedAddress();

    if (connected && address) {
        walletButton.textContent = 'Disconnect';
        walletButton.classList.add('connected');
        walletStatus.textContent = formatAddress(address);
        walletStatus.classList.remove('hidden');
        tabNav.classList.remove('disabled');

        // Enable new draft button
        const newDraftBtn = document.getElementById('new-draft-button') as HTMLButtonElement;
        if (newDraftBtn) newDraftBtn.disabled = false;
    } else {
        walletButton.textContent = 'Connect Wallet';
        walletButton.classList.remove('connected');
        walletButton.disabled = false;
        walletStatus.classList.add('hidden');
        tabNav.classList.add('disabled');

        // Disable new draft button
        const newDraftBtn = document.getElementById('new-draft-button') as HTMLButtonElement;
        if (newDraftBtn) newDraftBtn.disabled = true;
    }

    renderDraftsList();
    renderPapersList();
}

/**
 * Show status message
 */
function showStatus(message: string, type: 'success' | 'error' | 'info'): void {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.classList.remove('hidden');

    setTimeout(() => {
        statusMessage.classList.add('hidden');
    }, 5000);
}

/**
 * Escape HTML
 */
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
