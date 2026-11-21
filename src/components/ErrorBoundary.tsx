import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || '알 수 없는 오류가 발생했습니다.',
    };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const isQuotaError =
      this.state.errorMessage.includes('Quota exceeded') ||
      this.state.errorMessage.includes('Free daily read units');

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F9F5] px-5 py-10 text-[#1B2620]">
        <div className="w-full max-w-md rounded-2xl border border-[#DCE5DC] bg-white p-8 shadow-[0_1px_3px_rgba(24,52,34,0.05)]">
          <div className="flex items-center gap-2.5 text-[#9F1239]">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <h1 className="font-display text-xl font-semibold text-[#1B2620]">
              {isQuotaError
                ? '일일 데이터베이스 사용 한도에 도달했습니다'
                : '데이터를 불러오는 중 문제가 발생했습니다'}
            </h1>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[#4A5950]">
            {isQuotaError
              ? '무료 tier 일일 읽기 한도가 초과되었습니다. 내일 한도가 초기화되거나 Firebase 콘솔에서 요금제를 업그레이드할 수 있습니다.'
              : '파이어베이스 연결 또는 권한 확인 중 오류가 발생했습니다. 페이지를 새로고침하거나 다시 로그인해 보세요.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#2E6F40] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#235832] cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>페이지 새로고침</span>
          </button>
        </div>
      </div>
    );
  }
}
