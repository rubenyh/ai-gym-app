// API-level isolation for M3-M6 (NFR-04): sync RPCs, rewards, coach and social through PostgREST/Storage,
// the same paths a modified client would use. Local stack only.
//
//   set -a; eval "$(supabase status -o env)"; set +a; node --test supabase/tests/api/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

const require = createRequire(new URL('../../../app/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = process.env;
if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error('Export local keys first: set -a; eval "$(supabase status -o env)"; set +a');
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(API_URL)) {
  throw new Error('Refusing to run against a non-local Supabase URL');
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(API_URL, SERVICE_ROLE_KEY, opts);
const run = Date.now().toString(36);
const users = {};
const uuid = () => crypto.randomUUID();
const ids = { session: uuid(), routine: uuid(), post: uuid() };

async function signedInClient(label, visibility) {
  const email = `${label}-tsc-${run}@test.local`;
  const password = `pw-${run}-${label}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(API_URL, ANON_KEY, opts);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const onboard = await client.rpc('complete_onboarding', {
    p_handle: `${label}_${run}`, p_display_name: label, p_weight_unit: 'kg', p_length_unit: 'cm',
    p_timezone: 'UTC', p_target_days: 3,
  });
  if (onboard.error) throw onboard.error;
  if (visibility === 'public') {
    const vis = await client.from('profiles').update({ visibility: 'public' }).eq('id', data.user.id);
    if (vis.error) throw vis.error;
  }
  return { id: data.user.id, handle: `${label}_${run}`, client };
}

async function push(client, op) {
  const { data, error } = await client.rpc('sync_push', { p_op: { opId: uuid(), baseRevision: null, ...op } });
  assert.equal(error, null);
  return data;
}

const now = new Date().toISOString();
const sessionDoc = {
  id: ids.session, routineId: null, name: 'API session', status: 'completed', startedAt: now, completedAt: now,
  timezone: 'UTC', localDate: now.slice(0, 10), notes: 'private notes', exercises: [{
    id: uuid(), position: 0, exerciseKey: 'catalog:0025', exerciseName: 'Bench', notes: '', restSeconds: 90,
    sets: [{ id: uuid(), position: 0, targetReps: 8, targetLoadGrams: 60000, reps: 8, loadGrams: 60000,
      loadMode: 'external', completed: true, completedAt: now }],
  }],
};

before(async () => {
  users.a = await signedInClient('a', 'private');
  users.b = await signedInClient('b', 'private');
  const s = await push(users.a.client, { aggregateType: 'session', aggregateId: ids.session, action: 'upsert', doc: sessionDoc });
  if (s.status !== 'applied') throw new Error(JSON.stringify(s));
  const r = await push(users.a.client, {
    aggregateType: 'routine', aggregateId: ids.routine, action: 'upsert',
    doc: { id: ids.routine, name: 'R', notes: '', archived: false, origin: 'manual', exercises: [] },
  });
  if (r.status !== 'applied') throw new Error(JSON.stringify(r));
});

after(async () => {
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

test('get_reward_rules() deep-equals app/src/domain/reward-rules.v1.json', async () => {
  const file = JSON.parse(readFileSync(new URL('../../../app/src/domain/reward-rules.v1.json', import.meta.url), 'utf8'));
  const { data, error } = await users.a.client.rpc('get_reward_rules');
  assert.equal(error, null);
  assert.deepEqual(data, file);
});

test('training rows are owner-only and not writable through REST', async () => {
  for (const table of ['sessions', 'routines', 'programs', 'custom_exercises', 'server_change_log', 'reward_events']) {
    const { data, error } = await users.b.client.from(table).select('*');
    assert.equal(error, null, table);
    assert.deepEqual(data, [], `${table} leaked to B`);
  }
  const ins = await users.a.client.from('sessions').insert({ id: uuid(), revision: 1, name: 'x', status: 'active',
    started_at: now, timezone: 'UTC', doc: {} });
  assert.equal(ins.error?.code, '42501');
  const upd = await users.a.client.from('sessions').update({ revision: 99 }).eq('id', ids.session).select();
  assert.ok(upd.error || upd.data.length === 0, 'direct update succeeded');
  const receipts = await users.a.client.from('operation_receipts').select('*');
  assert.ok(receipts.error, 'operation receipts readable');
});

test('B cannot overwrite A aggregate and pulls nothing of A', async () => {
  const res = await push(users.b.client, {
    aggregateType: 'session', aggregateId: ids.session, action: 'upsert', baseRevision: 1, doc: sessionDoc,
  });
  assert.equal(res.status, 'rejected');
  assert.equal(res.code, 'forbidden');
  const pull = await users.b.client.rpc('sync_pull', { p_after: 0, p_limit: 100 });
  assert.deepEqual(pull.data.changes, []);
  const own = await users.a.client.rpc('sync_pull', { p_after: 0, p_limit: 100 });
  assert.ok(own.data.changes.some((c) => c.aggregateId === ids.session));
});

test('rewards: summary is per account; anon cannot call sync RPCs', async () => {
  const a = await users.a.client.rpc('get_reward_summary');
  assert.equal(a.data.totalXp, 100);
  assert.deepEqual(a.data.awardedSessionIds, [ids.session]);
  const b = await users.b.client.rpc('get_reward_summary');
  assert.equal(b.data.totalXp, 0);
  const anon = createClient(API_URL, ANON_KEY, opts);
  const res = await anon.rpc('sync_push', { p_op: { opId: uuid() } });
  assert.ok(res.error, 'anon executed sync_push');
});

test('coach drafts are owner-only', async () => {
  const req = await users.a.client.rpc('coach_begin_request', {
    p_request_id: uuid(), p_mode: 'create', p_program_id: null, p_base_revision: null, p_input: { preferencesText: 'back' },
  });
  assert.equal(req.error, null);
  const draftId = req.data.draft.draftId;
  const read = await users.b.client.from('coach_drafts').select('*').eq('id', draftId);
  assert.deepEqual(read.data, []);
  const save = await users.b.client.rpc('coach_save_draft', {
    p_draft_id: draftId, p_status: 'failed', p_content: null, p_clarification: null,
    p_error: { code: 'x', message: 'y', retryable: false }, p_model: 'm',
  });
  assert.ok(save.error, 'B saved A draft');
  const ctx = await users.b.client.rpc('coach_get_context');
  assert.equal(ctx.data.recentSessions.length, 0, 'B context leaked A sessions');
});

test('social: private author post, photo and follow flow', async () => {
  const path = `${users.a.id}/${ids.post}.png`;
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const up = await users.a.client.storage.from('post-photos').upload(path, png, { contentType: 'image/png' });
  assert.equal(up.error, null);
  const pub = await users.a.client.rpc('publish_post', {
    p_post_id: ids.post, p_session_id: ids.session, p_caption: 'hi', p_photo_path: path,
  });
  assert.equal(pub.error, null);
  assert.equal(JSON.stringify(pub.data.snapshot).includes('private notes'), false);
  const again = await users.a.client.rpc('publish_post', {
    p_post_id: ids.post, p_session_id: ids.session, p_caption: 'other', p_photo_path: null,
  });
  assert.equal(again.data.caption, 'hi');

  // B: no access before follow is accepted
  assert.deepEqual((await users.b.client.from('posts').select('id')).data, []);
  const signedBefore = await users.b.client.storage.from('post-photos').createSignedUrl(path, 60);
  assert.ok(signedBefore.error, 'B signed A private photo');
  const like = await users.b.client.from('likes').insert({ post_id: ids.post });
  assert.ok(like.error, 'B liked inaccessible post');
  const card = await users.b.client.rpc('get_profile_card', { p_handle: users.a.handle });
  assert.deepEqual(Object.keys(card.data).sort(),
    ['avatarPath', 'displayName', 'followStatus', 'handle', 'id', 'postCount', 'visibility']);
  assert.equal((await users.b.client.rpc('follow_user', { p_target: users.a.id })).data, 'pending');
  assert.deepEqual((await users.b.client.from('posts').select('id')).data, []);

  await users.a.client.rpc('respond_follow_request', { p_requester: users.b.id, p_accept: true });
  const feed = await users.b.client.rpc('get_feed', { p_before: null, p_limit: 20 });
  assert.equal(feed.data.length, 1);
  const signed = await users.b.client.storage.from('post-photos').createSignedUrl(path, 60);
  assert.equal(signed.error, null);

  // block removes access again
  await users.a.client.rpc('block_user', { p_target: users.b.id });
  assert.deepEqual((await users.b.client.from('posts').select('id')).data, []);
  const signedAfter = await users.b.client.storage.from('post-photos').createSignedUrl(path, 60);
  assert.ok(signedAfter.error, 'blocked user signed photo');
  await users.a.client.storage.from('post-photos').remove([path]);
});
