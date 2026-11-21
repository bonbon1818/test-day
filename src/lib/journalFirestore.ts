import { User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../firebase';
import {
  CATEGORIES,
  Category,
  JournalEntry,
  STORAGE_KEY_ENTRIES,
  STORAGE_KEY_TRASH,
  TrashedEntry,
  createPracticeEntries,
  purgeExpiredTrash,
} from '../types';

export const MAX_TITLE_LENGTH = 200;
export const MAX_CONTENT_LENGTH = 5000;
export const MAX_DISPLAY_NAME_LENGTH = 120;
export const MAX_EMAIL_LENGTH = 254;
const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

function sanitizeTitle(value: string): string {
  const trimmed = value.trim() || '제목 없는 기록';
  return trimmed.slice(0, MAX_TITLE_LENGTH);
}

function sanitizeContent(value: string): string {
  const trimmed = value.trim() || '(내용 없음)';
  return trimmed.slice(0, MAX_CONTENT_LENGTH);
}

function sanitizeCategory(value: unknown): Category {
  return typeof value === 'string' && CATEGORIES.includes(value as Category)
    ? (value as Category)
    : '일상';
}

function sanitizeDisplayName(user: User): string {
  const raw =
    user.displayName?.trim() ||
    user.email?.split('@')[0]?.trim() ||
    '사용자';
  return raw.slice(0, MAX_DISPLAY_NAME_LENGTH);
}

function sanitizeEmail(user: User): string {
  const raw =
    user.email?.trim() ||
    user.providerData?.[0]?.email?.trim() ||
    'unknown@example.com';
  return raw.slice(0, MAX_EMAIL_LENGTH);
}

export function sanitizeEntryId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 128);
  if (cleaned.length > 0 && VALID_ID_REGEX.test(cleaned)) {
    return cleaned;
  }
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeSafeEntryId(): string {
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function ensureUserProfileAndSyncLogin(
  user: User
): Promise<{ seededPractice: boolean }> {
  const userPath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/info`;
  const userRef = doc(db, 'users', user.uid);
  const privateRef = doc(db, 'users', user.uid, 'private', 'info');

  const displayName = sanitizeDisplayName(user);
  const email = sanitizeEmail(user);

  let seededPractice = false;

  let userSnap;
  try {
    userSnap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (!userSnap.exists()) {
    try {
      await setDoc(userRef, {
        uid: user.uid,
        displayName,
        seededPractice: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, userPath);
    }
  } else {
    const data = userSnap.data() as {
      displayName?: string;
      seededPractice?: boolean;
    };
    seededPractice = data.seededPractice === true;
    if (data.displayName !== displayName) {
      try {
        await updateDoc(userRef, {
          displayName,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, userPath);
      }
    }
  }

  let privateSnap;
  try {
    privateSnap = await getDoc(privateRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, privatePath);
  }

  if (!privateSnap.exists()) {
    try {
      await setDoc(privateRef, {
        uid: user.uid,
        email,
        lastLoginAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, privatePath);
    }
  } else {
    const privateData = privateSnap.data() as {
      email?: string;
      lastLoginAt?: unknown;
    };
    const lastLoginMs =
      privateData.lastLoginAt instanceof Timestamp
        ? privateData.lastLoginAt.toMillis()
        : 0;
    const needsSync =
      privateData.email !== email || Date.now() - lastLoginMs > 10 * 60 * 1000;

    if (needsSync) {
      try {
        await updateDoc(privateRef, {
          email,
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, privatePath);
      }
    }
  }

  return { seededPractice };
}

function readLegacyLocalEntries(): {
  active: JournalEntry[];
  trashed: TrashedEntry[];
} {
  let active: JournalEntry[] = [];
  let trashed: TrashedEntry[] = [];

  try {
    const rawEntries = localStorage.getItem(STORAGE_KEY_ENTRIES);
    if (rawEntries) {
      const parsed = JSON.parse(rawEntries);
      if (Array.isArray(parsed)) {
        active = parsed
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            id: sanitizeEntryId(String(item.id ?? makeSafeEntryId())),
            title: sanitizeTitle(String(item.title ?? '')),
            category: sanitizeCategory(item.category),
            content: sanitizeContent(String(item.content ?? '')),
            createdAt:
              typeof item.createdAt === 'number' &&
              Number.isFinite(item.createdAt) &&
              item.createdAt > 0
                ? item.createdAt
                : Date.now(),
          }));
      }
    }
  } catch {
    active = [];
  }

  try {
    const rawTrash = localStorage.getItem(STORAGE_KEY_TRASH);
    if (rawTrash) {
      const parsed = JSON.parse(rawTrash);
      if (Array.isArray(parsed)) {
        const mapped: TrashedEntry[] = parsed
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            id: sanitizeEntryId(String(item.id ?? makeSafeEntryId())),
            title: sanitizeTitle(String(item.title ?? '')),
            category: sanitizeCategory(item.category),
            content: sanitizeContent(String(item.content ?? '')),
            createdAt:
              typeof item.createdAt === 'number' &&
              Number.isFinite(item.createdAt) &&
              item.createdAt > 0
                ? item.createdAt
                : Date.now(),
            deletedAt:
              typeof item.deletedAt === 'number' &&
              Number.isFinite(item.deletedAt) &&
              item.deletedAt > 0
                ? item.deletedAt
                : Date.now(),
          }));
        trashed = purgeExpiredTrash(mapped);
      }
    }
  } catch {
    trashed = [];
  }

  return { active, trashed };
}

export async function seedInitialEntriesIfNeeded(uid: string): Promise<void> {
  const entriesPath = `users/${uid}/entries`;
  const userPath = `users/${uid}`;
  const entriesCol = collection(db, 'users', uid, 'entries');

  let existingSnap;
  try {
    existingSnap = await getDocs(
      query(entriesCol, where('ownerId', '==', uid))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, entriesPath);
  }

  if (existingSnap.empty) {
    const legacy = readLegacyLocalEntries();
    const activeToSeed =
      legacy.active.length > 0 ? legacy.active : createPracticeEntries();

    const batch = writeBatch(db);
    const seenIds = new Set<string>();

    for (const item of activeToSeed) {
      let id = sanitizeEntryId(item.id);
      if (seenIds.has(id)) {
        id = makeSafeEntryId();
      }
      seenIds.add(id);

      const ref = doc(db, 'users', uid, 'entries', id);
      batch.set(ref, {
        ownerId: uid,
        title: sanitizeTitle(item.title),
        category: sanitizeCategory(item.category),
        content: sanitizeContent(item.content),
        status: 'active',
        recordedAt: item.createdAt > 0 ? item.createdAt : Date.now(),
        trashedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const trashedIdsToMove: string[] = [];
    for (const item of legacy.trashed) {
      let id = sanitizeEntryId(item.id);
      if (seenIds.has(id)) {
        id = makeSafeEntryId();
      }
      seenIds.add(id);
      trashedIdsToMove.push(id);

      const ref = doc(db, 'users', uid, 'entries', id);
      batch.set(ref, {
        ownerId: uid,
        title: sanitizeTitle(item.title),
        category: sanitizeCategory(item.category),
        content: sanitizeContent(item.content),
        status: 'active',
        recordedAt: item.createdAt > 0 ? item.createdAt : Date.now(),
        trashedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, entriesPath);
    }

    if (trashedIdsToMove.length > 0) {
      await bulkMoveEntriesToTrash(uid, trashedIdsToMove);
    }
  }

  try {
    await updateDoc(doc(db, 'users', uid), {
      seededPractice: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
}

export function subscribeUserEntries(
  uid: string,
  onData: (payload: {
    entries: JournalEntry[];
    trashedEntries: TrashedEntry[];
  }) => void,
  onError: (error: unknown) => void
): () => void {
  const entriesPath = `users/${uid}/entries`;
  const q = query(
    collection(db, 'users', uid, 'entries'),
    where('ownerId', '==', uid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const active: JournalEntry[] = [];
      const trashed: TrashedEntry[] = [];

      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as {
          title?: unknown;
          category?: unknown;
          content?: unknown;
          status?: unknown;
          recordedAt?: unknown;
          trashedAt?: unknown;
        };

        const recordedAt =
          typeof data.recordedAt === 'number' &&
          Number.isFinite(data.recordedAt) &&
          data.recordedAt > 0
            ? data.recordedAt
            : Date.now();

        const base: JournalEntry = {
          id: docSnap.id,
          title: typeof data.title === 'string' ? data.title : '제목 없는 기록',
          category: sanitizeCategory(data.category),
          content: typeof data.content === 'string' ? data.content : '',
          createdAt: recordedAt,
        };

        if (data.status === 'trashed') {
          const trashedAtMs =
            data.trashedAt instanceof Timestamp
              ? data.trashedAt.toMillis()
              : Date.now();
          trashed.push({
            ...base,
            deletedAt: trashedAtMs,
          });
        } else {
          active.push(base);
        }
      });

      active.sort((a, b) => b.createdAt - a.createdAt);
      trashed.sort((a, b) => b.deletedAt - a.deletedAt);

      onData({ entries: active, trashedEntries: trashed });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, entriesPath);
      } catch (wrappedError) {
        onError(wrappedError);
      }
    }
  );
}

export async function createJournalEntry(
  uid: string,
  input: {
    title: string;
    category: Category;
    content: string;
    recordedAt?: number;
  }
): Promise<string> {
  const entryId = makeSafeEntryId();
  const path = `users/${uid}/entries/${entryId}`;
  const recordedAt =
    typeof input.recordedAt === 'number' && input.recordedAt > 0
      ? input.recordedAt
      : Date.now();

  try {
    await setDoc(doc(db, 'users', uid, 'entries', entryId), {
      ownerId: uid,
      title: sanitizeTitle(input.title),
      category: sanitizeCategory(input.category),
      content: sanitizeContent(input.content),
      status: 'active',
      recordedAt,
      trashedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return entryId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateJournalEntry(
  uid: string,
  entryId: string,
  updates: { title: string; category: Category; content: string }
): Promise<void> {
  const path = `users/${uid}/entries/${entryId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'entries', entryId), {
      title: sanitizeTitle(updates.title),
      category: sanitizeCategory(updates.category),
      content: sanitizeContent(updates.content),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function moveEntryToTrash(
  uid: string,
  entryId: string
): Promise<void> {
  const path = `users/${uid}/entries/${entryId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'entries', entryId), {
      status: 'trashed',
      trashedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function bulkMoveEntriesToTrash(
  uid: string,
  entryIds: string[]
): Promise<void> {
  if (entryIds.length === 0) return;
  const path = `users/${uid}/entries`;
  try {
    const batch = writeBatch(db);
    for (const id of entryIds) {
      batch.update(doc(db, 'users', uid, 'entries', id), {
        status: 'trashed',
        trashedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function restoreEntryFromTrash(
  uid: string,
  entryId: string
): Promise<void> {
  const path = `users/${uid}/entries/${entryId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'entries', entryId), {
      status: 'active',
      trashedAt: null,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function bulkRestoreEntriesFromTrash(
  uid: string,
  entryIds: string[]
): Promise<void> {
  if (entryIds.length === 0) return;
  const path = `users/${uid}/entries`;
  try {
    const batch = writeBatch(db);
    for (const id of entryIds) {
      batch.update(doc(db, 'users', uid, 'entries', id), {
        status: 'active',
        trashedAt: null,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function permanentlyDeleteEntry(
  uid: string,
  entryId: string
): Promise<void> {
  const path = `users/${uid}/entries/${entryId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'entries', entryId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function bulkPermanentlyDeleteEntries(
  uid: string,
  entryIds: string[]
): Promise<void> {
  if (entryIds.length === 0) return;
  const path = `users/${uid}/entries`;
  try {
    const batch = writeBatch(db);
    for (const id of entryIds) {
      batch.delete(doc(db, 'users', uid, 'entries', id));
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
