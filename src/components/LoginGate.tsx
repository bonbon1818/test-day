import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { BookOpenCheck, LogIn } from 'lucide-react';
import { auth, googleProvider } from '../firebase';

export function LoginGate() {
  const [signingIn, setSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setErrorMessage(null);
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';

      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setErrorMessage('로그인이 취소되었습니다. 다시 시도해 주세요.');
      } else if (code === 'auth/popup-blocked') {
        setErrorMessage(
          '브라우저에서 로그인 팝업이 차단되었습니다. 팝업 허용 후 다시 눌러 주세요.'
        );
      } else {
        setErrorMessage(
          '로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        );
      }
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F7F9F5] px-5 py-12 text-[#1B2620]">
      <div className="w-full max-w-md rounded-2xl border border-[#DCE5DC] bg-white p-8 shadow-[0_1px_3px_rgba(24,52,34,0.05)] sm:p-10">
        <div className="flex items-center gap-2.5 text-[#2E6F40]">
          <BookOpenCheck className="h-6 w-6 shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">
            하루 한 줄 기록장
          </span>
        </div>

        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-[#1B2620]">
          로그인하고 내 기록을 안전하게 보관하세요
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-[#4A5950]">
          Google 계정으로 한 번 로그인하면 로그인 정보가 유지되고, 작성한 모든 기록과 휴지통 내역이 파이어베이스 데이터베이스에 실시간으로 저장됩니다.
        </p>

        <div className="mt-6 rounded-xl border border-[#E5ECE5] bg-[#FAFBF9] p-4 text-xs leading-relaxed text-[#5C7063]">
          <p>• 새로고침하거나 다시 접속해도 로그인 상태와 기록이 그대로 유지됩니다.</p>
          <p className="mt-1">• 내 계정으로 로그인한 기록은 본인만 열람하고 수정할 수 있습니다.</p>
        </div>

        {errorMessage && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-[#FBCFE8] bg-[#FFF1F2] px-4 py-3 text-sm font-medium text-[#9F1239]"
          >
            {errorMessage}
          </p>
        )}

        <button
          type="button"
          onClick={() => void handleGoogleLogin()}
          disabled={signingIn}
          className="mt-6 inline-flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-xl bg-[#2E6F40] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#235832] disabled:opacity-60 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E6F40] focus-visible:ring-offset-2"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          <span>{signingIn ? '로그인 중...' : 'Google 계정으로 로그인'}</span>
        </button>
      </div>
    </div>
  );
}
