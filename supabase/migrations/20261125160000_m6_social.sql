-- M6: community (SOCIAL-01..05, NFR-04). Specs: docs/DATA_AND_SYNC.md#social-permissions, docs/CONTRACTS.md,
-- contracts.ts (PostSnapshot, FollowStatus), docs/DECISIONS.md D-25.
--
-- Access rule for a post (and its likes, comments, photo):
--   viewer = author, OR (no block in either direction AND (author profile public OR viewer is an accepted follower)).
-- Evaluated live, so public -> private, remove follower and block take effect immediately.
-- Posts, follows and blocks are written only through RPCs; likes/comments are direct inserts checked by RLS.
-- Snapshots are built server-side from the synced completed session (allowlisted fields only). No XP here.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.follows (
  requester_id uuid not null references auth.users (id) on delete cascade,
  followee_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (requester_id, followee_id),
  check (requester_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id, status);

create table public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

create table public.posts (
  -- Client-generated stable publication id (retries are idempotent).
  id uuid primary key,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_session_id uuid references public.sessions (id) on delete set null,
  snapshot jsonb not null,
  caption text check (char_length(caption) <= 500),
  photo_path text,
  revision integer not null default 1 check (revision >= 1),
  deleted boolean not null default false,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_photo_path_owner check (
    photo_path is null or photo_path ~ ('^' || author_id::text || '/' || id::text || '\.(jpg|jpeg|png|webp)$'))
);
create index posts_author_published_idx on public.posts (author_id, published_at desc);
create index posts_source_session_idx on public.posts (source_session_id);
create index posts_photo_path_idx on public.posts (photo_path) where photo_path is not null;

create table public.likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index likes_user_idx on public.likes (user_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index comments_post_created_idx on public.comments (post_id, created_at);
create index comments_author_idx on public.comments (author_id);

create trigger follows_set_updated_at before update on public.follows
  for each row execute function public.set_updated_at();
create trigger posts_set_updated_at before update on public.posts
  for each row execute function public.set_updated_at();

-- Sessions are tombstoned, never physically deleted: detach posts when their source is deleted
-- (SOCIAL-05: the post stays, independent).
create function private.detach_posts_from_deleted_session() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.posts set source_session_id = null where source_session_id = new.id;
  return new;
end $$;
create trigger sessions_detach_posts after update of deleted on public.sessions
  for each row when (new.deleted and not old.deleted) execute function private.detach_posts_from_deleted_session();

-- ---------------------------------------------------------------------------------------------
-- Access helpers (security definer: they read blocks/follows/profiles regardless of RLS).
-- ---------------------------------------------------------------------------------------------

create function private.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks
                  where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

create function private.can_view_author(p_viewer uuid, p_author uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_viewer is not null and (
    p_viewer = p_author
    or (not private.is_blocked(p_viewer, p_author)
        and (exists (select 1 from public.profiles where id = p_author and visibility = 'public')
             or exists (select 1 from public.follows
                         where requester_id = p_viewer and followee_id = p_author and status = 'accepted'))))
$$;

create function private.can_view_post(p_post uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.posts
                  where id = p_post and not deleted and private.can_view_author((select auth.uid()), author_id))
$$;

create function private.can_view_post_photo(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.posts
                  where photo_path = p_name and not deleted and private.can_view_author((select auth.uid()), author_id))
$$;

-- PostSnapshot (contracts.ts) from a session row: allowlisted fields only (no notes, timezone, ids,
-- body weight); custom exercises by name only; only completed sets.
create function private.build_post_snapshot(s public.sessions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'version', 1,
    'title', s.name,
    'completedOn', to_char(coalesce(s.local_date, (coalesce(s.completed_at, s.started_at) at time zone 'UTC')::date), 'YYYY-MM-DD'),
    'durationMinutes', greatest(0, floor(extract(epoch from (coalesce(s.completed_at, s.started_at) - s.started_at)) / 60))::int,
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
          'exerciseKey', case when e ->> 'exerciseKey' like 'catalog:%' then e ->> 'exerciseKey' end,
          'exerciseName', e ->> 'exerciseName',
          'loadMode', coalesce((select st ->> 'loadMode' from jsonb_array_elements(e -> 'sets') st
                                 where (st ->> 'completed')::boolean order by (st ->> 'position')::int limit 1), 'external'),
          'sets', (select jsonb_agg(jsonb_build_object('reps', st -> 'reps', 'loadGrams', st -> 'loadGrams')
                                    order by (st ->> 'position')::int)
                     from jsonb_array_elements(e -> 'sets') st where (st ->> 'completed')::boolean))
        order by (e ->> 'position')::int)
        from jsonb_array_elements(s.doc -> 'exercises') e
       where exists (select 1 from jsonb_array_elements(e -> 'sets') st where (st ->> 'completed')::boolean)
    ), '[]'::jsonb))
