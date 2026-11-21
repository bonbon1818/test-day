import React, { useMemo, useState } from 'react';
import {
  Check,
  Download,
  KeyRound,
  LogOut,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  CATEGORIES,
  Category,
  JournalEntry,
  TrashedEntry,
  formatRelativeCalendarDate,
  formatRemainingRetention,
  isSameDay,
  matchesTitleAndContentWords,
} from '../types';
import { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH } from '../lib/journalFirestore';

interface AdminDashboardProps {
  entries: JournalEntry[];
  trashedEntries: TrashedEntry[];
  now: number;
  adminToken: string | null;
  setupRequired: boolean;
  envLocked: boolean;
  onPinConfigured: (nextToken: string) => void;
  onLockDashboard: () => void;
  onSessionExpired: () => void;
  onUpdateEntry: (
    entryId: string,
    updates: { title: string; category: Category; content: string }
  ) => void;
  onBulkMoveToTrash: (entryIds: string[]) => void;
  onBulkRestore: (entryIds: string[]) => void;
  onBulkPermanentDelete: (entryIds: string[]) => void;
  onEmptyTrash: () => void;
}

type TableScope = 'active' | 'trash';

function sanitizeFourDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 4);
}

export function AdminDashboard({
  entries,
  trashedEntries,
  now,
  adminToken,
  setupRequired,
  envLocked,
  onPinConfigured,
  onLockDashboard,
  onSessionExpired,
  onUpdateEntry,
  onBulkMoveToTrash,
  onBulkRestore,
  onBulkPermanentDelete,
  onEmptyTrash,
}: AdminDashboardProps) {
  const [tableScope, setTableScope] = useState<TableScope>('active');
  const [categoryFilter, setCategoryFilter] = useState<'전체' | Category>('전체');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState<Category>('일상');
  const [editContent, setEditContent] = useState('');

  const [confirmPermanentDelete, setConfirmPermanentDelete] = useState<
    string | null
  >(null);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPinConfirm, setNewPinConfirm] = useState('');
  const [pinChangeError, setPinChangeError] = useState<string | null>(null);
  const [pinChangeSuccess, setPinChangeSuccess] = useState<string | null>(null);
  const [changingPin, setChangingPin] = useState(false);

  const todayCount = useMemo(
    () => entries.filter((item) => isSameDay(item.createdAt, now)).length,
    [entries, now]
  );

  const categoryBreakdown = useMemo(() => {
    const total = entries.length;
    return CATEGORIES.map((category) => {
      const count = entries.filter((item) => item.category === category).length;
      const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
      return { category, count, percentage };
    });
  }, [entries]);

  const topCategory = useMemo(() => {
    if (entries.length === 0) return null;
    return [...categoryBreakdown].sort((a, b) => b.count - a.count)[0];
  }, [categoryBreakdown, entries.length]);

  const hasActiveFilter =
    categoryFilter !== '전체' || searchQuery.trim().length > 0;

  const handleResetFilters = () => {
    setCategoryFilter('전체');
    setSearchQuery('');
  };

  const currentList = useMemo(() => {
    const source = tableScope === 'active' ? entries : trashedEntries;
    return source.filter((item) => {
      const matchesCategory =
        categoryFilter === '전체' || item.category === categoryFilter;
      const matchesWords = matchesTitleAndContentWords(item, searchQuery);
      return matchesCategory && matchesWords;
    });
  }, [tableScope, entries, trashedEntries, categoryFilter, searchQuery]);

  const visibleIds = useMemo(
    () => currentList.map((item) => item.id),
    [currentList]
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleScopeChange = (scope: TableScope) => {
    setTableScope(scope);
    setSelectedIds([]);
    setEditingId(null);
    setConfirmPermanentDelete(null);
    setConfirmEmptyTrash(false);
  };

  const startEditing = (entry: JournalEntry) => {
    setEditingId(entry.id);
    setEditTitle(entry.title);
    setEditCategory(entry.category);
    setEditContent(entry.content);
  };

  const saveEdit = (entryId: string) => {
    onUpdateEntry(entryId, {
      title: editTitle.trim() || '제목 없는 기록',
      category: editCategory,
      content: editContent.trim() || '(내용 없음)',
    });
    setEditingId(null);
  };

  const handleExportBackup = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      entries,
      trashedEntries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `하루한줄기록장_백업_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleChangePinSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPinChangeError(null);
    setPinChangeSuccess(null);

    if (setupRequired) {
      if (!/^\d{4}$/.test(newPin)) {
        setPinChangeError('새 비밀번호를 4자리 숫자로 입력해 주세요.');
        return;
      }
      if (newPin !== newPinConfirm) {
        setPinChangeError('새 비밀번호와 확인 번호가 서로 다릅니다.');
        return;
      }
      setChangingPin(true);
      try {
        const res = await fetch('/api/admin/setup', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({ pin: newPin }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          token?: string;
          error?: string;
        };
        if (!res.ok || !data.ok || !data.token) {
          setPinChangeError(data.error || '비밀번호를 설정하지 못했습니다.');
          return;
        }
        setNewPin('');
        setNewPinConfirm('');
        onPinConfigured(data.token);
        setPinChangeSuccess('4자리 숫자 비밀번호가 설정되었습니다.');
      } catch {
        setPinChangeError('서버와 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      } finally {
        setChangingPin(false);
      }
      return;
    }

    if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) {
      setPinChangeError('현재 비밀번호와 새 비밀번호 모두 4자리 숫자로 입력해 주세요.');
      return;
    }
    if (newPin !== newPinConfirm) {
      setPinChangeError('새 비밀번호와 확인 번호가 서로 다릅니다.');
      return;
    }
    setChangingPin(true);
    try {
      const res = await fetch('/api/admin/change-pin', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
          ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({ currentPin, newPin }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (res.status === 401 && data.error?.includes('만료')) {
        onSessionExpired();
        return;
      }

      if (!res.ok || !data.ok) {
        setPinChangeError(data.error || '비밀번호를 변경하지 못했습니다.');
        return;
      }

      setCurrentPin('');
      setNewPin('');
      setNewPinConfirm('');
      setPinChangeSuccess(
        '새 4자리 숫자 비밀번호로 변경했어요. 다음 접속부터 적용됩니다.'
      );
    } catch {
      setPinChangeError('서버와 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setChangingPin(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* 대시보드 상단 제목 + 백업 내보내기 + 잠금 */}
      <div className="flex flex-col gap-4 border-b border-[#DCE5DC] pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[#1B2620] sm:text-3xl">
            관리자 대시보드
          </h1>
          <p className="mt-1 text-sm text-[#4A5950]">
            기록 현황을 한눈에 살펴보고 수정·삭제·휴지통 관리를 한곳에서 처리할 수 있습니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleExportBackup}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#CED9CE] bg-white px-4 py-2.5 text-sm font-semibold text-[#1B2620] transition-colors hover:border-[#2E6F40] hover:bg-[#F2F8F4] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="h-4 w-4 text-[#2E6F40]" aria-hidden="true" />
            <span>기록 백업 저장</span>
          </button>

          <button
            type="button"
            onClick={onLockDashboard}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#CED9CE] bg-white px-4 py-2.5 text-sm font-semibold text-[#1B2620] transition-colors hover:border-[#9F1239] hover:bg-[#FFF1F2] hover:text-[#9F1239] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>로그아웃</span>
          </button>
        </div>
      </div>

      {/* 핵심 요약 지표 4개 */}
      <section aria-label="기록 현황 요약">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-[#DCE5DC] bg-white p-5">
            <p className="text-sm font-medium text-[#5C7063]">전체 보관 기록</p>
            <p className="font-display mt-2 text-3xl font-semibold text-[#1B2620] tabular-nums">
              {entries.length}개
            </p>
            <p className="mt-1.5 text-xs text-[#6C7B72]">
              현재 기록장에 표시 중인 글
            </p>
          </div>

          <div className="rounded-2xl border border-[#DCE5DC] bg-white p-5">
            <p className="text-sm font-medium text-[#5C7063]">오늘 작성한 기록</p>
            <p className="font-display mt-2 text-3xl font-semibold text-[#2E6F40] tabular-nums">
              {todayCount}개
            </p>
            <p className="mt-1.5 text-xs text-[#6C7B72]">
              오늘 날짜 기준 새로 남긴 글
            </p>
          </div>

          <div className="rounded-2xl border border-[#DCE5DC] bg-white p-5">
            <p className="text-sm font-medium text-[#5C7063]">가장 많은 분류</p>
            <p className="font-display mt-2 text-3xl font-semibold text-[#1B2620]">
              {topCategory ? topCategory.category : '-'}
            </p>
            <p className="mt-1.5 text-xs text-[#6C7B72] tabular-nums">
              {topCategory
                ? `${topCategory.count}개 (${topCategory.percentage}%)`
                : '기록이 아직 없습니다'}
            </p>
          </div>

          <div className="rounded-2xl border border-[#DCE5DC] bg-white p-5">
            <p className="text-sm font-medium text-[#5C7063]">휴지통 대기 중</p>
            <p className="font-display mt-2 text-3xl font-semibold text-[#1B2620] tabular-nums">
              {trashedEntries.length}개
            </p>
            <p className="mt-1.5 text-xs text-[#6C7B72]">
              7일 보관 후 자동 영구 삭제
            </p>
          </div>
        </div>
      </section>

      {/* 분류별 분포 막대 */}
      <section
        aria-labelledby="category-stats-heading"
        className="rounded-2xl border border-[#DCE5DC] bg-white p-6"
      >
        <h2
          id="category-stats-heading"
          className="font-display text-lg font-semibold text-[#1B2620]"
        >
          분류별 기록 비율
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-3">
          {categoryBreakdown.map((item) => (
            <div key={item.category} className="space-y-2">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold text-[#1B2620]">
                  {item.category}
                </span>
                <span className="text-[#5C7063] tabular-nums">
                  {item.count}개 · {item.percentage}%
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#EEF3EE]">
                <div
                  className="h-full rounded-full bg-[#2E6F40] transition-all duration-300"
                  style={{ width: `${item.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 기록 통합 관리 표 */}
      <section
        aria-labelledby="admin-table-heading"
        className="rounded-2xl border border-[#DCE5DC] bg-white"
      >
        <div className="flex flex-col gap-4 border-b border-[#DCE5DC] p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h2
              id="admin-table-heading"
              className="font-display text-lg font-semibold text-[#1B2620]"
            >
              기록 관리
            </h2>

            {/* 보관 중 / 휴지통 전환 탭 */}
            <div
              role="tablist"
              aria-label="관리 대상 선택"
              className="inline-flex items-center gap-1 rounded-xl border border-[#DCE5DC] bg-[#EEF3EE] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tableScope === 'active'}
                onClick={() => handleScopeChange('active')}
                className={`min-h-[38px] rounded-lg px-3.5 py-1.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  tableScope === 'active'
                    ? 'bg-white text-[#1B2620] font-semibold shadow-sm'
                    : 'text-[#4A5950] hover:text-[#1B2620]'
                }`}
              >
                보관 중 ({entries.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tableScope === 'trash'}
                onClick={() => handleScopeChange('trash')}
                className={`min-h-[38px] rounded-lg px-3.5 py-1.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  tableScope === 'trash'
                    ? 'bg-white text-[#1B2620] font-semibold shadow-sm'
                    : 'text-[#4A5950] hover:text-[#1B2620]'
                }`}
              >
                휴지통 ({trashedEntries.length})
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* 분류 필터 */}
            <div className="inline-flex items-center gap-1 rounded-xl border border-[#DCE5DC] bg-[#FAFBF9] p-1">
              {(['전체', ...CATEGORIES] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`min-h-[36px] rounded-lg px-3 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    categoryFilter === cat
                      ? 'bg-[#2E6F40] text-white font-semibold'
                      : 'text-[#4A5950] hover:text-[#1B2620]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* 표 검색 */}
            <div className="relative w-full sm:w-64">
              <label htmlFor="admin-search" className="sr-only">
                관리 목록 검색
              </label>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6C7B72]"
                aria-hidden="true"
              />
              <input
                id="admin-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="제목·내용 검색"
                className="min-h-[42px] w-full rounded-xl border border-[#CED9CE] bg-[#FAFBF9] py-2 pl-9 pr-9 text-sm text-[#1B2620] placeholder:text-[#7E8E84] focus:border-[#2E6F40] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="검색어 지우기"
                  className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[#5C7063] hover:bg-[#EEF3EE] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            {hasActiveFilter && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#CED9CE] bg-white px-3.5 py-2 text-xs font-semibold text-[#1B2620] hover:border-[#2E6F40] hover:bg-[#F2F8F4] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5 text-[#2E6F40]" aria-hidden="true" />
                <span>조건 해제</span>
              </button>
            )}
          </div>
        </div>

        {/* 일괄 작업 바 / 휴지통 비우기 바 */}
        {(selectedIds.length > 0 ||
          (tableScope === 'trash' && trashedEntries.length > 0)) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE5DC] bg-[#F7FAF7] px-5 py-3 sm:px-6">
            <div className="text-sm font-medium text-[#1B2620] tabular-nums">
              {selectedIds.length > 0
                ? `${selectedIds.length}개 선택됨`
                : '휴지통 항목은 7일 후 자동 삭제됩니다'}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedIds.length > 0 && tableScope === 'active' && (
                <button
                  type="button"
                  onClick={() => {
                    onBulkMoveToTrash(selectedIds);
                    setSelectedIds([]);
                  }}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#CED9CE] bg-white px-3.5 py-1.5 text-sm font-medium text-[#1B2620] hover:bg-[#F2F6F2] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Trash2 className="h-4 w-4 text-[#5C7063]" aria-hidden="true" />
                  <span>선택 휴지통으로</span>
                </button>
              )}

              {selectedIds.length > 0 && tableScope === 'trash' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onBulkRestore(selectedIds);
                      setSelectedIds([]);
                    }}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#C3DBC9] bg-white px-3.5 py-1.5 text-sm font-semibold text-[#1F4A2C] hover:bg-[#EBF4EE] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    <span>선택 복원</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onBulkPermanentDelete(selectedIds);
                      setSelectedIds([]);
                    }}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#9F1239] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#881337] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span>선택 영구 삭제</span>
                  </button>
                </>
              )}

              {tableScope === 'trash' &&
                trashedEntries.length > 0 &&
                selectedIds.length === 0 && (
                  <>
                    {confirmEmptyTrash ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#881337]">
                          모두 영구 삭제할까요?
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onEmptyTrash();
                            setConfirmEmptyTrash(false);
                          }}
                          className="min-h-[36px] rounded-lg bg-[#9F1239] px-3 py-1 text-xs font-semibold text-white hover:bg-[#881337] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          비우기 확인
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmEmptyTrash(false)}
                          className="min-h-[36px] rounded-lg border border-[#CED9CE] bg-white px-3 py-1 text-xs font-medium text-[#4A5950] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmEmptyTrash(true)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#E6CDD4] bg-white px-3.5 py-1.5 text-sm font-medium text-[#9F1239] hover:bg-[#FFF1F2] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        <span>휴지통 전체 비우기</span>
                      </button>
                    )}
                  </>
                )}
            </div>
          </div>
        )}

        {/* 데이터 표 */}
        {currentList.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-base font-medium text-[#1B2620]">
              {hasActiveFilter
                ? '검색어와 분류 조건에 모두 맞는 기록이 없습니다.'
                : tableScope === 'active'
                  ? '표시할 보관 기록이 없습니다.'
                  : '휴지통에 담긴 기록이 없습니다.'}
            </p>
            <p className="mt-1 text-sm text-[#5C7063]">
              {hasActiveFilter
                ? '조건을 해제하면 전체 목록을 다시 볼 수 있습니다.'
                : '새 기록을 남기거나 다른 탭을 확인해 보세요.'}
            </p>
            {hasActiveFilter && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#2E6F40] px-4 py-2 text-sm font-semibold text-white hover:bg-[#235832] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  <span>조건 해제</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[#DCE5DC] bg-[#FAFBF9] text-xs font-semibold text-[#5C7063]">
                  <th className="w-12 py-3.5 pl-5 pr-2">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      aria-label="현재 목록 모두 선택"
                      className="h-4 w-4 accent-[#2E6F40] cursor-pointer"
                    />
                  </th>
                  <th className="py-3.5 px-3">제목 및 내용</th>
                  <th className="w-28 py-3.5 px-3">분류</th>
                  <th className="w-40 py-3.5 px-3">
                    {tableScope === 'active' ? '작성일' : '남은 보관 기간'}
                  </th>
                  <th className="w-44 py-3.5 pl-3 pr-5 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFF4EF] text-sm">
                {currentList.map((item) => {
                  const isChecked = selectedIds.includes(item.id);
                  const isEditing = editingId === item.id;
                  const trashedItem =
                    tableScope === 'trash' ? (item as TrashedEntry) : null;

                  return (
                    <tr
                      key={item.id}
                      className="transition-colors hover:bg-[#FAFBF9]"
                    >
                      <td className="py-4 pl-5 pr-2 align-top">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectRow(item.id)}
                          aria-label={`${item.title} 선택`}
                          className="mt-1 h-4 w-4 accent-[#2E6F40] cursor-pointer"
                        />
                      </td>

                      <td className="py-4 px-3 align-top">
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              maxLength={MAX_TITLE_LENGTH}
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              aria-label="제목 수정"
                              className="min-h-[40px] w-full rounded-lg border border-[#CED9CE] bg-white px-3 py-1.5 text-sm font-medium text-[#1B2620] focus:border-[#2E6F40] focus:outline-none"
                            />
                            <textarea
                              rows={2}
                              maxLength={MAX_CONTENT_LENGTH}
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              aria-label="내용 수정"
                              className="w-full rounded-lg border border-[#CED9CE] bg-white px-3 py-1.5 text-sm text-[#4A5950] focus:border-[#2E6F40] focus:outline-none"
                            />
                          </div>
                        ) : (
                          <div>
                            <p className="font-semibold text-[#1B2620]">
                              {item.title}
                            </p>
                            <p className="mt-1 line-clamp-2 text-[#4A5950]">
                              {item.content}
                            </p>
                          </div>
                        )}
                      </td>

                      <td className="py-4 px-3 align-top whitespace-nowrap">
                        {isEditing ? (
                          <select
                            value={editCategory}
                            onChange={(e) =>
                              setEditCategory(e.target.value as Category)
                            }
                            aria-label="분류 수정"
                            className="min-h-[40px] rounded-lg border border-[#CED9CE] bg-white px-2.5 py-1.5 text-sm text-[#1B2620] focus:border-[#2E6F40] focus:outline-none"
                          >
                            {CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-medium text-[#2E6F40]">
                            {item.category}
                          </span>
                        )}
                      </td>

                      <td className="py-4 px-3 align-top text-[#5C7063] tabular-nums whitespace-nowrap">
                        {trashedItem
                          ? formatRemainingRetention(trashedItem.deletedAt, now)
                          : formatRelativeCalendarDate(item.createdAt, now)}
                      </td>

                      <td className="py-4 pl-3 pr-5 align-top text-right">
                        {tableScope === 'active' ? (
                          isEditing ? (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => saveEdit(item.id)}
                                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[#2E6F40] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#235832] whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>저장</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="min-h-[36px] rounded-lg border border-[#CED9CE] bg-white px-3 py-1.5 text-xs font-medium text-[#4A5950] hover:bg-[#FAFBF9] whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                취소
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEditing(item)}
                                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[#DCE5DC] bg-white px-2.5 py-1.5 text-xs font-medium text-[#1B2620] hover:bg-[#F2F8F4] whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Pencil className="h-3.5 w-3.5 text-[#2E6F40]" aria-hidden="true" />
                                <span>수정</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => onBulkMoveToTrash([item.id])}
                                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#5C7063] hover:bg-[#F2F6F2] hover:text-[#1B2620] whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>삭제</span>
                              </button>
                            </div>
                          )
                        ) : confirmPermanentDelete === item.id ? (
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                onBulkPermanentDelete([item.id]);
                                setConfirmPermanentDelete(null);
                              }}
                              className="min-h-[36px] rounded-lg bg-[#9F1239] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#881337] whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              삭제 확인
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmPermanentDelete(null)}
                              className="min-h-[36px] rounded-lg border border-[#CED9CE] bg-white px-2.5 py-1.5 text-xs font-medium text-[#4A5950] whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => onBulkRestore([item.id])}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[#C3DBC9] bg-[#F2F8F4] px-2.5 py-1.5 text-xs font-semibold text-[#1F4A2C] hover:bg-[#E1EFE5] whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>복원</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmPermanentDelete(item.id)}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#9F1239] hover:bg-[#FFF1F2] whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>영구 삭제</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 관리자 비밀번호 수정 */}
      <section
        aria-labelledby="admin-pin-change-heading"
        className="rounded-2xl border border-[#DCE5DC] bg-white p-6"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-[#2E6F40]" aria-hidden="true" />
          <h2
            id="admin-pin-change-heading"
            className="font-display text-lg font-semibold text-[#1B2620]"
          >
            {setupRequired ? '관리자 비밀번호 설정' : '관리자 비밀번호 수정'}
          </h2>
        </div>

        {envLocked ? (
          <p className="mt-2 text-sm text-[#5C7063]">
            현재 서버 환경 변수로 비밀번호가 지정되어 있어 화면에서 변경할 수 없습니다.
          </p>
        ) : (
          <form onSubmit={handleChangePinSubmit} className="mt-4 space-y-4">
            <p className="text-sm text-[#4A5950]">
              {setupRequired ? (
                <>
                  지금은 비밀번호 없이 열려 있습니다. 필요할 때{' '}
                  <strong className="font-semibold text-[#1B2620]">
                    4자리 숫자 비밀번호
                  </strong>
                  를 설정할 수 있습니다.
                </>
              ) : (
                <>
                  대시보드 잠금에 쓰는{' '}
                  <strong className="font-semibold text-[#1B2620]">
                    4자리 숫자 비밀번호
                  </strong>
                  를 새 번호로 바꿀 수 있습니다.
                </>
              )}
            </p>

            <div
              className={`grid grid-cols-1 gap-4 ${
                setupRequired ? 'sm:grid-cols-2' : 'sm:grid-cols-3'
              }`}
            >
              {!setupRequired && (
                <div>
                  <label
                    htmlFor="current-admin-pin"
                    className="mb-1.5 block text-xs font-semibold text-[#1B2620]"
                  >
                    현재 비밀번호 (숫자 4자리)
                  </label>
                  <input
                    id="current-admin-pin"
                    type="password"
                    inputMode="numeric"
                    pattern="\d{4}"
                    maxLength={4}
                    autoComplete="current-password"
                    value={currentPin}
                    onChange={(e) => {
                      setCurrentPin(sanitizeFourDigits(e.target.value));
                      if (pinChangeError) setPinChangeError(null);
                      if (pinChangeSuccess) setPinChangeSuccess(null);
                    }}
                    placeholder="••••"
                    className="min-h-[44px] w-full rounded-xl border border-[#CED9CE] bg-[#FAFBF9] px-3.5 py-2 text-center text-lg font-semibold tracking-[0.35em] text-[#1B2620] tabular-nums focus:border-[#2E6F40] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="new-admin-pin"
                  className="mb-1.5 block text-xs font-semibold text-[#1B2620]"
                >
                  새 비밀번호 (숫자 4자리)
                </label>
                <input
                  id="new-admin-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  autoComplete="new-password"
                  value={newPin}
                  onChange={(e) => {
                    setNewPin(sanitizeFourDigits(e.target.value));
                    if (pinChangeError) setPinChangeError(null);
                    if (pinChangeSuccess) setPinChangeSuccess(null);
                  }}
                  placeholder="••••"
                  className="min-h-[44px] w-full rounded-xl border border-[#CED9CE] bg-[#FAFBF9] px-3.5 py-2 text-center text-lg font-semibold tracking-[0.35em] text-[#1B2620] tabular-nums focus:border-[#2E6F40] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
                />
              </div>

              <div>
                <label
                  htmlFor="confirm-admin-pin"
                  className="mb-1.5 block text-xs font-semibold text-[#1B2620]"
                >
                  새 비밀번호 확인
                </label>
                <input
                  id="confirm-admin-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  autoComplete="new-password"
                  value={newPinConfirm}
                  onChange={(e) => {
                    setNewPinConfirm(sanitizeFourDigits(e.target.value));
                    if (pinChangeError) setPinChangeError(null);
                    if (pinChangeSuccess) setPinChangeSuccess(null);
                  }}
                  placeholder="••••"
                  className="min-h-[44px] w-full rounded-xl border border-[#CED9CE] bg-[#FAFBF9] px-3.5 py-2 text-center text-lg font-semibold tracking-[0.35em] text-[#1B2620] tabular-nums focus:border-[#2E6F40] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="submit"
                disabled={changingPin}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2E6F40] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#235832] disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {changingPin
                  ? '저장 중...'
                  : setupRequired
                    ? '비밀번호 설정'
                    : '비밀번호 변경'}
              </button>

              {pinChangeError && (
                <p role="alert" className="text-sm font-medium text-[#9F1239]">
                  {pinChangeError}
                </p>
              )}
              {pinChangeSuccess && (
                <p role="status" className="text-sm font-medium text-[#1F4A2C]">
                  {pinChangeSuccess}
                </p>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
