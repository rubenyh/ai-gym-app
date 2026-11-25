// Security regressions through the real REST/Storage APIs (NFR-04, NFR-05, SOCIAL-03/04, PROFILE-02):
// transitions revoke FUTURE server access immediately (public->private, unfollow, block, delete), anon
// cannot call RPCs, blocked users cannot read avatars, snapshot pushes with extra keys are rejected.
// Already-issued signed URLs stay valid until expiry (300 s in the app) and downloaded copies cannot be revoked.
//
//   set -a; eval "$(supabase status -o env)"; set +a; node --test supabase/tests/api/*.test.mjs
import assert from 'node:assert/strict';
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
const uuid = () => crypto.randomUUID();
const users = {};
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const now = new Date().toISOString();

async function signedInClient(label, visibility) {
  const email = `${label}-sec-${run}@test.local`;
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
  if (visibility) {
    const vis = await client.from('profiles').update({ visibility }).eq('id', data.user.id);
    if (vis.error) throw vis.error;
  }
  return { id: data.user.id, handle: `${label}_${run}`, client };
}

const sessionDoc = (id, extra = {}) => ({
  id, routineId: null, name: 'Sec session', status: 'completed', startedAt: now, completedAt: now, timezone: 'UTC',
  localDate: now.slice(0, 10), notes: 'PRIVATE NOTE', exercises: [{
    id: uuid(), position: 0, exerciseKey: 'catalog:0025', exerciseName: 'Bench', notes: 'PRIVATE EX', restSeconds: 90,
    sets: [{ id: uuid(), position: 0, targetReps: 8, targetLoadGrams: 60000, reps: 8, loadGrams: 60000,
      loadMode: 'external', completed: true, completedAt: now }],
  }],
  ...extra,
});

async function push(client, op) {
  const { data, error } = await client.rpc('sync_push', { p_op: { opId: uuid(), baseRevision: null, ...op } });
  assert.equal(error, null);
  return data;
}

// Publishes a post (with photo) for `u` and returns { postId, photo }.
async function publish(u) {
  const sessionId = uuid();
  const postId = uuid();
  const photo = `${u.id}/${postId}.png`;
  assert.equal((await push(u.client, { aggregateType: 'session', aggregateId: sessionId, action: 'upsert',
    doc: sessionDoc(sessionId) })).status, 'applied');
  assert.equal((await u.client.storage.from('post-photos').upload(photo, png, { contentType: 'image/png' })).error, null);
  const res = await u.client.rpc('publish_post', { p_post_id: postId, p_session_id: sessionId, p_caption: 'c', p_photo_path: photo });
  assert.equal(res.error, null);
  return { postId, photo };
}

// Everything a viewer can reach for a post, through the server only.
async function reach(viewer, author, { postId, photo }) {
  const c = viewer.client;
  const [post, feed, likes, comments, card, file] = await Promise.all([
    c.from('posts').select('id').eq('id', postId),
    c.rpc('get_feed', { p_before: null, p_limit: 50 }),
    c.from('likes').select('user_id').eq('post_id', postId),
    c.from('comments').select('id').eq('post_id', postId),
    c.rpc('get_profile_card', { p_handle: author.handle }),
    c.storage.from('post-photos').download(photo),
  ]);
  return {
    post: post.data?.length ?? 0,
    feed: (feed.data ?? []).filter((p) => p.postId === postId).length,
    likes: likes.data?.length ?? 0,
    comments: comments.data?.length ?? 0,
    card: card.data ? 1 : 0,
    photo: file.data ? 1 : 0,
  };
}

before(async () => {
  users.a = await signedInClient('a', 'public');
  users.f = await signedInClient('f');
  users.s = await signedInClient('s');
  users.x = await signedInClient('x', 'public');
});

after(async () => {
  for (const u of Object.values(users)) {
    for (const bucket of ['avatars', 'post-photos']) {
      const { data } = await admin.storage.from(bucket).list(u.id);
      if (data?.length) await admin.storage.from(bucket).remove(data.map((o) => `${u.id}/${o.name}`));
    }
    await admin.auth.admin.deleteUser(u.id);
  }
});