$$;

create function private.post_json(p public.posts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('postId', p.id, 'authorId', p.author_id, 'sourceSessionId', p.source_session_id,
    'snapshot', p.snapshot, 'caption', p.caption, 'photoPath', p.photo_path, 'revision', p.revision,
    'deleted', p.deleted, 'publishedAt', p.published_at, 'updatedAt', p.updated_at)
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------------------------

revoke all on public.follows, public.blocks, public.posts, public.likes, public.comments from anon, authenticated;
grant select on public.follows, public.blocks, public.posts, public.likes, public.comments to authenticated;
grant insert (post_id), delete on public.likes to authenticated;
grant insert (post_id, body), delete on public.comments to authenticated;

alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;

create policy follows_select_own on public.follows
  for select to authenticated using ((select auth.uid()) in (requester_id, followee_id));
create policy blocks_select_own on public.blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
create policy posts_select_accessible on public.posts
  for select to authenticated using (not deleted and private.can_view_author((select auth.uid()), author_id));
create policy likes_select_accessible on public.likes
  for select to authenticated using (private.can_view_post(post_id));
create policy likes_insert_accessible on public.likes
  for insert to authenticated with check (user_id = (select auth.uid()) and private.can_view_post(post_id));
create policy likes_delete_own on public.likes
  for delete to authenticated using (user_id = (select auth.uid()));
create policy comments_select_accessible on public.comments
  for select to authenticated using (private.can_view_post(post_id));
create policy comments_insert_accessible on public.comments
  for insert to authenticated with check (author_id = (select auth.uid()) and private.can_view_post(post_id));
create policy comments_delete_own on public.comments
  for delete to authenticated using (author_id = (select auth.uid()));

-- Blocking hides identities both ways (M1 note: "Blocking will narrow this in M6").
drop policy profiles_select_signed_in on public.profiles;
create policy profiles_select_unblocked on public.profiles
  for select to authenticated using (id = (select auth.uid()) or not private.is_blocked((select auth.uid()), id));

-- ---------------------------------------------------------------------------------------------
-- Storage: private bucket post-photos, objects '<uid>/<post id>.<ext>'
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-photos', 'post-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

create policy post_photos_select_accessible on storage.objects
  for select to authenticated using (
    bucket_id = 'post-photos'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or private.can_view_post_photo(name)));
