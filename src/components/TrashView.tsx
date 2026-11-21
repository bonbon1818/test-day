import React, { useMemo, useState } from 'react';
import { Clock, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { TrashedEntry, formatRemainingRetention } from '../types';

interface TrashViewProps {
  trashedEntries: TrashedEntry[];
  now: number;
  onRestore: (entryId: string) => void;
  onPermanentDelete: (entryId: string) => void;
  onEmptyTrash: () => void;
}

export function TrashView({
  trashedEntries,
  now,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
}: TrashViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmPermanentId, setConfirmPermanentId] = useState<string | null>(
    null
  );
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);

  const filteredTrash = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return trashedEntries;
    return trashedEntries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(query) ||
        entry.content.toLowerCase().includes(query) ||
        entry.category.toLowerCase().includes(query)
    );
  }, [trashedEntries, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-[#DCE5DC] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[#1B2620] sm:text-3xl">
            휴지통
          </h1>
          <p className="mt-1.5 flex items-center gap-2 text-sm text-[#4A5950]">
            <Clock className="h-4 w-4 shrink-0 text-[#2E6F40]" aria-hidden="true" />
            <span>
              삭제한 기록은 <strong className="font-semibold text-[#1B2620]">7일 동안 보관</strong>된 뒤 자동으로 완전히 삭제됩니다.
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <label htmlFor="trash-search" className="sr-only">
              휴지통 검색
            </label>
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6C7B72]"
              aria-hidden="true"
            />
            <input
              id="trash-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="휴지통 내 검색"
              className="min-h-[44px] w-full rounded-xl border border-[#CED9CE] bg-white py-2.5 pl-10 pr-10 text-[15px] text-[#1B2620] placeholder:text-[#7E8E84] transition-colors focus:border-[#2E6F40] focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="검색어 지우기"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#5C7063] hover:bg-[#F0F5F1] cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {trashedEntries.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              {confirmEmptyTrash ? (
                <>
                  <span className="text-sm font-medium text-[#881337]">
                    모두 지울까요?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onEmptyTrash();
                      setConfirmEmptyTrash(false);
                    }}
                    className="min-h-[40px] rounded-xl bg-[#9F1239] px-4 py-2 text-sm font-semibold text-white hover:bg-[#881337] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    비우기 확인
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmEmptyTrash(false)}
                    className="min-h-[40px] rounded-xl border border-[#CED9CE] bg-white px-4 py-2 text-sm font-medium text-[#4A5950] hover:bg-[#FAFBF9] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    취소
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmEmptyTrash(true)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#E6CDD4] bg-white px-4 py-2 text-sm font-medium text-[#9F1239] transition-colors hover:bg-[#FFF1F2] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span>휴지통 비우기</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {filteredTrash.length === 0 ? (
        <div className="rounded-2xl border border-[#DCE5DC] bg-white px-6 py-14 text-center">
          <p className="text-base font-medium text-[#1B2620]">
            {searchQuery.trim()
              ? `‘${searchQuery.trim()}’에 해당하는 휴지통 기록이 없어요.`
              : '휴지통이 비어 있어요.'}
          </p>
          <p className="mt-1.5 text-sm text-[#5C7063]">
            {searchQuery.trim()
              ? '검색어를 지우고 전체 목록을 확인해 보세요.'
              : '기록장에서 삭제한 글은 이곳에 7일 동안 보관되며, 언제든 복원할 수 있습니다.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {filteredTrash.map((entry) => {
            const isConfirming = confirmPermanentId === entry.id;
            return (
              <article
                key={entry.id}
                className="flex flex-col justify-between rounded-2xl border border-[#DCE5DC] bg-white p-6 shadow-[0_1px_3px_rgba(24,52,34,0.04)]"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-[#2E6F40]">
                    <span>{entry.category}</span>
                    <span className="text-[#9EB5A3]" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-[#6C7B72] tabular-nums">
                      {formatRemainingRetention(entry.deletedAt, now)}
                    </span>
                  </div>

                  <h3 className="font-display mt-3 text-lg font-semibold leading-snug text-[#1B2620]">
                    {entry.title}
                  </h3>

                  <p className="mt-2.5 text-[15px] leading-relaxed text-[#4A5950]">
                    {entry.content}
                  </p>
                </div>

                <div className="mt-5 border-t border-[#EFF4EF] pt-3.5">
                  {isConfirming ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#881337]">
                        완전히 지울까요?
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onPermanentDelete(entry.id);
                            setConfirmPermanentId(null);
                          }}
                          className="min-h-[36px] rounded-lg bg-[#9F1239] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#881337] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          삭제
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmPermanentId(null)}
                          className="min-h-[36px] rounded-lg border border-[#CED9CE] bg-[#FAFBF9] px-3 py-1.5 text-xs font-medium text-[#4A5950] hover:bg-white whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onRestore(entry.id)}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#C3DBC9] bg-[#F2F8F4] px-3.5 py-1.5 text-sm font-semibold text-[#1F4A2C] transition-colors hover:bg-[#E1EFE5] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        <span>복원</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmPermanentId(entry.id)}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[#9F1239] transition-colors hover:bg-[#FFF1F2] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        <span>영구 삭제</span>
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
