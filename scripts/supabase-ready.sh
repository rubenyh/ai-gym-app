#!/usr/bin/env bash
# Probe the local Supabase API gateway (Kong) after `supabase start` / `supabase db reset --local`.
#
# Why: `db reset` recreates the storage/auth/realtime containers, which can come back with
# different Docker IPs. Kong 2.8 caches the old container IPs (Docker DNS TTL), so requests through
# 127.0.0.1:54321 get 502 "connect() failed (111: Connection refused)" until Kong re-resolves.
# Restarting Kong once clears its DNS cache.
#
# Bounded: at most one Kong restart and 10 x 1 s re-probes. Exit 0 = ready, 1 = still failing.
# Local stack only (refuses non-local API_URL).
set -u

env_out=$(supabase status -o env 2>/dev/null) || { echo "supabase-ready: 'supabase status' failed; is the local stack running (supabase start)?" >&2; exit 1; }
get() { printf '%s\n' "$env_out" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" | head -n1; }
API_URL=$(get API_URL); ANON_KEY=$(get ANON_KEY)
case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "supabase-ready: refusing non-local API_URL '$API_URL'" >&2; exit 1 ;;
esac
KONG=$(docker ps --format '{{.Names}}' | grep '^supabase_kong_' | head -n1)

code() { curl -s -o /dev/null -w '%{http_code}' -m 5 -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" "$API_URL$1"; }
probe() {  # ok when both endpoints answer with a non-5xx status (gateway reached the upstream)
  rest=$(code /rest/v1/); storage=$(code /storage/v1/bucket)
  [[ "$rest" =~ ^[234] && "$storage" =~ ^[234] ]]
}

probe && { echo "supabase-ready: ok (rest $rest, storage $storage)"; exit 0; }
echo "supabase-ready: rest $rest, storage $storage; restarting ${KONG:-kong} once" >&2
[ -n "$KONG" ] || { echo "supabase-ready: no supabase_kong_* container running" >&2; exit 1; }
docker restart "$KONG" >/dev/null || exit 1
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  probe && { echo "supabase-ready: ok after Kong restart (rest $rest, storage $storage)"; exit 0; }
done
echo "supabase-ready: still failing after Kong restart (rest $rest, storage $storage). Check 'docker logs $KONG --tail 50' and 'supabase status'." >&2
exit 1
