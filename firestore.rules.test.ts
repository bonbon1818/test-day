/**
 * Firestore Security Rules Test Specification (Dirty Dozen Adversarial Suite)
 * Matches security_spec.md invariants and DRAFT_firestore.rules / firestore.rules.
 */
export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; emailVerified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated create on entries',
    operation: 'create',
    path: '/users/user1/entries/entry1',
    auth: null,
    payload: { ownerId: 'user1', title: 't', category: '일상', content: 'c', status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified email user write',
    operation: 'create',
    path: '/users/user1/entries/entry1',
    auth: { uid: 'user1', emailVerified: false },
    payload: { ownerId: 'user1', title: 't', category: '일상', content: 'c', status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-user list on another user entries',
    operation: 'list',
    path: '/users/user1/entries',
    auth: { uid: 'user2', emailVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-user PII read on private info',
    operation: 'get',
    path: '/users/user1/private/info',
    auth: { uid: 'user2', emailVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Identity spoofing with mismatched ownerId',
    operation: 'create',
    path: '/users/user1/entries/entry1',
    auth: { uid: 'user1', emailVerified: true },
    payload: { ownerId: 'user2', title: 't', category: '일상', content: 'c', status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Shadow ghost field injection',
    operation: 'create',
    path: '/users/user1/entries/entry1',
    auth: { uid: 'user1', emailVerified: true },
    payload: { ownerId: 'user1', title: 't', category: '일상', content: 'c', status: 'active', isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Invalid document ID characters (ID poisoning)',
    operation: 'create',
    path: '/users/user1/entries/bad$id',
    auth: { uid: 'user1', emailVerified: true },
    payload: { ownerId: 'user1', title: 't', category: '일상', content: 'c', status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Oversized content field (> 5000 chars)',
    operation: 'create',
    path: '/users/user1/entries/entry1',
    auth: { uid: 'user1', emailVerified: true },
    payload: { ownerId: 'user1', title: 't', category: '일상', content: 'a'.repeat(5001), status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Disallowed category enum value',
    operation: 'create',
    path: '/users/user1/entries/entry1',
    auth: { uid: 'user1', emailVerified: true },
    payload: { ownerId: 'user1', title: 't', category: '기타', content: 'c', status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Client timestamp forgery (not request.time)',
    operation: 'create',
    path: '/users/user1/entries/entry1',
    auth: { uid: 'user1', emailVerified: true },
    payload: { ownerId: 'user1', title: 't', category: '일상', content: 'c', status: 'active', createdAt: 1700000000000 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Direct permanent delete of active entry',
    operation: 'delete',
    path: '/users/user1/entries/activeEntry',
    auth: { uid: 'user1', emailVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Immutable recordedAt tampering on update',
    operation: 'update',
    path: '/users/user1/entries/entry1',
    auth: { uid: 'user1', emailVerified: true },
    payload: { recordedAt: 1234567890 },
    expected: 'PERMISSION_DENIED',
  },
];
