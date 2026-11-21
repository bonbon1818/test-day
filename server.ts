import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(__dirname, '.data');
const AUTH_STATE_FILE = path.join(DATA_DIR, 'admin-auth.json');
const SESSION_STORE_FILE = path.join(DATA_DIR, 'admin-sessions.json');
const SESSION_COOKIE_NAME = 'admin_session';
const SECURITY_QUESTION = '아버지 이름이 무엇인가요?';
const RECOVERY_REQUIRED_FAILURES = 5;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RECOVERY_TOKEN_TTL_MS = 5 * 60 * 1000;

const DEFAULT_RECOVERY_SALT = '110c6ed4e1f280c45eca35a5ca3dbd6b';
const DEFAULT_RECOVERY_HASH =
  '8262b844846a00fbe986de23577e19ec12ca6b41a5c27ffda4efac2c64cb69600daba61ccf9e6da5cfe82c42773bc316603dcf509442a905dbbe3e842eb43aae';

interface StoredAuthState {
  pinSalt: string | null;
  pinHash: string | null;
  failedAttempts: number;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadAuthState(): StoredAuthState {
  try {
    if (fs.existsSync(AUTH_STATE_FILE)) {
      const raw = fs.readFileSync(AUTH_STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoredAuthState>;
      return {
        pinSalt: typeof parsed.pinSalt === 'string' ? parsed.pinSalt : null,
        pinHash: typeof parsed.pinHash === 'string' ? parsed.pinHash : null,
        failedAttempts:
          typeof parsed.failedAttempts === 'number' && parsed.failedAttempts >= 0
            ? Math.min(
                RECOVERY_REQUIRED_FAILURES,
                Math.floor(parsed.failedAttempts)
              )
            : 0,
      };
    }
  } catch {
    // 손상된 상태 파일은 초기화합니다.
  }
  return { pinSalt: null, pinHash: null, failedAttempts: 0 };
}

function saveAuthState(state: StoredAuthState): void {
  ensureDataDir();
  fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function loadSessionHashes(): Map<string, number> {
  const map = new Map<string, number>();
  try {
    if (fs.existsSync(SESSION_STORE_FILE)) {
      const raw = fs.readFileSync(SESSION_STORE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const now = Date.now();
      for (const [tokenHash, expiresAt] of Object.entries(parsed)) {
        if (typeof expiresAt === 'number' && expiresAt > now) {
          map.set(tokenHash, expiresAt);
        }
      }
    }
  } catch {
    // 손상된 세션 파일은 빈 상태로 시작합니다.
  }
  return map;
}

function saveSessionHashes(map: Map<string, number>): void {
  ensureDataDir();
  const obj: Record<string, number> = {};
  for (const [tokenHash, expiresAt] of map.entries()) {
    obj[tokenHash] = expiresAt;
  }
  fs.writeFileSync(SESSION_STORE_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

let authState: StoredAuthState = loadAuthState();

// 디스크에는 원문 토큰 대신 SHA-256 해시만 저장합니다.
const sessionHashes = loadSessionHashes();
const recoveryTokens = new Map<string, number>();

function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isFourDigitPin(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}$/.test(value);
}

function getEnvPin(): string | null {
  const raw = process.env.ADMIN_PIN?.trim() ?? '';
  return isFourDigitPin(raw) ? raw : null;
}

function hashSecret(secret: string, salt: string): string {
  return crypto.scryptSync(secret, salt, 64).toString('hex');
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyPin(candidate: string): boolean {
  if (!isFourDigitPin(candidate)) return false;

  const envPin = getEnvPin();
  if (envPin !== null) {
    return timingSafeStringEqual(candidate, envPin);
  }

  if (!authState.pinSalt || !authState.pinHash) {
    return false;
  }

  const candidateHashHex = hashSecret(candidate, authState.pinSalt);
  const storedBuf = Buffer.from(authState.pinHash, 'hex');
  const candidateBuf = Buffer.from(candidateHashHex, 'hex');
  if (storedBuf.length !== candidateBuf.length) return false;
  return crypto.timingSafeEqual(storedBuf, candidateBuf);
}

function verifyRecoveryAnswer(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return false;

  const envAnswer = process.env.ADMIN_RECOVERY_ANSWER?.trim() ?? '';
  if (envAnswer.length > 0) {
    return timingSafeStringEqual(trimmed, envAnswer);
  }

  const candidateHashHex = hashSecret(trimmed, DEFAULT_RECOVERY_SALT);
  const storedBuf = Buffer.from(DEFAULT_RECOVERY_HASH, 'hex');
  const candidateBuf = Buffer.from(candidateHashHex, 'hex');
  if (storedBuf.length !== candidateBuf.length) return false;
  return crypto.timingSafeEqual(storedBuf, candidateBuf);
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(rawValue);
    } catch {
      result[key] = rawValue;
    }
  }
  return result;
}

function extractAuthToken(req: Request): {
  token: string | null;
  viaCookie: boolean;
} {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const bearer = header.slice('Bearer '.length).trim();
    if (bearer.length > 0) {
      return { token: bearer, viaCookie: false };
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken && cookieToken.length > 0) {
    return { token: cookieToken, viaCookie: true };
  }

  return { token: null, viaCookie: false };
}

function verifySameOriginOrCsrfHeader(req: Request): boolean {
  if (req.headers['x-requested-with'] === 'fetch') {
    return true;
  }
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '')
    .toString()
    .split(',')[0]
    .trim();
  if (origin && host) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

function isValidSessionToken(token: string | null): boolean {
  if (!token) return false;
  const tokenHash = hashSessionToken(token);
  const expiresAt = sessionHashes.get(tokenHash);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    sessionHashes.delete(tokenHash);
    saveSessionHashes(sessionHashes);
    return false;
  }
  return true;
}

function createSessionToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessionHashes.set(hashSessionToken(token), Date.now() + SESSION_TTL_MS);
  saveSessionHashes(sessionHashes);
  return token;
}

function deleteSessionToken(token: string | null): void {
  if (!token) return;
  const tokenHash = hashSessionToken(token);
  if (sessionHashes.delete(tokenHash)) {
    saveSessionHashes(sessionHashes);
  }
}

function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
  if (proto.split(',')[0].trim() === 'https') return true;
  const origin = String(req.headers.origin ?? '').toLowerCase();
  if (origin.startsWith('https://')) return true;
  const referer = String(req.headers.referer ?? '').toLowerCase();
  if (referer.startsWith('https://')) return true;
  return false;
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    partitioned: isHttps,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = isHttpsRequest(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    partitioned: isHttps,
    path: '/',
  });
}

