import React, { useEffect, useRef, useState } from 'react';
import { Check, KeyRound, Lock, RotateCcw, ShieldCheck, X } from 'lucide-react';

export interface AdminAuthStatus {
  setupRequired: boolean;
  envLocked: boolean;
  unlocked: boolean;
  failedAttempts: number;
  canAttemptRecovery: boolean;
  securityQuestion: string;
}

interface AdminAuthGateProps {
  status: AdminAuthStatus;
  loading: boolean;
  logoutNotice?: string | null;
  onDismissLogoutNotice?: () => void;
  onStatusChange: (nextStatus: AdminAuthStatus, token?: string | null) => void;
}

function sanitizeFourDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 4);
}

export function AdminAuthGate({
  status,
  loading,
  logoutNotice,
  onDismissLogoutNotice,
  onStatusChange,
}: AdminAuthGateProps) {
  // 초기 설정 상태
  const [setupPin, setSetupPin] = useState('');
  const [setupPinConfirm, setSetupPinConfirm] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [submittingSetup, setSubmittingSetup] = useState(false);
  const [skippingSetup, setSkippingSetup] = useState(false);

  // 로그인 상태
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submittingLogin, setSubmittingLogin] = useState(false);

  // 비밀번호 초기화 (5회 이상 실패 + 질문 답변)
  const [recoveryAnswer, setRecoveryAnswer] = useState('');
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [recoveryFeedback, setRecoveryFeedback] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [verifyingRecovery, setVerifyingRecovery] = useState(false);
  const [resettingPin, setResettingPin] = useState(false);
  const [resetCompletedNotice, setResetCompletedNotice] = useState<string | null>(
    null
  );

  const latestAnswerRef = useRef('');

  useEffect(() => {
    latestAnswerRef.current = recoveryAnswer;
    setRecoveryToken(null);
    setRecoveryFeedback(null);
    setRecoveryError(null);

    if (!status.canAttemptRecovery) return;
    const trimmed = recoveryAnswer.trim();
    if (!trimmed) return;

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/verify-recovery', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify({ answer: trimmed }),
        });
        const data = (await res.json()) as {
          verified?: boolean;
          recoveryToken?: string;
        };
        if (latestAnswerRef.current.trim() !== trimmed) return;
        if (res.ok && data.verified && data.recoveryToken) {
          setRecoveryToken(data.recoveryToken);
          setRecoveryFeedback(
            '답변이 확인되었습니다. 이제 아래 ‘비밀번호 초기화’ 버튼을 누를 수 있어요.'
          );
          setRecoveryError(null);
        }
      } catch {
        // 네트워크 오류 시 수동 확인 버튼으로 재시도 가능
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [recoveryAnswer, status.canAttemptRecovery]);

  const handleSetupSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSetupError(null);

    if (!/^\d{4}$/.test(setupPin)) {
      setSetupError('비밀번호는 4자리 숫자(0~9)로만 입력해 주세요.');
      return;
    }
    if (setupPin !== setupPinConfirm) {
      setSetupError('두 번 입력한 4자리 숫자가 서로 다릅니다.');
      return;
    }

    setSubmittingSetup(true);
    try {
      const res = await fetch('/api/admin/setup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({ pin: setupPin }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.token) {
        setSetupError(data.error || '초기 비밀번호 설정에 실패했습니다.');
        return;
      }

      setSetupPin('');
      setSetupPinConfirm('');
      setResetCompletedNotice(null);
      onStatusChange(
        {
          ...status,
          setupRequired: false,
          unlocked: true,
          failedAttempts: 0,
          canAttemptRecovery: false,
        },
        data.token
      );
    } catch {
      setSetupError('서버와 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSubmittingSetup(false);
    }
  };

  const handleSkipSetup = async () => {
    setSetupError(null);
    setSkippingSetup(true);
    try {
      const res = await fetch('/api/admin/skip', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'fetch',
        },
      });
      const data = (await res.json()) as {
        ok?: boolean;
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.token) {
        setSetupError(data.error || '건너뛰기 처리에 실패했습니다.');
        return;
      }

      setSetupPin('');
      setSetupPinConfirm('');
      setResetCompletedNotice(null);
      onStatusChange(
        {
          ...status,
          setupRequired: true,
          unlocked: true,
          failedAttempts: 0,
          canAttemptRecovery: false,
        },
        data.token
      );
    } catch {
      setSetupError('서버와 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSkippingSetup(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoginError(null);
    setResetCompletedNotice(null);

    if (!/^\d{4}$/.test(loginPin)) {
      setLoginError('비밀번호는 4자리 숫자(0~9)만 입력할 수 있습니다.');
      return;
    }

    setSubmittingLogin(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({ pin: loginPin }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        token?: string;
        error?: string;
        failedAttempts?: number;
        canAttemptRecovery?: boolean;
      };

      if (res.ok && data.ok && data.token) {
        setLoginPin('');
        setRecoveryAnswer('');
        setRecoveryToken(null);
        onStatusChange(
          {
            ...status,
            unlocked: true,
            failedAttempts: 0,
            canAttemptRecovery: false,
          },
          data.token
        );
        return;
      }

      setLoginPin('');
      const nextFailures = Math.min(
        5,
        typeof data.failedAttempts === 'number'
          ? data.failedAttempts
          : status.failedAttempts + 1
      );
      const canRecover =
        typeof data.canAttemptRecovery === 'boolean'
          ? data.canAttemptRecovery
          : !status.envLocked && nextFailures >= 5;

      setLoginError(data.error || '비밀번호가 맞지 않습니다.');
      onStatusChange(
        {
          ...status,
          unlocked: false,
          failedAttempts: nextFailures,
          canAttemptRecovery: canRecover,
        },
        null
      );
    } catch {
      setLoginError('서버와 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSubmittingLogin(false);
    }
  };

  const handleVerifyAnswerClick = async () => {
    setRecoveryError(null);
    setRecoveryFeedback(null);

    const trimmed = recoveryAnswer.trim();
    if (!trimmed) {
      setRecoveryError('질문의 답을 입력해 주세요.');
      return;
    }

    setVerifyingRecovery(true);
    try {
      const res = await fetch('/api/admin/verify-recovery', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({ answer: trimmed }),
      });
      const data = (await res.json()) as {
        verified?: boolean;
        recoveryToken?: string;
        error?: string;
      };

      if (res.ok && data.verified && data.recoveryToken) {
        setRecoveryToken(data.recoveryToken);
        setRecoveryFeedback(
          '답변이 확인되었습니다. 이제 아래 ‘비밀번호 초기화’ 버튼을 누를 수 있어요.'
        );
      } else {
        setRecoveryToken(null);
        setRecoveryError(data.error || '답변이 일치하지 않습니다.');
      }
    } catch {
      setRecoveryError('확인 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setVerifyingRecovery(false);
    }
  };

  const handleResetPin = async () => {
    if (!recoveryToken) return;
    setResettingPin(true);
    setRecoveryError(null);

    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({ recoveryToken }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        setRecoveryError(data.error || '비밀번호를 초기화하지 못했습니다.');
        return;
      }

      setLoginPin('');
      setLoginError(null);
      setRecoveryAnswer('');
      setRecoveryToken(null);
      setRecoveryFeedback(null);
      setResetCompletedNotice(
        '비밀번호가 초기화되었습니다. 새 4자리 숫자 비밀번호를 설정해 주세요.'
      );
      onStatusChange(
        {
          ...status,
          setupRequired: true,
          unlocked: false,
          failedAttempts: 0,
          canAttemptRecovery: false,
        },
        null
      );
    } catch {
      setRecoveryError('서버와 연결하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setResettingPin(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-[#DCE5DC] bg-white p-8 text-center">
        <p className="text-sm font-medium text-[#5C7063]">
          관리자 보안 상태를 확인하고 있습니다...
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      {logoutNotice && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-[#C3DBC9] bg-[#F2F8F4] px-4 py-3 text-sm font-medium text-[#1F4A2C]"
        >
          <span>{logoutNotice}</span>
          {onDismissLogoutNotice && (
            <button
              type="button"
              onClick={onDismissLogoutNotice}
              aria-label="알림 닫기"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#2E6F40] hover:bg-[#E1EFE5] cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {resetCompletedNotice && (
        <div
          role="status"
          className="rounded-xl border border-[#C3DBC9] bg-[#F2F8F4] px-4 py-3 text-sm font-medium text-[#1F4A2C]"
        >
          {resetCompletedNotice}
        </div>
      )}

      {status.setupRequired ? (
        <section
          aria-labelledby="admin-setup-title"
          className="rounded-2xl border border-[#DCE5DC] bg-white p-6 shadow-[0_1px_3px_rgba(24,52,34,0.04)] sm:p-8"
        >
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-[#2E6F40]" aria-hidden="true" />
            <h1
              id="admin-setup-title"
              className="font-display text-xl font-semibold text-[#1B2620]"
            >
              초기 관리자 비밀번호 설정
            </h1>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[#4A5950]">
            관리자 대시보드를 보호할 <strong className="font-semibold text-[#1B2620]">4자리 숫자 비밀번호</strong>를 먼저 정해 주세요. 설정 후 대시보드 안에서 언제든 바꿀 수 있습니다.
          </p>

          <form onSubmit={handleSetupSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="setup-pin"
                className="mb-1.5 block text-sm font-semibold text-[#1B2620]"
              >
                새 비밀번호 (숫자 4자리)
              </label>
              <input
                id="setup-pin"
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                autoComplete="new-password"
                value={setupPin}
                onChange={(e) => {
                  setSetupPin(sanitizeFourDigits(e.target.value));
                  if (setupError) setSetupError(null);
                }}
                placeholder="••••"
                className="min-h-[48px] w-full rounded-xl border border-[#CED9CE] bg-[#FAFBF9] px-4 py-3 text-center text-2xl font-semibold tracking-[0.45em] text-[#1B2620] tabular-nums placeholder:tracking-[0.35em] placeholder:text-[#9EB5A3] focus:border-[#2E6F40] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
              />
            </div>

            <div>
              <label
                htmlFor="setup-pin-confirm"
                className="mb-1.5 block text-sm font-semibold text-[#1B2620]"
              >
                비밀번호 확인 (숫자 4자리)
              </label>
              <input
                id="setup-pin-confirm"
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                autoComplete="new-password"
                value={setupPinConfirm}
                onChange={(e) => {
                  setSetupPinConfirm(sanitizeFourDigits(e.target.value));
                  if (setupError) setSetupError(null);
                }}
                placeholder="••••"
                className="min-h-[48px] w-full rounded-xl border border-[#CED9CE] bg-[#FAFBF9] px-4 py-3 text-center text-2xl font-semibold tracking-[0.45em] text-[#1B2620] tabular-nums placeholder:tracking-[0.35em] placeholder:text-[#9EB5A3] focus:border-[#2E6F40] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
              />
            </div>

            {setupError && (
              <p role="alert" className="text-sm font-medium text-[#9F1239]">
                {setupError}
              </p>
            )}

            <div className="space-y-2.5">
              <button
                type="submit"
                disabled={submittingSetup || skippingSetup}
                className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-[#2E6F40] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#235832] disabled:opacity-60 cursor-pointer"
              >
                {submittingSetup ? '설정 중...' : '비밀번호 설정하고 열기'}
              </button>

              <button
                type="button"
                onClick={() => void handleSkipSetup()}
                disabled={submittingSetup || skippingSetup}
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-[#CED9CE] bg-white px-5 py-2.5 text-sm font-semibold text-[#4A5950] transition-colors hover:border-[#2E6F40] hover:bg-[#F2F8F4] hover:text-[#1B2620] disabled:opacity-60 cursor-pointer"
              >
                {skippingSetup ? '들어가는 중...' : '건너뛰기 (바로 대시보드 열기)'}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section
          aria-labelledby="admin-login-title"
          className="rounded-2xl border border-[#DCE5DC] bg-white p-6 shadow-[0_1px_3px_rgba(24,52,34,0.04)] sm:p-8"
        >
          <div className="flex items-center gap-2.5">
            <Lock className="h-5 w-5 text-[#2E6F40]" aria-hidden="true" />
            <h1
              id="admin-login-title"
              className="font-display text-xl font-semibold text-[#1B2620]"
            >
              관리자 대시보드 잠금
            </h1>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[#4A5950]">
            설정한 <strong className="font-semibold text-[#1B2620]">4자리 숫자 비밀번호</strong>를 입력해야 관리자 대시보드에 들어갈 수 있습니다.
          </p>

          <form onSubmit={handleLoginSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="admin-login-pin"
                className="mb-1.5 block text-sm font-semibold text-[#1B2620]"
              >
                비밀번호 (숫자 4자리)
              </label>
              <input
                id="admin-login-pin"
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                autoComplete="current-password"
                disabled={submittingLogin}
                value={loginPin}
                onChange={(e) => {
                  setLoginPin(sanitizeFourDigits(e.target.value));
                  if (loginError) setLoginError(null);
                }}
                placeholder="••••"
                className="min-h-[48px] w-full rounded-xl border border-[#CED9CE] bg-[#FAFBF9] px-4 py-3 text-center text-2xl font-semibold tracking-[0.45em] text-[#1B2620] tabular-nums placeholder:tracking-[0.35em] placeholder:text-[#9EB5A3] focus:border-[#2E6F40] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
              />
            </div>

            {loginError && (
              <p role="alert" className="text-sm font-medium text-[#9F1239]">
                {loginError}
              </p>
            )}

            <div className="flex items-center justify-between text-xs text-[#5C7063] tabular-nums">
              <span>숫자 4자리만 입력됩니다</span>
              <span>
                오류 횟수: {Math.min(5, status.failedAttempts)} / 5회
              </span>
            </div>

            <button
              type="submit"
              disabled={submittingLogin}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-[#2E6F40] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#235832] disabled:opacity-60 cursor-pointer"
            >
              {submittingLogin ? '확인 중...' : '잠금 해제'}
            </button>
          </form>

          {/* 비밀번호 초기화 안내 및 5회 이상 실패 시 질문 해제 */}
          <div className="mt-6 border-t border-[#EFF4EF] pt-5">
            {!status.canAttemptRecovery ? (
              <p className="text-xs leading-relaxed text-[#5C7063]">
                {status.envLocked
                  ? '환경 변수로 잠긴 비밀번호는 앱에서 초기화할 수 없습니다.'
                  : '비밀번호가 기억나지 않을 때는 비밀번호를 5번 이상 틀리면 초기화 질문이 열립니다.'}
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#1B2620]">
                  <KeyRound className="h-4 w-4 text-[#2E6F40]" aria-hidden="true" />
                  <span>비밀번호 초기화</span>
                </div>

                <p className="text-xs leading-relaxed text-[#4A5950]">
                  5회 이상 틀려 초기화 질문이 열렸습니다. 아래 질문의 답을 맞혀야 초기화 버튼이 활성화됩니다.
                </p>

                <div>
                  <label
                    htmlFor="recovery-answer"
                    className="mb-1.5 block text-sm font-semibold text-[#1B2620]"
                  >
                    질문: {status.securityQuestion}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="recovery-answer"
                      type="text"
                      value={recoveryAnswer}
                      onChange={(e) => setRecoveryAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleVerifyAnswerClick();
                        }
                      }}
                      placeholder="답변을 입력하세요"
                      className="min-h-[44px] flex-1 rounded-xl border border-[#CED9CE] bg-[#FAFBF9] px-3.5 py-2 text-sm text-[#1B2620] placeholder:text-[#7E8E84] focus:border-[#2E6F40] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2E6F40]/20"
                    />
                    <button
                      type="button"
                      onClick={() => void handleVerifyAnswerClick()}
                      disabled={verifyingRecovery}
                      className="min-h-[44px] rounded-xl border border-[#CED9CE] bg-white px-4 py-2 text-sm font-medium text-[#1B2620] hover:border-[#2E6F40] hover:bg-[#F2F8F4] whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {verifyingRecovery ? '확인 중' : '답변 확인'}
                    </button>
                  </div>
                </div>

                {recoveryError && (
                  <p role="alert" className="text-sm font-medium text-[#9F1239]">
                    {recoveryError}
                  </p>
                )}

                {recoveryFeedback && (
                  <p
                    role="status"
                    className="flex items-center gap-1.5 text-sm font-medium text-[#1F4A2C]"
                  >
                    <Check className="h-4 w-4 shrink-0 text-[#2E6F40]" aria-hidden="true" />
                    <span>{recoveryFeedback}</span>
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void handleResetPin()}
                  disabled={!recoveryToken || resettingPin}
                  className={`inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap ${
                    recoveryToken && !resettingPin
                      ? 'bg-[#2E6F40] text-white hover:bg-[#235832] cursor-pointer'
                      : 'border border-[#DCE5DC] bg-[#EEF3EE] text-[#7E8E84] cursor-not-allowed'
                  }`}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {resettingPin ? '초기화 중...' : '비밀번호 초기화'}
                  </span>
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
