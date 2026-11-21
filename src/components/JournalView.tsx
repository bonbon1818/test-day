import React, { useMemo, useState } from 'react';
import { Check, Pencil, RotateCcw, Search, Trash2, X } from 'lucide-react';
import {
  CATEGORIES,
  Category,
  JournalEntry,
  formatRelativeCalendarDate,
  formatShortDate,
  matchesTitleAndContentWords,
} from '../types';
import { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH } from '../lib/journalFirestore';

interface JournalViewProps {
  entries: JournalEntry[];
  now: number;
  onSaveEntry: (title: string, category: Category, content: string) => void;
  onUpdateEntry: (
    entryId: string,
    updates: { title: string; category: Category; content: string }
  ) => void;
  onMoveToTrash: (entry: JournalEntry) => void;
  onUndoTrash: (entryId: string) => void;
  lastTrashed: { title: string; id: string } | null;
  onDismissLastTrashed: () => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
}

export function JournalView({
  entries,
  now,
  onSaveEntry,
  onUpdateEntry,
  onMoveToTrash,
  onUndoTrash,
  lastTrashed,
  onDismissLastTrashed,
  titleInputRef,
}: JournalViewProps) {
  const [title, setTitle] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category>('일상');
  const [content, setContent] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<'전체' | Category>('전체');
  const [searchQuery, setSearchQuery] = useState('');

  // 카드 개별 수정 상태 (검색/분류 중에도 선택한 카드 ID만 수정)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState<Category>('일상');
  const [editContent, setEditContent] = useState('');
  const [editNotice, setEditNotice] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (!trimmedTitle && !trimmedContent) {
      setFormError('제목이나 내용을 입력한 뒤 저장해 주세요.');
      return;
    }

    const finalTitle = trimmedTitle || '제목 없는 기록';
    onSaveEntry(finalTitle, selectedCategory, trimmedContent || '(내용 없음)');
    setTitle('');
    setContent('');
    setFormError(null);
    setSavedNotice(`‘${finalTitle}’ 기록을 저장했어요.`);
  };

  const hasActiveFilter =
    categoryFilter !== '전체' || searchQuery.trim().length > 0;

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const matchesCategory =
        categoryFilter === '전체' || entry.category === categoryFilter;
      const matchesWords = matchesTitleAndContentWords(entry, searchQuery);
      return matchesCategory && matchesWords;
    });
  }, [entries, categoryFilter, searchQuery]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setCategoryFilter('전체');
    setEditNotice(null);
  };

  const handleStartEdit = (entry: JournalEntry) => {
    setEditingId(entry.id);
    setEditTitle(entry.title);
    setEditCategory(entry.category);
    setEditContent(entry.content);
    setEditNotice(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleSaveEdit = (entryId: string) => {
    const nextTitle = editTitle.trim() || '제목 없는 기록';
    const nextContent = editContent.trim() || '(내용 없음)';

    onUpdateEntry(entryId, {
      title: nextTitle,
      category: editCategory,
      content: nextContent,
    });
    setEditingId(null);

    const stillMatchesCategory =
      categoryFilter === '전체' || editCategory === categoryFilter;
    const stillMatchesWords = matchesTitleAndContentWords(
      { title: nextTitle, content: nextContent },
      searchQuery
    );

    if (hasActiveFilter && (!stillMatchesCategory || !stillMatchesWords)) {
      setEditNotice(
        `‘${nextTitle}’ 기록을 수정했어요. 바뀐 내용이 현재 검색·분류 조건과 달라 목록에서 숨겨졌으며, ‘조건 해제’를 누르면 다시 볼 수 있어요.`
      );
    } else {
      setEditNotice(`‘${nextTitle}’ 기록만 수정해 저장했어요.`);
    }
  };

  return (
    <div className="space-y-10">
      {/* 상단 안내 + 새 기록 작성 카드 */}
      <section aria-labelledby="journal-heading">
        <div className="mb-6 flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:justify-between">
          <h1
            id="journal-heading"
            className="font-display text-2xl font-semibold tracking-tight text-[#1B2620] sm:text-3xl [text-wrap:balance]"
          >
            오늘의 작은 발견을 남겨 보세요
          </h1>
          <p className="text-sm font-medium text-[#5C7063] tabular-nums whitespace-nowrap">
            {formatShortDate(now)} (오늘)
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-[#DCE5DC] bg-white p-6 shadow-[0_1px_3px_rgba(24,52,34,0.04)] sm:p-8 space-y-5"
        >
          <div>
            <label
              htmlFor="journal-title"
              className="mb-2 block text-[15px] font-semibold text-[#1B2620]"
            >
              제목
            </label>
            <input
              ref={titleInputRef}
              id="journal-title"
              type="text"
              maxLength={MAX_TITLE_LENGTH}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (formError) setFormError(null);
                if (savedNotice) setSavedNotice(null);
              }}
              placeholder="예: 창가에서 마신 커피"
              className="min-h-[48px] w-full rounded-xl border border-[#CED9CE] bg-[#FAFBF9] px-4 py-3 text-base text-[#1B2620] placeholder:text-[#7E8E84] transition-colors focus:border-[#2E6F40] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
            />
          </div>

          <div>
            <span
              id="category-group-label"
              className="mb-2 block text-[15px] font-semibold text-[#1B2620]"
            >
              분류
            </span>
            <div
              role="group"
              aria-labelledby="category-group-label"
              className="flex flex-wrap gap-2.5"
            >
              {CATEGORIES.map((category) => {
                const isSelected = selectedCategory === category;
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setSelectedCategory(category)}
                    aria-pressed={isSelected}
                    className={`inline-flex min-h-[44px] min-w-[96px] items-center justify-center gap-2 rounded-xl border px-5 py-2 text-[15px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E6F40] focus-visible:ring-offset-2 ${
                      isSelected
                        ? 'border-[#2E6F40] bg-[#EBF4EE] text-[#1D4E2B] font-semibold'
                        : 'border-[#CED9CE] bg-[#FAFBF9] text-[#4A5950] hover:border-[#9EB5A3] hover:bg-white hover:text-[#1B2620]'
                    }`}
                  >
                    {isSelected && (
                      <Check
                        className="h-4 w-4 text-[#2E6F40]"
                        aria-hidden="true"
                      />
                    )}
                    <span>{category}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="journal-content"
              className="mb-2 block text-[15px] font-semibold text-[#1B2620]"
            >
              내용
            </label>
            <textarea
              id="journal-content"
              rows={4}
              maxLength={MAX_CONTENT_LENGTH}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                if (formError) setFormError(null);
                if (savedNotice) setSavedNotice(null);
              }}
              placeholder="기억하고 싶은 생각이나 오늘의 한 줄을 편하게 적어 보세요."
              className="w-full resize-y rounded-xl border border-[#CED9CE] bg-[#FAFBF9] px-4 py-3.5 text-base leading-relaxed text-[#1B2620] placeholder:text-[#7E8E84] transition-colors focus:border-[#2E6F40] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <button
              type="submit"
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-[#2E6F40] px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-[#235832] active:scale-[0.995] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E6F40] focus-visible:ring-offset-2 sm:w-auto sm:min-w-[180px]"
            >
              기록 저장
            </button>

            {formError && (
              <p role="alert" className="text-sm font-medium text-[#9F1239]">
                {formError}
              </p>
            )}
            {savedNotice && !formError && (
              <p role="status" className="text-sm font-medium text-[#1F4A2C]">
                {savedNotice}
              </p>
            )}
          </div>
        </form>
      </section>

      {/* 지난 기록 목록 및 단어 검색 + 분류 선택 */}
      <section aria-labelledby="recent-records-title">
        <div className="flex flex-col gap-4 border-b border-[#DCE5DC] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-baseline gap-2">
              <h2
                id="recent-records-title"
                className="font-display text-xl font-semibold text-[#1B2620]"
              >
                지난 기록
              </h2>
              <span className="text-sm text-[#5C7063]" aria-hidden="true">
                ·
              </span>
              <span className="text-sm font-medium text-[#5C7063] tabular-nums">
                {hasActiveFilter
                  ? `전체 ${entries.length}개 중 ${filteredEntries.length}개`
                  : `${entries.length}개`}
              </span>
            </div>

            {/* 분류 선택 */}
            <div
              role="tablist"
              aria-label="분류별 보기"
              className="inline-flex items-center gap-1 rounded-xl border border-[#DCE5DC] bg-[#EEF3EE] p-1"
            >
              {(['전체', ...CATEGORIES] as const).map((tab) => {
                const isActive = categoryFilter === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setCategoryFilter(tab)}
                    className={`min-h-[38px] rounded-lg px-3.5 py-1.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-white text-[#1B2620] font-semibold shadow-sm'
                        : 'text-[#4A5950] hover:text-[#1B2620]'
                    }`}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative w-full sm:w-72">
              <label htmlFor="journal-search" className="sr-only">
                제목·내용 단어 검색
              </label>
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6C7B72]"
                aria-hidden="true"
              />
              <input
                id="journal-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="제목·내용 단어 검색"
                className="min-h-[44px] w-full rounded-xl border border-[#CED9CE] bg-white py-2.5 pl-10 pr-10 text-[15px] text-[#1B2620] placeholder:text-[#7E8E84] transition-colors focus:border-[#2E6F40] focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="검색어 지우기"
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#5C7063] hover:bg-[#F0F5F1] hover:text-[#1B2620] cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>

            {hasActiveFilter && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#CED9CE] bg-white px-4 py-2 text-sm font-medium text-[#1B2620] transition-colors hover:border-[#2E6F40] hover:bg-[#F2F8F4] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5 text-[#2E6F40]" aria-hidden="true" />
                <span>조건 해제</span>
              </button>
            )}
          </div>
        </div>

        {/* 개별 수정 안내 */}
        {editNotice && (
          <div
            role="status"
            className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#C3DBC9] bg-[#F2F8F4] px-4 py-3 text-sm text-[#1F4A2C]"
          >
            <p>{editNotice}</p>
            <button
              type="button"
              onClick={() => setEditNotice(null)}
              aria-label="수정 안내 닫기"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#2E6F40] hover:bg-[#E1EFE5] cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* 휴지통 이동 알림 + 되돌리기 */}
        {lastTrashed && (
          <div
            role="status"
            className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#C3DBC9] bg-[#F2F8F4] px-4 py-3 text-sm text-[#1F4A2C]"
          >
            <p>
              ‘{lastTrashed.title}’ 기록을 휴지통으로 옮겼어요. 7일 동안 보관된 뒤
              자동으로 삭제됩니다.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onUndoTrash(lastTrashed.id)}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#2E6F40] bg-white px-3 py-1.5 text-sm font-semibold text-[#1F4A2C] hover:bg-[#EBF4EE] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>되돌리기</span>
              </button>
              <button
                type="button"
                onClick={onDismissLastTrashed}
                aria-label="알림 닫기"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#2E6F40] hover:bg-[#E1EFE5] cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {filteredEntries.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-[#DCE5DC] bg-white px-6 py-12 text-center">
            <p className="text-base font-semibold text-[#1B2620]">
              {hasActiveFilter
                ? '검색어와 분류 조건에 모두 맞는 기록이 없어요.'
                : '아직 남겨진 기록이 없어요.'}
            </p>
            <p className="mt-2 text-sm text-[#5C7063]">
              {hasActiveFilter ? (
                <>
                  {searchQuery.trim() && (
                    <span>검색어 ‘{searchQuery.trim()}’</span>
                  )}
                  {searchQuery.trim() && categoryFilter !== '전체' && (
                    <span> · </span>
                  )}
                  {categoryFilter !== '전체' && (
                    <span>분류 ‘{categoryFilter}’</span>
                  )}
                  <span> 조건을 해제하면 전체 기록을 다시 볼 수 있어요.</span>
                </>
              ) : (
                '위 입력칸에 오늘의 작은 발견을 적어 첫 기록을 남겨 보세요.'
              )}
            </p>
            {hasActiveFilter && (
              <div className="mt-5">
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#2E6F40] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#235832] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  <span>조건 해제</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-3">
            {filteredEntries.map((entry) => {
              const isEditing = editingId === entry.id;
              return (
                <article
                  key={entry.id}
                  className="flex flex-col justify-between rounded-2xl border border-[#DCE5DC] bg-white p-6 shadow-[0_1px_3px_rgba(24,52,34,0.04)] transition-colors hover:border-[#B6CBB9]"
                >
                  {isEditing ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-xs font-medium text-[#5C7063]">
                        <span>고른 기록 수정</span>
                        <span className="tabular-nums">
                          {formatRelativeCalendarDate(entry.createdAt, now)}
                        </span>
                      </div>

                      <div>
                        <label
                          htmlFor={`edit-title-${entry.id}`}
                          className="mb-1 block text-xs font-semibold text-[#1B2620]"
                        >
                          제목
                        </label>
                        <input
                          id={`edit-title-${entry.id}`}
                          type="text"
                          maxLength={MAX_TITLE_LENGTH}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="min-h-[42px] w-full rounded-xl border border-[#CED9CE] bg-[#FAFBF9] px-3 py-2 text-sm font-medium text-[#1B2620] focus:border-[#2E6F40] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
                        />
                      </div>

                      <div>
                        <span className="mb-1.5 block text-xs font-semibold text-[#1B2620]">
                          분류
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {CATEGORIES.map((cat) => {
                            const selected = editCategory === cat;
                            return (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => setEditCategory(cat)}
                                aria-pressed={selected}
                                className={`min-h-[36px] rounded-lg border px-3 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                                  selected
                                    ? 'border-[#2E6F40] bg-[#EBF4EE] text-[#1D4E2B] font-semibold'
                                    : 'border-[#CED9CE] bg-[#FAFBF9] text-[#4A5950] hover:bg-white'
                                }`}
                              >
                                {cat}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor={`edit-content-${entry.id}`}
                          className="mb-1 block text-xs font-semibold text-[#1B2620]"
                        >
                          내용
                        </label>
                        <textarea
                          id={`edit-content-${entry.id}`}
                          rows={3}
                          maxLength={MAX_CONTENT_LENGTH}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full resize-y rounded-xl border border-[#CED9CE] bg-[#FAFBF9] px-3 py-2 text-sm leading-relaxed text-[#1B2620] focus:border-[#2E6F40] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-2 border-t border-[#EFF4EF] pt-3">
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          className="min-h-[38px] rounded-lg border border-[#CED9CE] bg-white px-3.5 py-1.5 text-sm font-medium text-[#4A5950] hover:bg-[#FAFBF9] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(entry.id)}
                          className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-[#2E6F40] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#235832] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>저장</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <div className="flex items-center gap-2 text-xs font-medium text-[#2E6F40]">
                          <span>{entry.category}</span>
                          <span className="text-[#9EB5A3]" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-[#6C7B72] tabular-nums">
                            {formatRelativeCalendarDate(entry.createdAt, now)}
                          </span>
                        </div>

                        <h3 className="font-display mt-3 text-lg font-semibold leading-snug text-[#1B2620]">
                          {entry.title}
                        </h3>

                        <p className="mt-2.5 text-[15px] leading-relaxed text-[#4A5950]">
                          {entry.content}
                        </p>
                      </div>

                      <div className="mt-5 flex items-center justify-end gap-1.5 border-t border-[#EFF4EF] pt-3.5">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(entry)}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[#2E6F40] transition-colors hover:bg-[#F2F8F4] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E6F40]"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                          <span>수정</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveToTrash(entry)}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[#5C7063] transition-colors hover:bg-[#F2F6F2] hover:text-[#1B2620] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E6F40]"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          <span>삭제</span>
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
