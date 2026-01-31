/**
 * Lumera Research Archive
 * 
 * A decentralized research paper archive built on Lumera's Cascade permanent storage.
 * Store, cite, and retrieve research papers with cryptographic author verification.
 */

import './css/style.css';
import { initUI } from './ui';
import { parseShareLink } from './drafts';

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('📚 Lumera Research Archive initializing...');
  initUI();
  console.log('✅ Application ready');

  // Check for secure share link parameters
  const { draftId, documentKey } = parseShareLink();

  if (draftId && documentKey) {
    console.log(`🔐 Detected secure share link for draft: ${draftId}`);
    // Store link info for processing after wallet connection
    sessionStorage.setItem('pendingShareLink', JSON.stringify({ draftId, documentKey }));
    
    // Clear URL after a short delay (keep hash out of history)
    setTimeout(() => {
      window.history.replaceState({}, document.title, window.location.pathname);
    }, 500);
  }
});
