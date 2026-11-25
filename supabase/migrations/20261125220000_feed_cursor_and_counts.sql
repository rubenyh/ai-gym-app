-- Review fixes for the community feed:
-- 1. Deterministic pagination: the feed orders by (published_at desc, id desc) but the cursor was only
--    published_at, so posts sharing a timestamp at a page boundary were skipped. The cursor is now the pair.
-- 2. Like/comment counts ran each counted row through the likes/comments RLS check (can_view_post per row).
--    The outer query already returns only posts the caller can view (posts RLS), so counts use a definer
--    helper that is only reachable for those posts.

create function private.post_counts(p_post_id uuid, out like_count bigint, out comment_count bigint)
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.likes where post_id = p_post_id),
         (select count(*) from public.comments where post_id = p_post_id);
$$;
revoke all on function private.post_counts(uuid) from public, anon, authenticated;

drop function public.get_feed(timestamptz, int);

create function public.get_feed(p_before timestamptz, p_before_id uuid, p_limit int) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'postId', p.id, 'authorId', p.author_id, 'authorHandle', a.handle, 'authorDisplayName', a.display_name,
      'authorAvatarPath', a.avatar_path, 'snapshot', p.snapshot, 'caption', p.caption, 'photoPath', p.photo_path,
      'revision', p.revision, 'publishedAt', p.published_at,
      'likeCount', c.like_count,
      'commentCount', c.comment_count,
      'likedByMe', exists (select 1 from public.likes l where l.post_id = p.id and l.user_id = (select auth.uid())))
    order by p.published_at desc, p.id desc), '[]'::jsonb)
  from (
    select * from public.posts p
     where (p_before is null
            or p.published_at < p_before
            or (p.published_at = p_before and p_before_id is not null and p.id < p_before_id))
       and (p.author_id = (select auth.uid())
            or exists (select 1 from public.follows f where f.requester_id = (select auth.uid())
                        and f.followee_id = p.author_id and f.status = 'accepted'))
     order by p.published_at desc, p.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) p
  join public.profiles a on a.id = p.author_id
  cross join lateral private.post_counts(p.id) c
$$;

revoke all on function public.get_feed(timestamptz, uuid, int) from public, anon;
grant execute on function public.get_feed(timestamptz, uuid, int) to authenticated;

-- The helper lives in `private`; invoker callers need usage on the schema only through this function.
grant usage on schema private to authenticated;
grant execute on function private.post_counts(uuid) to authenticated;
