// Keyset pagination regression (review 2026-11-25): feed posts and comments sharing one timestamp must
// page without duplicates or omissions. Uses the same cursor/filter shapes as app/src/features/community/api.ts.
//
//   set -a; eval "$(supabase status -o env)"; set +a; node --test supabase/tests/api/*.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

const require = createRequire(new URL('../../../app/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = process.env;
if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('Export local keys first (supabase status -o env)');
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(API_URL)) throw new Error('Refusing to run against a non-local Supabase URL');

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(API_URL, SERVICE_ROLE_KEY, opts);
const run = Date.now().toString(36);
const uuid = () => crypto.randomUUID();
let user;

before(async () => {
  const email = `page-${run}@test.local`;
  const password = `pw-${run}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(API_URL, ANON_KEY, opts);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const onboard = await client.rpc('complete_onboarding', {
    p_handle: `page_${run}`, p_display_name: 'Pager', p_weight_unit: 'kg', p_length_unit: 'cm', p_timezone: 'UTC', p_target_days: 3,
  });
  if (onboard.error) throw onboard.error;
  user = { id: data.user.id, client };

  // One real publication (server-built snapshot), then clones with identical timestamps (test fixture only).
  const now = new Date().toISOString();
  const sessionId = uuid();
  const push = await client.rpc('sync_push', { p_op: { opId: uuid(), aggregateType: 'session', aggregateId: sessionId, action: 'upsert', baseRevision: null, doc: {
    id: sessionId, routineId: null, name: 'Tie', status: 'completed', startedAt: now, completedAt: now, timezone: 'UTC',
    localDate: now.slice(0, 10), notes: '', exercises: [{ id: uuid(), position: 0, exerciseKey: 'catalog:0025', exerciseName: 'Bench', notes: '', restSeconds: null,
      sets: [{ id: uuid(), position: 0, targetReps: null, targetLoadGrams: null, reps: 5, loadGrams: 50000, loadMode: 'external', completed: true, completedAt: now }] }],
  } } });
  assert.equal(push.data?.status, 'applied', JSON.stringify(push));
  const firstPost = uuid();
  const pub = await client.rpc('publish_post', { p_post_id: firstPost, p_session_id: sessionId, p_caption: null, p_photo_path: null });
  assert.equal(pub.error, null);
  const { data: original } = await admin.from('posts').select('*').eq('id', firstPost).single();
  const tie = '2026-11-20T12:00:00+00:00';
  const clones = Array.from({ length: 4 }, () => ({ ...original, id: uuid(), published_at: tie }));
  assert.equal((await admin.from('posts').insert(clones)).error, null);
  assert.equal((await admin.from('posts').update({ published_at: tie }).eq('id', firstPost)).error, null);
  const comments = Array.from({ length: 5 }, (_, i) => ({ id: uuid(), post_id: firstPost, author_id: user.id, body: `c${i}`, created_at: tie }));
  assert.equal((await admin.from('comments').insert(comments)).error, null);
  user.postId = firstPost;
});

after(async () => {
  if (user) await admin.auth.admin.deleteUser(user.id);
});

test('feed pages through equal published_at without duplicates or omissions', async () => {
  const seen = [];
  let cursor = null;
  for (let i = 0; i < 10; i++) {
    const { data, error } = await user.client.rpc('get_feed', { p_before: cursor?.at ?? null, p_before_id: cursor?.id ?? null, p_limit: 2 });
    assert.equal(error, null);
    if (data.length === 0) break;
    seen.push(...data.map((p) => p.postId));
    const last = data[data.length - 1];
    cursor = { at: last.publishedAt, id: last.postId };
  }
  assert.equal(seen.length, 5);
  assert.equal(new Set(seen).size, 5);
});

test('comments page through equal created_at without duplicates or omissions', async () => {
  const seen = [];
  let cursor = null;
  for (let i = 0; i < 10; i++) {
    let q = user.client.from('comments').select('id, created_at').eq('post_id', user.postId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(2);
    if (cursor) q = q.or(`created_at.lt."${cursor.at}",and(created_at.eq."${cursor.at}",id.lt.${cursor.id})`);
    const { data, error } = await q;
    assert.equal(error, null);
    if (data.length === 0) break;
    seen.push(...data.map((c) => c.id));
    const last = data[data.length - 1];
    cursor = { at: last.created_at, id: last.id };
  }
  assert.equal(seen.length, 5);
  assert.equal(new Set(seen).size, 5);
});