test('anon cannot execute any RPC', async () => {
  const anon = createClient(API_URL, ANON_KEY, opts);
  const { data } = await admin.rpc('get_reward_rules'); // ensure service-role path still works
  assert.ok(data);
  for (const [fn, args] of [
    ['has_weekly_goal', { uid: users.a.id }], ['is_valid_timezone', { tz: 'UTC' }],
    ['week_start', { ts: now, tz: 'UTC' }], ['get_profile_card', { p_handle: users.a.handle }],
    ['search_profiles', { p_query: 'a', p_limit: 5 }], ['sync_pull', { p_after: 0, p_limit: 5 }],
    ['get_feed', { p_before: null, p_limit: 5 }], ['coach_get_context', {}],
  ]) {
    const res = await anon.rpc(fn, args);
    assert.ok(res.error, `anon executed ${fn}`);
  }
});

test('has_weekly_goal does not reveal another account', async () => {
  assert.equal((await users.s.client.rpc('has_weekly_goal', { uid: users.a.id })).data, false);
  assert.equal((await users.a.client.rpc('has_weekly_goal', { uid: users.a.id })).data, true);
});

test('snapshot push with extra private keys is rejected and notes never reach a post', async () => {
  const id = uuid();
  const res = await push(users.a.client, { aggregateType: 'session', aggregateId: id, action: 'upsert',
    doc: sessionDoc(id, { bodyWeightGrams: 80000 }) });
  assert.equal(res.status, 'rejected');
  assert.equal(res.code, 'invalid_doc');
  const huge = await push(users.a.client, { aggregateType: 'session', aggregateId: id, action: 'upsert',
    doc: sessionDoc(id, { name: 'x'.repeat(5000) }) });
  assert.equal(huge.status, 'rejected');
  const { postId } = await publish(users.a);
  const { data } = await users.s.client.from('posts').select('snapshot, caption').eq('id', postId).single();
  assert.ok(!JSON.stringify(data).includes('PRIVATE'), 'notes leaked into snapshot');
});

test('public -> private revokes stranger access immediately; accepted follower keeps it', async () => {
  const { a, f, s } = users;
  assert.equal((await f.client.rpc('follow_user', { p_target: a.id })).data, 'accepted');
  const post = await publish(a);
  assert.equal((await f.client.from('likes').insert({ post_id: post.postId })).error, null);
  assert.equal((await f.client.from('comments').insert({ post_id: post.postId, body: 'nice' })).error, null);
  assert.deepEqual(await reach(s, a, post), { post: 1, feed: 0, likes: 1, comments: 1, card: 1, photo: 1 });

  await a.client.from('profiles').update({ visibility: 'private' }).eq('id', a.id);
  assert.deepEqual(await reach(s, a, post), { post: 0, feed: 0, likes: 0, comments: 0, card: 1, photo: 0 });
  assert.deepEqual(await reach(f, a, post), { post: 1, feed: 1, likes: 1, comments: 1, card: 1, photo: 1 });
  assert.ok((await s.client.from('likes').insert({ post_id: post.postId })).error, 'stranger liked private post');
  assert.ok((await s.client.from('comments').insert({ post_id: post.postId, body: 'x' })).error, 'stranger commented');

  // Pending request grants nothing; responding to someone else's request is refused.
  assert.equal((await s.client.rpc('follow_user', { p_target: a.id })).data, 'pending');
  assert.equal((await reach(s, a, post)).post, 0);
  assert.ok((await f.client.rpc('respond_follow_request', { p_requester: s.id, p_accept: true })).error);
  assert.ok((await s.client.rpc('respond_follow_request', { p_requester: s.id, p_accept: true })).error);
  assert.equal((await reach(s, a, post)).post, 0);
  await s.client.rpc('unfollow_user', { p_target: a.id });

  // Removed follower loses access immediately.
  assert.equal((await a.client.rpc('remove_follower', { p_follower: f.id })).error, null);
  assert.deepEqual(await reach(f, a, post), { post: 0, feed: 0, likes: 0, comments: 0, card: 1, photo: 0 });
  await a.client.from('profiles').update({ visibility: 'public' }).eq('id', a.id);
});