create policy post_photos_insert_own on storage.objects
  for insert to authenticated with check (
    bucket_id = 'post-photos'
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'));
create policy post_photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'post-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'post-photos'
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'));
create policy post_photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------------------------
-- Post RPCs
-- ---------------------------------------------------------------------------------------------

-- Idempotent on p_post_id: a retry returns the existing post unchanged. Requires the session to be
-- synced, owned, completed and not deleted (D-25). Photo, if any, must be '<uid>/<post id>.<ext>'.
create function public.publish_post(p_post_id uuid, p_session_id uuid, p_caption text, p_photo_path text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  p public.posts;
  s public.sessions;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into p from public.posts where id = p_post_id;
  if found then
    if p.author_id <> uid then
      raise exception 'post id is not available' using errcode = '42501';
    end if;
    return private.post_json(p);
  end if;
  select * into s from public.sessions
   where id = p_session_id and owner_id = uid and not deleted and status = 'completed';
  if not found then
    raise exception 'session not found, not synced or not completed' using errcode = 'P0002';
  end if;
  insert into public.posts (id, author_id, source_session_id, snapshot, caption, photo_path)
  values (p_post_id, uid, s.id, private.build_post_snapshot(s), nullif(btrim(p_caption), ''), p_photo_path)
  on conflict (id) do nothing;
  select * into p from public.posts where id = p_post_id and author_id = uid;
  return private.post_json(p);
end $$;

-- Explicit refresh from the source session (SOCIAL-05).
create function public.update_post_snapshot(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  p public.posts;
  s public.sessions;
begin
  select * into p from public.posts where id = p_post_id and author_id = uid and not deleted for update;
  if not found then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  select * into s from public.sessions
   where id = p.source_session_id and owner_id = uid and not deleted and status = 'completed';
  if not found then
    raise exception 'source session is no longer available' using errcode = 'P0002';
  end if;
  update public.posts set snapshot = private.build_post_snapshot(s), revision = revision + 1
   where id = p.id returning * into p;
  return private.post_json(p);
end $$;

-- Tombstone (keeps the id so a delayed publish retry cannot resurrect it); likes/comments removed.
create function public.delete_post(p_post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  update public.posts set deleted = true, revision = revision + 1, caption = null
   where id = p_post_id and author_id = uid and not deleted;
  if not found then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  delete from public.likes where post_id = p_post_id;
  delete from public.comments where post_id = p_post_id;
end $$;

-- Feed: accessible posts of accepted followees and own, newest first (security invoker: RLS applies).
create function public.get_feed(p_before timestamptz, p_limit int) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'postId', p.id, 'authorId', p.author_id, 'authorHandle', a.handle, 'authorDisplayName', a.display_name,
      'authorAvatarPath', a.avatar_path, 'snapshot', p.snapshot, 'caption', p.caption, 'photoPath', p.photo_path,
      'revision', p.revision, 'publishedAt', p.published_at,
      'likeCount', (select count(*) from public.likes l where l.post_id = p.id),
      'commentCount', (select count(*) from public.comments c where c.post_id = p.id),
      'likedByMe', exists (select 1 from public.likes l where l.post_id = p.id and l.user_id = (select auth.uid())))
    order by p.published_at desc, p.id desc), '[]'::jsonb)
  from (
    select * from public.posts p
     where p.published_at < coalesce(p_before, 'infinity'::timestamptz)
       and (p.author_id = (select auth.uid())
            or exists (select 1 from public.follows f where f.requester_id = (select auth.uid())
                        and f.followee_id = p.author_id and f.status = 'accepted'))
     order by p.published_at desc, p.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) p
  join public.profiles a on a.id = p.author_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Follow / block RPCs (actor = auth.uid())
-- ---------------------------------------------------------------------------------------------

-- 'accepted' for public profiles, 'pending' for private; existing relationship returned as is.
create function public.follow_user(p_target uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_visibility public.profile_visibility;
  v_status text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_target = uid then
    raise exception 'cannot follow yourself' using errcode = '22023';
  end if;
  select visibility into v_visibility from public.profiles where id = p_target;
  if v_visibility is null or private.is_blocked(uid, p_target) then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  insert into public.follows (requester_id, followee_id, status)
  values (uid, p_target, case when v_visibility = 'public' then 'accepted' else 'pending' end)
  on conflict (requester_id, followee_id) do nothing;
  select status into v_status from public.follows where requester_id = uid and followee_id = p_target;
  return v_status;
end $$;

create function public.unfollow_user(p_target uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.follows where requester_id = (select auth.uid()) and followee_id = p_target
$$;

create function public.respond_follow_request(p_requester uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if p_accept then
    update public.follows set status = 'accepted'
     where requester_id = p_requester and followee_id = uid and status = 'pending';
  else
    delete from public.follows where requester_id = p_requester and followee_id = uid and status = 'pending';
  end if;
  if not found then
    raise exception 'follow request not found' using errcode = 'P0002';
  end if;
end $$;

create function public.remove_follower(p_follower uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.follows where requester_id = p_follower and followee_id = (select auth.uid())
$$;

-- Blocking removes follows in both directions.
create function public.block_user(p_target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_target = uid then
    raise exception 'cannot block yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_target) then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (uid, p_target) on conflict do nothing;
  delete from public.follows
   where (requester_id = uid and followee_id = p_target) or (requester_id = p_target and followee_id = uid);
end $$;

create function public.unblock_user(p_target uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.blocks where blocker_id = (select auth.uid()) and blocked_id = p_target
$$;

-- ---------------------------------------------------------------------------------------------
-- Discovery RPCs (public identity only + caller's FollowStatus)
-- ---------------------------------------------------------------------------------------------

-- Handle prefix or display-name substring; blocked profiles (either way) and self excluded.
create function public.search_profiles(p_query text, p_limit int) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with q as (
    select replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') as pat
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'handle', p.handle, 'displayName', p.display_name,
      'avatarPath', p.avatar_path, 'visibility', p.visibility,
      'followStatus', coalesce((select f.status from public.follows f
                                 where f.requester_id = (select auth.uid()) and f.followee_id = p.id), 'none'))
    order by p.handle), '[]'::jsonb)
  from (
    select p.* from public.profiles p, q
     where q.pat <> '' and char_length(q.pat) <= 100 and p.id <> (select auth.uid())
       and (p.handle like lower(q.pat) || '%' or p.display_name ilike '%' || q.pat || '%')
     order by (p.handle = lower(btrim(p_query))) desc, p.handle
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) p
$$;

-- Limited identity + follow status + post count. Null when not found or the target blocked the caller.
create function public.get_profile_card(p_handle text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  p public.profiles;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into p from public.profiles where handle = lower(btrim(p_handle));
  if not found or exists (select 1 from public.blocks where blocker_id = p.id and blocked_id = uid) then
    return null;
  end if;
  return jsonb_build_object('id', p.id, 'handle', p.handle, 'displayName', p.display_name,
    'avatarPath', p.avatar_path, 'visibility', p.visibility,
    'followStatus', case
      when exists (select 1 from public.blocks where blocker_id = uid and blocked_id = p.id) then 'blocked'
      else coalesce((select status from public.follows where requester_id = uid and followee_id = p.id), 'none') end,
    'postCount', (select count(*) from public.posts where author_id = p.id and not deleted));
end $$;

create function public.list_follow_requests() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('requesterId', f.requester_id, 'handle', p.handle,
      'displayName', p.display_name, 'avatarPath', p.avatar_path, 'requestedAt', f.created_at)
    order by f.created_at desc), '[]'::jsonb)
  from public.follows f join public.profiles p on p.id = f.requester_id
  where f.followee_id = (select auth.uid()) and f.status = 'pending'
$$;

create function public.list_blocked() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('userId', b.blocked_id, 'handle', p.handle,
      'displayName', p.display_name, 'avatarPath', p.avatar_path, 'blockedAt', b.created_at)
    order by b.created_at desc), '[]'::jsonb)
  from public.blocks b join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------------------------

revoke execute on all functions in schema private from public;
-- RLS policies call these as the querying user.
grant usage on schema private to authenticated;
grant execute on function private.is_blocked(uuid, uuid), private.can_view_author(uuid, uuid),
  private.can_view_post(uuid), private.can_view_post_photo(text) to authenticated;

revoke execute on function public.publish_post(uuid, uuid, text, text), public.update_post_snapshot(uuid),
  public.delete_post(uuid), public.get_feed(timestamptz, int), public.follow_user(uuid), public.unfollow_user(uuid),
  public.respond_follow_request(uuid, boolean), public.remove_follower(uuid), public.block_user(uuid),
  public.unblock_user(uuid), public.search_profiles(text, int), public.get_profile_card(text),
  public.list_follow_requests(), public.list_blocked() from public, anon;
grant execute on function public.publish_post(uuid, uuid, text, text), public.update_post_snapshot(uuid),
  public.delete_post(uuid), public.get_feed(timestamptz, int), public.follow_user(uuid), public.unfollow_user(uuid),
  public.respond_follow_request(uuid, boolean), public.remove_follower(uuid), public.block_user(uuid),
  public.unblock_user(uuid), public.search_profiles(text, int), public.get_profile_card(text),
  public.list_follow_requests(), public.list_blocked() to authenticated;
