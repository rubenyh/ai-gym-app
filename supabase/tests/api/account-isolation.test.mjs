// API-level privacy checks (NFR-04): two real accounts against the local stack through PostgREST,
// RPC and Storage, the same paths a modified client would use. Local stack only.
//
// Run from the repo root (bash):
//   set -a; eval "$(supabase status -o env)"; set +a; node --test supabase/tests/api/*.test.mjs
//
// SERVICE_ROLE_KEY is used only to create confirmed test users on the LOCAL stack.
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
const users = {};

async function signedInClient(label) {
  const email = `${label}-${run}@test.local`;
  const password = `pw-${run}-${label}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(API_URL, ANON_KEY, opts);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

before(async () => {
  users.a = await signedInClient('a');
  users.b = await signedInClient('b');
  const { error } = await users.a.client.rpc('complete_onboarding', {
    p_handle: `a_${run}`,
    p_display_name: 'Account A',
    p_weight_unit: 'kg',
    p_length_unit: 'cm',
    p_timezone: 'Europe/Madrid',
    p_target_days: 3,
  });
  if (error) throw error;
  const bwId = crypto.randomUUID();
  const bw = await users.a.client.rpc('sync_push', {
    p_op: {
      opId: crypto.randomUUID(), aggregateType: 'body_weight', aggregateId: bwId, action: 'upsert', baseRevision: null,
      doc: { id: bwId, measuredAt: new Date().toISOString(), weightGrams: 81000 },
    },
  });
  if (bw.error || bw.data.status !== 'applied') throw bw.error ?? new Error(JSON.stringify(bw.data));
  const tp = await users.a.client.from('training_profiles').insert({ age: 30, limitations: 'knee' });
  if (tp.error) throw tp.error;
});

after(async () => {
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

test('B cannot read A private rows through the REST API', async () => {
  for (const table of ['user_settings', 'weekly_goals', 'training_profiles', 'body_weight_entries']) {
    const { data, error } = await users.b.client.from(table).select('*').eq('owner_id', users.a.id);
    assert.equal(error, null, table);
    assert.deepEqual(data, [], `${table} leaked to B`);
  }
});

test('B sees A public identity but no private fields', async () => {
  const { data, error } = await users.b.client.from('profiles').select('*').eq('id', users.a.id).single();
  assert.equal(error, null);
  assert.deepEqual(Object.keys(data).sort(), [
    'avatar_path', 'created_at', 'display_name', 'handle', 'id', 'updated_at', 'visibility',
  ]);
});

test('B cannot modify or delete A rows', async () => {
  await users.b.client.from('profiles').update({ display_name: 'Hacked' }).eq('id', users.a.id);
  await users.b.client.from('body_weight_entries').delete().eq('owner_id', users.a.id);
  const profile = await users.a.client.from('profiles').select('display_name').eq('id', users.a.id).single();
  const weights = await users.a.client.from('body_weight_entries').select('id');
  assert.equal(profile.data.display_name, 'Account A');
  assert.equal(weights.data.length, 1);
});

test('B cannot write rows owned by A', async () => {
  const { error } = await users.b.client
    .from('body_weight_entries')
    .insert({ owner_id: users.a.id, measured_at: new Date().toISOString(), weight_grams: 70000 });
  assert.equal(error?.code, '42501');
});

test('anonymous requests read nothing', async () => {
  const anon = createClient(API_URL, ANON_KEY, opts);
  const { data, error } = await anon.from('profiles').select('*');
  assert.ok(error || data.length === 0, 'anon read profiles');
});

test('avatar storage: own folder only, readable by signed-in users', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const own = await users.a.client.storage
    .from('avatars')
    .upload(`${users.a.id}/avatar.png`, png, { contentType: 'image/png' });
  assert.equal(own.error, null);
  const foreign = await users.a.client.storage
    .from('avatars')
    .upload(`${users.b.id}/avatar.png`, png, { contentType: 'image/png' });
  assert.ok(foreign.error, 'A uploaded into B folder');
  const signed = await users.b.client.storage.from('avatars').createSignedUrl(`${users.a.id}/avatar.png`, 60);
  assert.equal(signed.error, null);
  const removed = await users.b.client.storage.from('avatars').remove([`${users.a.id}/avatar.png`]);
  assert.deepEqual(removed.data ?? [], [], 'B removed A avatar');
  const stillThere = await users.a.client.storage.from('avatars').list(users.a.id);
  assert.equal(stillThere.data.length, 1);
  await users.a.client.storage.from('avatars').remove([`${users.a.id}/avatar.png`]);
});
