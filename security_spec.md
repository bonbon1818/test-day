# Firestore Security Specification

## 1. Data Invariants
1. **Owner-Only Isolation**: Every user profile (`/users/{userId}`), private info document (`/users/{userId}/private/info`), and journal record (`/users/{userId}/entries/{entryId}`) belongs exclusively to the authenticated, email-verified user (`request.auth.uid == userId` and `request.auth.token.email_verified == true`).
2. **PII Isolation**: Email addresses and login timestamps are isolated in `/users/{userId}/private/info` and are strictly unreadable and unwritable by any other user.
3. **Orphan Prevention**: Journal records and private info documents cannot be created unless the parent `/users/{userId}` document exists (checked via `existsAfter` / `getAfter` on create and `exists` on update).
4. **Immutable Ownership & Temporal Integrity**: `ownerId` / `uid`, `recordedAt`, and `createdAt` are immutable after creation; `createdAt`, `updatedAt`, `lastLoginAt`, and `trashedAt` (when moving to trash) must strictly equal `request.time`.
5. **Lifecycle State Integrity**: New entries must start with `status: 'active'` and `trashedAt: null`. Only active entries can be edited (`title`, `category`, `content`, `updatedAt`) or moved to trash (`status: 'trashed'`, `trashedAt == request.time`). Only trashed entries can be restored (`status: 'active'`, `trashedAt: null`) or permanently deleted.
6. **Strict Schema & Size Bounds**: Unknown shadow fields are rejected on both create (`keys().hasAll(...) && keys().hasOnly(...)`) and update (`affectedKeys().hasOnly(...)`), IDs must match `^[a-zA-Z0-9_\-]+$` (`1..128`), `title` (`1..200`), `content` (`1..5000`), and `category` is restricted to `['일상', '배움', '아이디어']`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Create**: Attempt creating `/users/u1/entries/e1` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: Attempt creating `/users/u1/entries/e1` with `request.auth.uid == 'u1'` and `email_verified: false` -> `PERMISSION_DENIED`.
3. **Cross-User Read/List**: User `u2` attempts `get` or `list` on `/users/u1/entries` -> `PERMISSION_DENIED`.
4. **Cross-User PII Read**: User `u2` attempts `get` on `/users/u1/private/info` -> `PERMISSION_DENIED`.
5. **Identity Spoofing on Create**: User `u1` creates `/users/u1/entries/e1` with `ownerId: 'u2'` -> `PERMISSION_DENIED`.
6. **Shadow Ghost Field Injection**: User `u1` creates or updates `/users/u1/entries/e1` including `{ isAdmin: true }` -> `PERMISSION_DENIED`.
7. **ID Poisoning**: User `u1` targets `/users/u1/entries/bad..id$123` -> `PERMISSION_DENIED`.
8. **Size / Denial-of-Wallet Payload**: User `u1` writes `content` of length `5001` or `title` of length `201` -> `PERMISSION_DENIED`.
9. **Invalid Category Enum**: User `u1` writes `category: '비밀'` -> `PERMISSION_DENIED`.
10. **Client Timestamp Forgery**: User `u1` sets `createdAt` or `updatedAt` to a past timestamp instead of `request.time` -> `PERMISSION_DENIED`.
11. **Lifecycle Shortcut / Direct Active Delete**: User `u1` attempts `delete` on an entry with `status: 'active'`, or creates an entry directly with `status: 'trashed'` -> `PERMISSION_DENIED`.
12. **Immutable Field Tampering**: User `u1` attempts updating `recordedAt`, `createdAt`, or `ownerId`, or reverting `seededPractice` from `true` to `false` -> `PERMISSION_DENIED`.
