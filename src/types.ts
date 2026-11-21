export type Category = '일상' | '배움' | '아이디어';
export type AppView = 'journal' | 'trash' | 'admin';

export interface JournalEntry {
  id: string;
  title: string;
  category: Category;
  content: string;
  createdAt: number;
}

export interface TrashedEntry extends JournalEntry {
  deletedAt: number;
}

export const CATEGORIES: Category[] = ['일상', '배움', '아이디어'];
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const STORAGE_KEY_ENTRIES = 'daily_journal_entries_v1';
export const STORAGE_KEY_TRASH = 'daily_journal_trash_v1';

const LEGACY_SEED_TIMESTAMP_OFFSETS: Record<number, number> = {
  1700000003000: 0,
  1700000002000: 1,
  1700000001000: 2,
};

export function getDaysAgoTimestamp(
  daysAgo: number,
  baseTimestamp = Date.now()
): number {
  const base = new Date(baseTimestamp);
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() - daysAgo,
    12,
    0,
    0,
    0
  ).getTime();
}

export function createPracticeEntries(baseTimestamp = Date.now()): JournalEntry[] {
  return [
    {
      id: 'practice-1',
      title: '창가에서 마신 커피',
      category: '일상',
      content: '잠깐 쉬며 오늘의 기분을 돌아봤다.',
      createdAt: getDaysAgoTimestamp(0, baseTimestamp),
    },
    {
      id: 'practice-2',
      title: '도서관에서 발견한 한 문장',
      category: '배움',
      content: '읽은 책에서 기억하고 싶은 생각을 적어 둔다.',
      createdAt: getDaysAgoTimestamp(1, baseTimestamp),
    },
    {
      id: 'practice-3',
      title: '다음 수업 아이디어',
      category: '아이디어',
      content: '나만의 독서 기록장으로 바꿔 보고 싶다.',
      createdAt: getDaysAgoTimestamp(2, baseTimestamp),
    },
  ];
}

export const PRACTICE_ENTRIES: JournalEntry[] = createPracticeEntries();

export function purgeExpiredTrash(
  items: TrashedEntry[],
  now = Date.now()
): TrashedEntry[] {
  return items.filter((item) => now - item.deletedAt < SEVEN_DAYS_MS);
}

function normalizeCreatedAt(rawCreatedAt: unknown): number {
  if (typeof rawCreatedAt !== 'number' || !Number.isFinite(rawCreatedAt)) {
    return Date.now();
  }
  if (rawCreatedAt in LEGACY_SEED_TIMESTAMP_OFFSETS) {
    return getDaysAgoTimestamp(LEGACY_SEED_TIMESTAMP_OFFSETS[rawCreatedAt]);
  }
  return rawCreatedAt;
}

export function loadInitialEntries(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ENTRIES);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => ({
          id: String(item.id),
          title: String(item.title ?? ''),
          category: CATEGORIES.includes(item.category) ? item.category : '일상',
          content: String(item.content ?? ''),
          createdAt: normalizeCreatedAt(item.createdAt),
        }));
      }
    }
  } catch {
    // 저장된 데이터를 읽을 수 없으면 기본 연습 기록을 사용합니다.
  }
  return createPracticeEntries();
}

export function loadInitialTrash(): TrashedEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TRASH);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const normalized: TrashedEntry[] = parsed.map((item) => ({
          id: String(item.id),
          title: String(item.title ?? ''),
          category: CATEGORIES.includes(item.category) ? item.category : '일상',
          content: String(item.content ?? ''),
          createdAt: normalizeCreatedAt(item.createdAt),
          deletedAt:
            typeof item.deletedAt === 'number' && Number.isFinite(item.deletedAt)
              ? item.deletedAt
              : Date.now(),
        }));
        return purgeExpiredTrash(normalized);
      }
    }
  } catch {
    // 저장된 휴지통 데이터를 읽을 수 없으면 빈 목록으로 시작합니다.
  }
  return [];
}

export function getCalendarDayDiff(
  targetTimestamp: number,
  baseTimestamp = Date.now()
): number {
  const target = new Date(targetTimestamp);
  const base = new Date(baseTimestamp);
  const targetMidnight = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  ).getTime();
  const baseMidnight = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate()
  ).getTime();
  return Math.round((baseMidnight - targetMidnight) / (24 * 60 * 60 * 1000));
}

export function isSameDay(timestampA: number, timestampB: number): boolean {
  return getCalendarDayDiff(timestampA, timestampB) === 0;
}

export function formatShortDate(timestamp: number): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(timestamp));
}

export function formatRelativeCalendarDate(
  timestamp: number,
  baseTimestamp = Date.now()
): string {
  const diff = getCalendarDayDiff(timestamp, baseTimestamp);
  const fullDate = formatShortDate(timestamp);

  if (diff === 0) return `${fullDate} (오늘)`;
  if (diff === 1) return `${fullDate} (어제)`;
  if (diff === 2) return `${fullDate} (그저께)`;
  if (diff >= 3 && diff <= 6) return `${fullDate} (${diff}일 전)`;
  return fullDate;
}

export function formatRemainingRetention(deletedAt: number, now: number): string {
  const remainingMs = Math.max(0, deletedAt + SEVEN_DAYS_MS - now);
  const totalMinutes = Math.ceil(remainingMs / (60 * 1000));
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days >= 1) {
    return hours > 0 ? `${days}일 ${hours}시간 남음` : `${days}일 남음`;
  }
  if (totalHours >= 1) {
    return `${totalHours}시간 남음`;
  }
  return `${Math.max(1, totalMinutes)}분 남음`;
}

export function matchesTitleAndContentWords(
  entry: { title: string; content: string },
  rawQuery: string
): boolean {
  const words = rawQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  const searchable = `${entry.title} ${entry.content}`.toLowerCase();
  return words.every((word) => searchable.includes(word));
}
