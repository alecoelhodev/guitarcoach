import http from 'k6/http';
import { AUTH_BASE, TEST_USER_EMAIL, TEST_USER_PASSWORD, TEST_USER_NAME } from './config.js';

const JSON_CONTENT_TYPE = { 'Content-Type': 'application/json' };

// Tagged distinctly from the create/list/get workflow tags so a sign-in
// probe that's *expected* to fail on a brand-new test user (before the
// sign-up fallback below) never counts toward the practice-sessions
// thresholds in config.js — see buildThresholds()'s comment.
export function signIn(email, password) {
  const res = http.post(`${AUTH_BASE}/sign-in/email`, JSON.stringify({ email, password }), {
    headers: JSON_CONTENT_TYPE,
    tags: { name: 'auth_sign_in' },
  });
  return { ok: res.status === 200, res };
}

export function signUp(email, password, name) {
  const res = http.post(`${AUTH_BASE}/sign-up/email`, JSON.stringify({ email, password, name }), {
    headers: JSON_CONTENT_TYPE,
    tags: { name: 'auth_sign_up' },
  });
  return { ok: res.status === 200, res };
}

// Better Auth prefixes the session cookie name with `__Secure-` when the
// request is served over HTTPS (any deployed target) but not over plain
// HTTP (local dev) — check both rather than assuming one.
const SESSION_COOKIE_NAMES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

export function extractSessionCookie(res) {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = res.cookies[name]?.[0]?.value;
    if (value) {
      return { name, value };
    }
  }
  throw new Error(
    `Auth response returned ${res.status} but no session cookie (checked: ${SESSION_COOKIE_NAMES.join(', ')}) ` +
      `was set (body: ${res.body?.slice(0, 200)}).`,
  );
}

// Runs once in setup() — never per-VU/iteration, since /sign-in/email and
// /sign-up/email are rate-limited (5/60s and 3/60s per IP+path). Sign-in
// first so the SAME script works unchanged on a fresh environment (sign-up
// creates the dedicated test user) and on every subsequent run (sign-in
// succeeds immediately, no repeat sign-up).
export function provisionSession() {
  const signInAttempt = signIn(TEST_USER_EMAIL, TEST_USER_PASSWORD);
  if (signInAttempt.ok) {
    const { name, value } = extractSessionCookie(signInAttempt.res);
    return { cookieHeader: `${name}=${value}` };
  }

  const signUpAttempt = signUp(TEST_USER_EMAIL, TEST_USER_PASSWORD, TEST_USER_NAME);
  if (signUpAttempt.ok) {
    const { name, value } = extractSessionCookie(signUpAttempt.res);
    return { cookieHeader: `${name}=${value}` };
  }

  throw new Error(
    `Could not authenticate as the k6 test user: sign-in returned ${signInAttempt.res.status}, ` +
      `sign-up returned ${signUpAttempt.res.status}. Check K6_TEST_USER_EMAIL/K6_TEST_USER_PASSWORD, ` +
      'or the auth rate limits (5 sign-ins/60s, 3 sign-ups/60s per IP) may already be exhausted from ' +
      'rapid repeated runs.',
  );
}
