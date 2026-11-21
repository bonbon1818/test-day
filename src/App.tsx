/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { LogOut } from 'lucide-react';
import { auth } from './firebase';
import {
  AppView,
  Category,
  JournalEntry,
  SEVEN_DAYS_MS,
  TrashedEntry,
  purgeExpiredTrash,
} from './types';
import {
  bulkMoveEntriesToTrash,
  bulkPermanentlyDeleteEntries,
  bulkRestoreEntriesFromTrash,
  createJournalEntry,
  ensureUserProfileAndSyncLogin,
  moveEntryToTrash,
  permanentlyDeleteEntry,
  restoreEntryFromTrash,
  seedInitialEntriesIfNeeded,
  subscribeUserEntries,
  updateJournalEntry,
} from './lib/journalFirestore';
import { JournalView } from './components/JournalView';
import { TrashView } from './components/TrashView';
import { AdminDashboard } from './components/AdminDashboard';
import { AdminAuthGate, AdminAuthStatus } from './components/AdminAuthGate';
import { LoginGate } from './components/LoginGate';

const INITIAL_ADMIN_STATUS: AdminAuthStatus = {
  setupRequired: true,
  envLocked: false,
  unlocked: false,
  failedAttempts: 0,
  canAttemptRecovery: false,
  securityQuestion: '아버지 이름이 무엇인가요?',
};

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<Error | null>(null);

  const [view, setView] = useState<AppView>('journal');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [trashedEntries, setTrashedEntries] = useState<TrashedEntry[]>([]);
  const [lastTrashed, setLastTrashed] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // 관리자 인증 세션 토큰은 보안을 위해 브라우저 저장소가 아닌 메모리 상태에만 보관
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminStatus, setAdminStatus] =
    useState<AdminAuthStatus>(INITIAL_ADMIN_STATUS);
  const [adminLoading, setAdminLoading] = useState(false);
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);

  if (dbError) {
    throw dbError;
  }

  const fetchAdminStatus = useCallback(async (token: string | null) => {
    setAdminLoading(true);
    try {
      const res = await fetch('/api/admin/status', {
        credentials: 'same-origin',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return;
      const data = (await res.json()) as AdminAuthStatus;
      setAdminStatus(data);
      if (!data.unlocked && token) {
        setAdminToken(null);
      }
    } catch {
      // 서버 일시 응답 오류 시 기존 상태 유지
    } finally {
      setAdminLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAdminStatus(null);
  }, [fetchAdminStatus]);

  // Firebase Auth 로그인 상태 유지 + Firestore 실시간 동기화
  useEffect(() => {
    let active = true;
    let unsubscribeEntries: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeEntries) {
        unsubscribeEntries();
        unsubscribeEntries = null;
      }

      if (!active) return;

      if (!user) {
        setFirebaseUser(null);
        setEntries([]);
        setTrashedEntries([]);
        setLastTrashed(null);
        setDbReady(false);
        setAuthReady(true);
        return;
      }

      setFirebaseUser(user);
      setAuthReady(true);
      setDbReady(false);

      try {
        const { seededPractice } = await ensureUserProfileAndSyncLogin(user);
        if (!active) return;

        if (!seededPractice) {
          await seedInitialEntriesIfNeeded(user.uid);
          if (!active) return;
        }

        unsubscribeEntries = subscribeUserEntries(
          user.uid,
          ({ entries: activeList, trashedEntries: trashList }) => {
            if (!active) return;
            const currentTime = Date.now();
            setNow(currentTime);

            const expiredIds = trashList
              .filter((item) => currentTime - item.deletedAt >= SEVEN_DAYS_MS)
              .map((item) => item.id);

            if (expiredIds.length > 0) {
              void bulkPermanentlyDeleteEntries(user.uid, expiredIds).catch(
                (err) => {
                  if (active) {
                    setDbError(
                      err instanceof Error ? err : new Error(String(err))
                    );
                  }
                }
              );
            }

            setEntries(activeList);
            setTrashedEntries(purgeExpiredTrash(trashList, currentTime));
            setDbReady(true);
          },
          (err) => {
            if (active) {
              setDbError(err instanceof Error ? err : new Error(String(err)));
            }
          }
        );
      } catch (err) {
        if (active) {
          setDbError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });

    return () => {
      active = false;
      if (unsubscribeEntries) {
        unsubscribeEntries();
      }
      unsubscribeAuth();
    };
  }, []);

  // 7일이 지난 휴지통 기록 자동 삭제 (1분 간격 확인)
  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (!firebaseUser) return;

      const expiredIds = trashedEntries
        .filter((item) => currentTime - item.deletedAt >= SEVEN_DAYS_MS)
        .map((item) => item.id);

      if (expiredIds.length > 0) {
        void bulkPermanentlyDeleteEntries(firebaseUser.uid, expiredIds).catch(
          (err) => {
            setDbError(err instanceof Error ? err : new Error(String(err)));
          }
        );
      }
    }, 60 * 1000);

    return () => window.clearInterval(timer);
  }, [firebaseUser, trashedEntries]);

  const activeTrashedEntries = useMemo(
    () => purgeExpiredTrash(trashedEntries, now),
    [trashedEntries, now]
  );

  const runDbAction = (action: () => Promise<unknown>) => {
    void action().catch((err) => {
      setDbError(err instanceof Error ? err : new Error(String(err)));
    });
  };

  const handleSaveEntry = (
    title: string,
    category: Category,
    content: string
  ) => {
    if (!firebaseUser) return;
    setLastTrashed(null);
    runDbAction(() =>
      createJournalEntry(firebaseUser.uid, { title, category, content })
    );
  };

  const handleMoveToTrash = (entry: JournalEntry) => {
    if (!firebaseUser) return;
    setLastTrashed({ id: entry.id, title: entry.title });
    runDbAction(() => moveEntryToTrash(firebaseUser.uid, entry.id));
  };

  const handleBulkMoveToTrash = (entryIds: string[]) => {
    if (!firebaseUser || entryIds.length === 0) return;
    runDbAction(() => bulkMoveEntriesToTrash(firebaseUser.uid, entryIds));
  };

  const handleRestoreFromTrash = (entryId: string) => {
    if (!firebaseUser) return;
    if (lastTrashed?.id === entryId) {
      setLastTrashed(null);
    }
    runDbAction(() => restoreEntryFromTrash(firebaseUser.uid, entryId));
  };

  const handleBulkRestore = (entryIds: string[]) => {
    if (!firebaseUser || entryIds.length === 0) return;
    runDbAction(() => bulkRestoreEntriesFromTrash(firebaseUser.uid, entryIds));
  };

  const handlePermanentDelete = (entryId: string) => {
    if (!firebaseUser) return;
    runDbAction(() => permanentlyDeleteEntry(firebaseUser.uid, entryId));
  };

  const handleBulkPermanentDelete = (entryIds: string[]) => {
    if (!firebaseUser || entryIds.length === 0) return;
    runDbAction(() =>
      bulkPermanentlyDeleteEntries(firebaseUser.uid, entryIds)
    );
  };

  const handleEmptyTrash = () => {
    if (!firebaseUser || activeTrashedEntries.length === 0) return;
    const ids = activeTrashedEntries.map((item) => item.id);
    runDbAction(() => bulkPermanentlyDeleteEntries(firebaseUser.uid, ids));
  };

  const handleUpdateEntry = (
    entryId: string,
    updates: { title: string; category: Category; content: string }
  ) => {
    if (!firebaseUser) return;
    runDbAction(() => updateJournalEntry(firebaseUser.uid, entryId, updates));
  };

  const handleSwitchView = (nextView: AppView) => {
    const currentTime = Date.now();
    setNow(currentTime);
    setView(nextView);
    if (nextView === 'admin') {
      void fetchAdminStatus(adminToken);
    }
  };

  const handleAdminStatusChange = (
    nextStatus: AdminAuthStatus,
    nextToken?: string | null
  ) => {
    setAdminStatus(nextStatus);
    if (nextToken !== undefined) {
      setAdminToken(nextToken);
      if (nextToken) {
        setLogoutNotice(null);
      }
    }
  };

  const handleLockDashboard = async () => {
    const currentToken = adminToken;
    const isInitialSetup = adminStatus.setupRequired;
    setAdminToken(null);
    setAdminStatus((prev) => ({ ...prev, unlocked: false }));
    setLogoutNotice(
      isInitialSetup
        ? '로그아웃되었습니다. 비밀번호를 설정하거나 건너뛰기를 눌러 다시 들어갈 수 있습니다.'
        : '로그아웃되었습니다. 다시 들어가려면 4자리 숫자 비밀번호를 입력해 주세요.'
    );
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'fetch',
          ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
        },
      });
    } catch {
      // 로그아웃 요청 실패 시에도 로컬 메모리 세션은 즉시 잠금 처리
    }
  };

  const handleAdminSessionExpired = () => {
    setAdminToken(null);
    setAdminStatus((prev) => ({ ...prev, unlocked: false }));
    setLogoutNotice('로그인 시간이 만료되어 로그아웃되었습니다.');
    void fetchAdminStatus(null);
  };

  const handleGoogleSignOut = async () => {
    setView('journal');
    await signOut(auth);
  };

  const handleNewEntryFocus = () => {
    setView('journal');
    window.setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 50);
  };

  if (!authReady || (firebaseUser && !dbReady)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F9F5] px-5 text-[#1B2620]">
        <div className="w-full max-w-sm rounded-2xl border border-[#DCE5DC] bg-white p-8 text-center shadow-[0_1px_3px_rgba(24,52,34,0.04)]">
          <p className="text-sm font-medium text-[#5C7063]">
            로그인 정보와 저장된 기록을 불러오는 중입니다...
          </p>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return <LoginGate />;
  }

  const accountLabel =
    firebaseUser.displayName?.trim() ||
    firebaseUser.email?.split('@')[0] ||
    '내 계정';

  return (
    <div className="min-h-screen bg-[#F7F9F5] text-[#1B2620]">
      {/* 상단 3영역 내비게이션 바 */}
      <header className="sticky top-0 z-30 border-b border-[#DCE5DC] bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:gap-8 sm:px-8">
          {/* 영역 1: 앱 이름 */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              handleSwitchView('journal');
            }}
            className="font-display text-lg font-bold tracking-tight text-[#1B2620] whitespace-nowrap shrink-0 sm:text-xl"
          >
            하루 한 줄 기록장
          </a>

          {/* 영역 2: 핵심 화면 이동 링크 */}
          <nav
            aria-label="주요 메뉴"
            className="flex items-center gap-4 sm:gap-7"
          >
            <button
              type="button"
              onClick={() => handleSwitchView('journal')}
              aria-current={view === 'journal' ? 'page' : undefined}
              className={`min-h-[40px] border-b-2 px-1 py-1.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                view === 'journal'
                  ? 'border-[#2E6F40] text-[#1B2620] font-semibold'
                  : 'border-transparent text-[#5C7063] hover:text-[#1B2620]'
              }`}
            >
              기록장
            </button>
            <button
              type="button"
              onClick={() => handleSwitchView('trash')}
              aria-current={view === 'trash' ? 'page' : undefined}
              className={`min-h-[40px] border-b-2 px-1 py-1.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                view === 'trash'
                  ? 'border-[#2E6F40] text-[#1B2620] font-semibold'
                  : 'border-transparent text-[#5C7063] hover:text-[#1B2620]'
              }`}
            >
              휴지통{' '}
              <span className="tabular-nums text-[#6C7B72]">
                ({activeTrashedEntries.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchView('admin')}
              aria-current={view === 'admin' ? 'page' : undefined}
              className={`min-h-[40px] border-b-2 px-1 py-1.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                view === 'admin'
                  ? 'border-[#2E6F40] text-[#1B2620] font-semibold'
                  : 'border-transparent text-[#5C7063] hover:text-[#1B2620]'
              }`}
            >
              관리자 대시보드
            </button>
          </nav>

          {/* 영역 3: 계정 정보 + 주요 액션 버튼 */}
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <span
              className="max-w-[140px] truncate text-xs font-medium text-[#5C7063]"
              title={firebaseUser.email || accountLabel}
            >
              {accountLabel}님
            </span>
            <button
              type="button"
              onClick={() => void handleGoogleSignOut()}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#5C7063] transition-colors hover:bg-[#F2F6F2] hover:text-[#1B2620] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>계정 로그아웃</span>
            </button>

            {view === 'admin' && adminStatus.unlocked ? (
              <button
                type="button"
                onClick={() => void handleLockDashboard()}
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-[#CED9CE] bg-white px-4 py-2 text-sm font-semibold text-[#1B2620] transition-colors hover:border-[#9F1239] hover:bg-[#FFF1F2] hover:text-[#9F1239] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E6F40] focus-visible:ring-offset-2"
              >
                로그아웃
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNewEntryFocus}
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-[#2E6F40] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#235832] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E6F40] focus-visible:ring-offset-2"
              >
                새 기록 쓰기
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 모바일 상단 계정 바 */}
      <div className="border-b border-[#E5ECE5] bg-[#FAFBF9] px-5 py-2 sm:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between text-xs text-[#5C7063]">
          <span className="truncate font-medium">
            {accountLabel}님 · 파이어베이스 동기화 중
          </span>
          <button
            type="button"
            onClick={() => void handleGoogleSignOut()}
            className="inline-flex items-center gap-1 font-medium text-[#4A5950] hover:text-[#1B2620] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>계정 로그아웃</span>
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        {view === 'journal' && (
          <JournalView
            entries={entries}
            now={now}
            onSaveEntry={handleSaveEntry}
            onUpdateEntry={handleUpdateEntry}
            onMoveToTrash={handleMoveToTrash}
            onUndoTrash={handleRestoreFromTrash}
            lastTrashed={lastTrashed}
            onDismissLastTrashed={() => setLastTrashed(null)}
            titleInputRef={titleInputRef}
          />
        )}

        {view === 'trash' && (
          <TrashView
            trashedEntries={activeTrashedEntries}
            now={now}
            onRestore={handleRestoreFromTrash}
            onPermanentDelete={handlePermanentDelete}
            onEmptyTrash={handleEmptyTrash}
          />
        )}

        {view === 'admin' &&
          (adminStatus.unlocked ? (
            <AdminDashboard
              entries={entries}
              trashedEntries={activeTrashedEntries}
              now={now}
              adminToken={adminToken}
              setupRequired={adminStatus.setupRequired}
              envLocked={adminStatus.envLocked}
              onPinConfigured={(nextToken) => {
                setAdminToken(nextToken);
                setAdminStatus((prev) => ({
                  ...prev,
                  setupRequired: false,
                  unlocked: true,
                  failedAttempts: 0,
                  canAttemptRecovery: false,
                }));
              }}
              onLockDashboard={() => void handleLockDashboard()}
              onSessionExpired={handleAdminSessionExpired}
              onUpdateEntry={handleUpdateEntry}
              onBulkMoveToTrash={handleBulkMoveToTrash}
              onBulkRestore={handleBulkRestore}
              onBulkPermanentDelete={handleBulkPermanentDelete}
              onEmptyTrash={handleEmptyTrash}
            />
          ) : (
            <AdminAuthGate
              status={adminStatus}
              loading={adminLoading}
              logoutNotice={logoutNotice}
              onDismissLogoutNotice={() => setLogoutNotice(null)}
              onStatusChange={handleAdminStatusChange}
            />
          ))}
      </main>
    </div>
  );
}