function isSetupRequired(): boolean {
  return getEnvPin() === null && (!authState.pinSalt || !authState.pinHash);
}

function purgeExpiredTokens(): void {
  const now = Date.now();
  let changed = false;
  for (const [tokenHash, expiresAt] of sessionHashes.entries()) {
    if (now > expiresAt) {
      sessionHashes.delete(tokenHash);
      changed = true;
    }
  }
  if (changed) {
    saveSessionHashes(sessionHashes);
  }
  for (const [token, expiresAt] of recoveryTokens.entries()) {
    if (now > expiresAt) recoveryTokens.delete(token);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/admin/status', (req: Request, res: Response) => {
    purgeExpiredTokens();
    const { token } = extractAuthToken(req);
    const unlocked = isValidSessionToken(token);
    const envLocked = getEnvPin() !== null;
    res.json({
      setupRequired: isSetupRequired(),
      envLocked,
      unlocked,
      failedAttempts: authState.failedAttempts,
      canAttemptRecovery:
        !envLocked && authState.failedAttempts >= RECOVERY_REQUIRED_FAILURES,
      securityQuestion: SECURITY_QUESTION,
    });
  });

  app.post('/api/admin/setup', (req: Request, res: Response) => {
    purgeExpiredTokens();
    if (!isSetupRequired()) {
      res.status(409).json({
        ok: false,
        error: '이미 관리자 비밀번호가 설정되어 있습니다.',
      });
      return;
    }

    const { pin } = (req.body ?? {}) as { pin?: unknown };
    if (!isFourDigitPin(pin)) {
      res.status(400).json({
        ok: false,
        error: '비밀번호는 4자리 숫자(0~9)로만 입력해 주세요.',
      });
      return;
    }

    const pinSalt = crypto.randomBytes(16).toString('hex');
    const pinHash = hashSecret(pin, pinSalt);
    authState = {
      pinSalt,
      pinHash,
      failedAttempts: 0,
    };
    saveAuthState(authState);

    const token = createSessionToken();
    setSessionCookie(req, res, token);

    res.json({
      ok: true,
      token,
      setupRequired: false,
      unlocked: true,
      failedAttempts: 0,
    });
  });

  app.post('/api/admin/skip', (req: Request, res: Response) => {
    purgeExpiredTokens();
    if (!isSetupRequired()) {
      res.status(403).json({
        ok: false,
        error: '이미 비밀번호가 설정되어 있어 건너뛸 수 없습니다.',
      });
      return;
    }

    const token = createSessionToken();
    setSessionCookie(req, res, token);

    res.json({
      ok: true,
      token,
      setupRequired: true,
      unlocked: true,
      failedAttempts: 0,
    });
  });

  app.post('/api/admin/login', (req: Request, res: Response) => {
    purgeExpiredTokens();
    if (isSetupRequired()) {
      res.status(400).json({
        ok: false,
        error: '먼저 초기 4자리 숫자 비밀번호를 설정해 주세요.',
        setupRequired: true,
      });
      return;
    }

    const { pin } = (req.body ?? {}) as { pin?: unknown };
    if (!isFourDigitPin(pin)) {
      res.status(400).json({
        ok: false,
        error: '비밀번호는 4자리 숫자(0~9)만 입력할 수 있습니다.',
        failedAttempts: authState.failedAttempts,
        canAttemptRecovery:
          getEnvPin() === null &&
          authState.failedAttempts >= RECOVERY_REQUIRED_FAILURES,
      });
      return;
    }

    if (verifyPin(pin)) {
      authState = { ...authState, failedAttempts: 0 };
      saveAuthState(authState);
      const token = createSessionToken();
      setSessionCookie(req, res, token);

      res.json({
        ok: true,
        token,
        unlocked: true,
        failedAttempts: 0,
      });
      return;
    }

    const nextFailures = Math.min(
      RECOVERY_REQUIRED_FAILURES,
      authState.failedAttempts + 1
    );
    authState = { ...authState, failedAttempts: nextFailures };
    saveAuthState(authState);

    const canRecover =
      getEnvPin() === null && nextFailures >= RECOVERY_REQUIRED_FAILURES;
    res.status(401).json({
      ok: false,
      error: canRecover
        ? '비밀번호가 맞지 않습니다. (5/5회) 아래 질문에 답해 초기화하거나 다시 입력해 보세요.'
        : `비밀번호가 맞지 않습니다. (${nextFailures}/5회)`,
      failedAttempts: nextFailures,
      canAttemptRecovery: canRecover,
    });
  });

  app.post('/api/admin/verify-recovery', (req: Request, res: Response) => {
    purgeExpiredTokens();
    if (getEnvPin() !== null) {
      res.status(403).json({
        ok: false,
        verified: false,
        error: '환경 변수로 잠긴 비밀번호는 이곳에서 초기화할 수 없습니다.',
      });
      return;
    }

    if (authState.failedAttempts < RECOVERY_REQUIRED_FAILURES) {
      res.status(403).json({
        ok: false,
        verified: false,
        error: '비밀번호를 5번 이상 틀린 뒤에만 초기화 질문을 확인할 수 있습니다.',
      });
      return;
    }

    const { answer } = (req.body ?? {}) as { answer?: unknown };
    if (typeof answer !== 'string' || !verifyRecoveryAnswer(answer)) {
      res.json({
        ok: false,
        verified: false,
        error: '답변이 일치하지 않습니다.',
      });
      return;
    }

    const recoveryToken = crypto.randomBytes(24).toString('hex');
    recoveryTokens.set(recoveryToken, Date.now() + RECOVERY_TOKEN_TTL_MS);

    res.json({
      ok: true,
      verified: true,
      recoveryToken,
    });
  });

  app.post('/api/admin/reset', (req: Request, res: Response) => {
    purgeExpiredTokens();
    if (getEnvPin() !== null) {
      res.status(403).json({
        ok: false,
        error: '환경 변수로 잠긴 비밀번호는 초기화할 수 없습니다.',
      });
      return;
    }

    if (authState.failedAttempts < RECOVERY_REQUIRED_FAILURES) {
      res.status(403).json({
        ok: false,
        error: '비밀번호를 5번 이상 틀린 뒤에만 초기화할 수 있습니다.',
      });
      return;
    }

    const { recoveryToken } = (req.body ?? {}) as { recoveryToken?: unknown };
    if (typeof recoveryToken !== 'string') {
      res.status(403).json({
        ok: false,
        error: '먼저 보안 질문의 답을 맞혀 주세요.',
      });
      return;
    }

    const expiresAt = recoveryTokens.get(recoveryToken);
    if (!expiresAt || Date.now() > expiresAt) {
      recoveryTokens.delete(recoveryToken);
      res.status(403).json({
        ok: false,
        error: '초기화 인증이 만료되었거나 올바르지 않습니다. 질문에 다시 답해 주세요.',
      });
      return;
    }

    recoveryTokens.delete(recoveryToken);
    sessionHashes.clear();
    saveSessionHashes(sessionHashes);
    clearSessionCookie(req, res);
    authState = {
      pinSalt: null,
      pinHash: null,
      failedAttempts: 0,
    };
    saveAuthState(authState);

    res.json({
      ok: true,
      setupRequired: true,
      unlocked: false,
      failedAttempts: 0,
    });
  });

  app.post('/api/admin/change-pin', (req: Request, res: Response) => {
    purgeExpiredTokens();
    const { token, viaCookie } = extractAuthToken(req);
    if (viaCookie && !verifySameOriginOrCsrfHeader(req)) {
      res.status(403).json({
        ok: false,
        error: '보안 확인에 실패했습니다. 페이지를 새로고침 후 다시 시도해 주세요.',
      });
      return;
    }
    if (!isValidSessionToken(token)) {
      res.status(401).json({
        ok: false,
        error: '관리자 인증이 만료되었습니다. 다시 로그인해 주세요.',
      });
      return;
    }

    if (getEnvPin() !== null) {
      res.status(403).json({
        ok: false,
        error: '환경 변수로 지정된 비밀번호는 앱 안에서 바꿀 수 없습니다.',
      });
      return;
    }

    const { currentPin, newPin } = (req.body ?? {}) as {
      currentPin?: unknown;
      newPin?: unknown;
    };

    if (!isFourDigitPin(currentPin) || !isFourDigitPin(newPin)) {
      res.status(400).json({
        ok: false,
        error: '현재 비밀번호와 새 비밀번호 모두 4자리 숫자로 입력해 주세요.',
      });
      return;
    }

    if (!verifyPin(currentPin)) {
      res.status(401).json({
        ok: false,
        error: '현재 비밀번호가 맞지 않습니다.',
      });
      return;
    }

    const pinSalt = crypto.randomBytes(16).toString('hex');
    const pinHash = hashSecret(newPin, pinSalt);
    authState = {
      pinSalt,
      pinHash,
      failedAttempts: 0,
    };
    saveAuthState(authState);

    res.json({ ok: true });
  });

  app.post('/api/admin/logout', (req: Request, res: Response) => {
    const { token, viaCookie } = extractAuthToken(req);
    if (viaCookie && !verifySameOriginOrCsrfHeader(req)) {
      res.status(403).json({
        ok: false,
        error: '보안 확인에 실패했습니다.',
      });
      return;
    }
    deleteSessionToken(token);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
