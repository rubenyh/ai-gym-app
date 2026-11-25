import {
  coachDraftResponse,
  type CoachDraftRequest,
  type CoachDraftResponse,
} from '@/domain/contracts';
import { supabase } from '@/services/supabase/client';

/** Coach API (services/coach-api). Sends only the user's Supabase access token; never any secret. */

export class CoachApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'CoachApiError';
  }
}

// Server budget is 90 s (D-04); give the HTTP call a little more before giving up locally.
const REQUEST_TIMEOUT_MS = 100_000;

export function coachApiUrl(): string | null {
  const url = process.env.EXPO_PUBLIC_COACH_API_URL?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

async function call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<CoachDraftResponse> {
  const base = coachApiUrl();
  if (!base) {
    throw new CoachApiError(
      'coach_unavailable',
      'The coach is not configured in this build (EXPO_PUBLIC_COACH_API_URL is missing). Routines work without it.',
      false,
    );
  }
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw new CoachApiError('unauthorized', 'Sign in again to use the coach.', false, 401);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch {
    throw new CoachApiError('network', 'Could not reach the coach. Check your connection and try again.', true);
  } finally {
    clearTimeout(timer);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (json ?? {}) as { code?: string; message?: string; retryable?: boolean };
    throw new CoachApiError(e.code ?? 'error', e.message ?? `Coach request failed (${res.status}).`, e.retryable ?? res.status >= 500, res.status);
  }
  const parsed = coachDraftResponse.safeParse(json);
  if (!parsed.success) throw new CoachApiError('bad_response', 'The coach sent an unexpected response.', true, res.status);
  return parsed.data;
}

export const coachClient = {
  createDraft: (request: CoachDraftRequest) => call('/v1/coach/drafts', { method: 'POST', body: request }),
  getDraft: (draftId: string) => call(`/v1/coach/drafts/${encodeURIComponent(draftId)}`, { method: 'GET' }),
  cancelDraft: (draftId: string) => call(`/v1/coach/drafts/${encodeURIComponent(draftId)}/cancel`, { method: 'POST' }),
};