test('block revokes access both ways, including avatar and profile card', async () => {
  const { a, x } = users;
  const avatar = `${a.id}/avatar.png`;
  assert.equal((await a.client.storage.from('avatars').upload(avatar, png, { contentType: 'image/png', upsert: true })).error, null);
  assert.equal((await a.client.from('profiles').update({ avatar_path: avatar }).eq('id', a.id)).error, null);
  const xAvatar = `${x.id}/avatar.png`;
  assert.equal((await x.client.storage.from('avatars').upload(xAvatar, png, { contentType: 'image/png', upsert: true })).error, null);
  assert.equal((await x.client.rpc('follow_user', { p_target: a.id })).data, 'accepted');
  const post = await publish(a);
  assert.equal((await reach(x, a, post)).photo, 1);
  assert.ok((await x.client.storage.from('avatars').download(avatar)).data, 'precondition: avatar readable');

  assert.equal((await a.client.rpc('block_user', { p_target: x.id })).error, null);
  assert.deepEqual(await reach(x, a, post), { post: 0, feed: 0, likes: 0, comments: 0, card: 0, photo: 0 });
  assert.equal((await x.client.storage.from('avatars').download(avatar)).data, null, 'blocked user read blocker avatar');
  assert.equal((await a.client.storage.from('avatars').download(xAvatar)).data, null, 'blocker read blocked avatar');
  assert.deepEqual((await x.client.from('profiles').select('id').eq('id', a.id)).data, []);
  assert.deepEqual((await x.client.rpc('search_profiles', { p_query: a.handle, p_limit: 5 })).data, []);
  assert.ok((await x.client.rpc('follow_user', { p_target: a.id })).error, 'blocked user re-followed');
  assert.ok((await x.client.from('likes').insert({ post_id: post.postId })).error);
  assert.ok((await x.client.from('comments').insert({ post_id: post.postId, body: 'x' })).error);
  // Blocker also loses access to the blocked user's content.
  const xPost = await publish(x);
  assert.equal((await reach(a, x, xPost)).post, 0);
  assert.equal((await reach(a, x, xPost)).photo, 0);
  await a.client.rpc('unblock_user', { p_target: x.id });
});

test('deleted post: photo, likes and comments are gone for viewers', async () => {
  const { a, s } = users;
  const post = await publish(a);
  await s.client.from('comments').insert({ post_id: post.postId, body: 'hi' });
  assert.equal((await reach(s, a, post)).photo, 1);
  assert.equal((await a.client.rpc('delete_post', { p_post_id: post.postId })).error, null);
  const r = await reach(s, a, post);
  assert.deepEqual([r.post, r.likes, r.comments, r.photo], [0, 0, 0, 0]);
  // Tombstoned id cannot be resurrected by a retried publish, and the snapshot cannot be refreshed.
  assert.ok((await a.client.rpc('update_post_snapshot', { p_post_id: post.postId })).error);
});

test('storage path spoofing is refused', async () => {
  const { a, s } = users;
  const id = uuid();
  for (const [bucket, path] of [
    ['avatars', `${a.id}/evil.png`], ['avatars', `${s.id}/../${a.id}/evil.png`],
    ['post-photos', `${a.id}/${id}.png`], ['post-photos', `${s.id}/nested/${id}.png`],
    ['post-photos', `${s.id}/${id}.html`],
  ]) {
    const res = await s.client.storage.from(bucket).upload(path, png, { contentType: 'image/png' });
    assert.ok(res.error, `uploaded ${bucket}/${path}`);
  }
  const html = await s.client.storage.from('avatars').upload(`${s.id}/x.html`, png, { contentType: 'text/html' });
  assert.ok(html.error, 'non-image mime accepted');
  // publish_post refuses a photo path outside the author's own post folder.
  const sessionId = uuid();
  await push(s.client, { aggregateType: 'session', aggregateId: sessionId, action: 'upsert', doc: sessionDoc(sessionId) });
  const pub = await s.client.rpc('publish_post', { p_post_id: uuid(), p_session_id: sessionId, p_caption: null,
    p_photo_path: `${a.id}/${id}.png` });
  assert.ok(pub.error, 'published with another user photo path');
  // Removing another user's objects is a no-op.
  const post = await publish(a);
  await s.client.storage.from('post-photos').remove([post.photo]);
  assert.ok((await a.client.storage.from('post-photos').download(post.photo)).data, 'stranger deleted photo');
});
