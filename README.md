# Lumera Research Archive

Decentralized research platform built on **Lumera Cascade**, a permanent, censorship-resistant storage for academic papers with end-to-end encrypted collaboration.

Lumera Research Archive is a full-lifecycle academic publishing platform where researchers can write private drafts with end-to-end encryption, invite collaborators via wallet addresses with secure key sharing, and when ready, publish their work permanently to the public archive. The platform supports a complete paper workflow: create and iterate on encrypted drafts (only you and invited collaborators can decrypt), track version history across saves, publish finalized papers to Cascade's immutable storage, browse and discover all publications in the network, and build citation graphs by referencing other papers via their unique Action IDs. Every action—draft creation, collaboration invites, and publications—is cryptographically signed by the author's Keplr wallet, providing verifiable authorship and timestamping without relying on centralized infrastructure.

## Why Lumera Network?

**The Problem with Traditional Academic Publishing**

Scientific knowledge is gatekept by a handful of for-profit corporations. The "Big Five"—Elsevier, Springer Nature, Wiley, Taylor & Francis, and SAGE—control the majority of mainstream academic journals, charging universities and individuals exorbitant subscription fees and locking publicly-funded research behind paywalls. Researchers do the work, peer reviewers volunteer their time, yet publishers extract billions while authors receive nothing. Worse, these centralized platforms can restrict access, censor content, or simply shut down—taking decades of human knowledge with them.

**How Lumera Solves This**

| Problem | Lumera Solution |
|---------|-----------------|
| **Paywalls & Access Control** | Papers stored on Cascade are permanently public and free. No subscriptions, no gatekeepers. |
| **Platform Risk** | Lumera is decentralized and open-source. No single entity can shut it down or censor content. |
| **Authors Get Nothing** | Blockchain-native authorship enables direct royalty flows. Smart contracts can distribute payments to verified authors automatically. |
| **No Funding Mechanism** | Anyone can fund research directly. Contributors receive on-chain proof (NFT-like tokens) of their support. |
| **Attribution is Broken** | When research contributes to real-world outcomes (medicine, technology), original authors can be identified and rewarded via their on-chain identity. |

Lumera shifts power from publishers back to researchers and the public—permanent access, verifiable authorship, and programmable incentives for the people who actually create knowledge.

## Features

### 📝 Private Drafts
- **E2E Encrypted**: Content encrypted with XChaCha20-Poly1305 (libsodium)
- **Key Derivation**: Document keys encrypted with wallet-derived keys (signed message → BLAKE2b hash)
- **Version Control**: Each save creates a new version, full history preserved

### 👥 Collaboration
- **Invite via Wallet Address**: Generate secure share links with document key in URL fragment (never sent to servers)
- **Key Sharing**: Document key re-encrypted for each collaborator's derived key
- **Draft Discovery**: Invitation files enable collaborators to find shared drafts

### 🚀 Publishing
- **Draft → Public**: Convert encrypted draft to public paper
- **Direct Publish**: Submit papers without draft stage
- **Immutable**: Published papers permanently stored with Action ID as identifier

### 🔗 Citations
- Reference papers via `lumera://` URIs using Action IDs
- Citations stored in paper metadata, linked in viewer

### ✍️ Verification
- All uploads signed by Keplr wallet
- Author attribution via `submittedBy` field (wallet address)

## How Lumera Cascade Is Used

All data is stored on **Lumera Cascade**, Lumera Protocol's permanent file storage network.

### Storage

| Data Type | What's Stored |
|-----------|---------------|
| **Encrypted Drafts** | JSON manifests with XChaCha20-Poly1305 encrypted content |
| **Published Papers** | Public JSON manifests with metadata + base64-encoded content |
| **Collaboration Invitations** | Per-collaborator files (`invitation_{wallet}_{draftId}.json`) |
| **Version History** | Each save = new Cascade upload, tracked by Action ID |

### API Usage
```typescript
// Upload
lumeraClient.Cascade.uploader.uploadFile(bytes, { fileName, isPublic, expirationTime })

// Download (streaming)
lumeraClient.Cascade.downloader.download(actionId)
```

### Indexing with Lumescope
**Lumescope** (local indexer) queries Cascade actions:
- `getActionsByCreator(address)` — fetch user's papers/drafts
- `getAllActions()` — discover all publications
- Filter by `ACTION_TYPE_CASCADE` and `ACTION_STATE_DONE`

## Quick Start

```bash
npm install
npm run dev
```

**Requirements**: [Keplr wallet](https://www.keplr.app/) + testnet LUME tokens + Lumescope running locally

## Architecture

```
src/
├── cascade.ts    # Lumera SDK upload/download, paper CRUD
├── drafts.ts     # Draft lifecycle, encryption, collaboration invites
├── crypto.ts     # libsodium XChaCha20-Poly1305, key derivation
├── lumescope.ts  # Indexer API client for action queries
├── paper.ts      # Data models (Draft, Paper, Collaborator, Manifests)
├── wallet.ts     # Keplr connection, message signing
├── ui.ts         # DOM event handlers
└── config.ts     # Chain config (lumera-testnet-2)
```

## Data Models

**EncryptedDraftManifest** (on Cascade):
```typescript
{ version, type: 'encrypted_draft', metadata: {...}, encrypted: { ciphertext, nonce, algorithm } }
```

**PaperManifest** (on Cascade):
```typescript
{ version, type: 'research_paper', metadata: {...}, content: base64 }
```

**CollaborationInvitation** (on Cascade):
```typescript
{ type: 'draft_invitation', draftId, invitedWallet, keyShare: { encryptedKey, nonce }, latestActionId }
```

## Config

| Setting | Value |
|---------|-------|
| Chain | `lumera-testnet-2` |
| RPC | `https://rpc.testnet.lumera.io` |
| Lumescope | `http://localhost:18080` |

## License

MIT
