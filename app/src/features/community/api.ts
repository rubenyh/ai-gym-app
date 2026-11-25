import type { SupabaseClient } from '@supabase/supabase-js';

import { postSnapshot, type FollowStatus, type PostSnapshot } from '@/domain/contracts';
import { supabase } from '@/services/supabase/client';

/**
 * Every social server call lives here (online-only, SOCIAL-01..05). Nothing is persisted locally;
 * TanStack Query holds results in memory only. Access is enforced by RLS/RPCs, never by this module.
 * Names match supabase/migrations/20261125160000_m6_social.sql (RPCs return camelCase jsonb).
 * ponytail: untyped client until database.types.ts is regenerated with the M6 migration.
 */
const db = supabase as unknown as SupabaseClient;

export const PHOTO_BUCKET = 'post-photos';
export const PAGE_SIZE = 20;

export type Post = {
  id: string;
  authorId: string;
  handle: string;
  displayName: string;
  sessionId: string | null;
  snapshot: PostSnapshot;
  caption: string | null;
  photoPath: string | null;
  publishedAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
};

/** `search_profiles` / `get_profile_card` output. */
export type ProfileCard = {
  id: string;
  handle: string;
  displayName: string;
  avatarPath: string | null;
  visibility: 'public' | 'private';
  followStatus: FollowStatus;
};

export type Comment = { id: string; authorId: string; handle: string; body: string; createdAt: string };

export type PersonRow = { id: string; handle: string; displayName: string };

/** Thrown when RLS hides a post (deleted, private, blocked): the UI shows "unavailable". */
export class UnavailableError extends Error {
  constructor() {
    super('This post is unavailable.');
  }
}

function check<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) {
    // 42501 insufficient_privilege: the caller cannot see this content.
    if ((error as { code?: string }).code === '42501') throw new UnavailableError();
    throw error;
  }
  return data;
}

/** `get_feed` element. */
type FeedRow = {
  postId: string;
  authorId: string;
  authorHandle: string;
  authorDisplayName: string;
  snapshot: unknown;
  caption: string | null;
  photoPath: string | null;
  publishedAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
};

function toPost(r: FeedRow, sessionId: string | null = null): Post {
  return {
    id: r.postId,
    authorId: r.authorId,
    handle: r.authorHandle,
    displayName: r.authorDisplayName,
    sessionId,
    // Server output is still validated: a malformed snapshot is a bug, not something to render.
    snapshot: postSnapshot.parse(r.snapshot),
    caption: r.caption,
    photoPath: r.photoPath,
    publishedAt: r.publishedAt,
    likeCount: Number(r.likeCount ?? 0),
    commentCount: Number(r.commentCount ?? 0),
    likedByMe: Boolean(r.likedByMe),
  };
}

async function profilesById(ids: string[]): Promise<Map<string, { handle: string; displayName: string }>> {
  if (ids.length === 0) return new Map();
  const rows = check(await db.from('profiles').select('id, handle, display_name').in('id', [...new Set(ids)])) as {
    id: string;
    handle: string;
    display_name: string;
  }[];
  return new Map(rows.map((r) => [r.id, { handle: r.handle, displayName: r.display_name }]));
}

// ------------------------------------------------------------------ feed / posts

/** Keyset cursor matching the server order (timestamp desc, id desc); a timestamp alone skips ties. */
export type PageCursor = { at: string; id: string } | null;

export async function getFeed(before: PageCursor): Promise<Post[]> {
  const rows = check(
    await db.rpc('get_feed', { p_before: before?.at ?? null, p_before_id: before?.id ?? null, p_limit: PAGE_SIZE }),
  );
  return ((rows ?? []) as FeedRow[]).map((r) => toPost(r));
}

type PostTableRow = {
  id: string;
  author_id: string;
  source_session_id: string | null;
  snapshot: unknown;
  caption: string | null;
  photo_path: string | null;
  published_at: string;
};

/** One post through RLS (posts_select_accessible); no row = deleted, private or blocked. */
export async function getPost(postId: string): Promise<Post> {
  const row = check(
    await db
      .from('posts')
      .select('id, author_id, source_session_id, snapshot, caption, photo_path, published_at')
      .eq('id', postId)
      .maybeSingle(),
  ) as PostTableRow | null;
  if (!row) throw new UnavailableError();
  const [auth, authors, likes, comments] = await Promise.all([
    db.auth.getSession(),
    profilesById([row.author_id]),
    db.from('likes').select('user_id').eq('post_id', postId),
    db.from('comments').select('id', { count: 'exact', head: true }).eq('post_id', postId),
  ]);
  // ponytail: like rows are fetched to count them; add a count RPC if posts get many likes.
  const likeRows = check(likes) as { user_id: string }[];
  check(comments);
  const me = auth.data.session?.user.id;
  const author = authors.get(row.author_id);
  return toPost(
    {
      postId: row.id,
      authorId: row.author_id,
      authorHandle: author?.handle ?? 'unknown',
      authorDisplayName: author?.displayName ?? 'Unknown',
      snapshot: row.snapshot,
      caption: row.caption,
      photoPath: row.photo_path,
      publishedAt: row.published_at,
      likeCount: likeRows.length,
      commentCount: comments.count ?? 0,
      likedByMe: likeRows.some((l) => l.user_id === me),
    },
    row.source_session_id,
  );
}

/**
 * Own live posts whose source is this session (SOCIAL-05 warning). Call BEFORE deleting the session:
 * the server detaches posts from a deleted session; the posts stay published until deleted explicitly.
 */
export async function findPostsForSession(sessionId: string): Promise<{ id: string; publishedAt: string; photoPath: string | null }[]> {
  const rows = check(await db.from('posts').select('id, published_at, photo_path').eq('source_session_id', sessionId));
  return ((rows ?? []) as { id: string; published_at: string; photo_path: string | null }[]).map((r) => ({
    id: r.id,
    publishedAt: r.published_at,
    photoPath: r.photo_path,
  }));
}

export async function publishPost(args: { postId: string; sessionId: string; caption: string | null; photoPath: string | null }) {
  return check(
    await db.rpc('publish_post', {
      p_post_id: args.postId,
      p_session_id: args.sessionId,
      p_caption: args.caption,
      p_photo_path: args.photoPath,
    }),
  );
}

export async function updatePostSnapshot(postId: string) {
  return check(await db.rpc('update_post_snapshot', { p_post_id: postId }));
}

/** Tombstones the post (server removes its likes/comments), then removes its photo best-effort. */
export async function deletePost(post: Pick<Post, 'id' | 'photoPath'>) {
  check(await db.rpc('delete_post', { p_post_id: post.id }));
  if (post.photoPath) await removePhoto(post.photoPath);
}

export async function setLiked(postId: string, liked: boolean, userId: string) {
  if (!liked) return void check(await db.from('likes').delete().eq('post_id', postId).eq('user_id', userId));
  // user_id defaults to auth.uid() server-side; only post_id is insertable.
  const res = await db.from('likes').insert({ post_id: postId });
  if ((res.error as { code?: string } | null)?.code !== '23505') check(res); // 23505 = already liked
}

// ------------------------------------------------------------------ comments

export async function getComments(postId: string, before: PageCursor): Promise<Comment[]> {
  let q = db
    .from('comments')
    .select('id, author_id, body, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);
  if (before) q = q.or(`created_at.lt."${before.at}",and(created_at.eq."${before.at}",id.lt.${before.id})`);
  const rows = check(await q) as { id: string; author_id: string; body: string; created_at: string }[];
  const authors = await profilesById(rows.map((r) => r.author_id));
  return rows.map((r) => ({
    id: r.id,
    authorId: r.author_id,
    handle: authors.get(r.author_id)?.handle ?? 'unknown',
    body: r.body,
    createdAt: r.created_at,
  }));
}

/** author_id defaults to auth.uid(); RLS checks access to the post. */
export async function addComment(postId: string, body: string) {
  check(await db.from('comments').insert({ post_id: postId, body }));
}

export async function deleteComment(commentId: string) {
  check(await db.from('comments').delete().eq('id', commentId));
}

// ------------------------------------------------------------------ profiles / follows

export async function searchProfiles(query: string): Promise<ProfileCard[]> {
  return (check(await db.rpc('search_profiles', { p_query: query, p_limit: PAGE_SIZE })) ?? []) as ProfileCard[];
}

/** Null when not found or the target blocked the caller. */
export async function getProfileCard(handle: string): Promise<ProfileCard | null> {
  return (check(await db.rpc('get_profile_card', { p_handle: handle })) ?? null) as ProfileCard | null;
}

/** Posts of one author visible to the caller; RLS returns none for a private profile without approval. */
export async function getAuthorPosts(authorId: string): Promise<{ id: string; title: string; publishedAt: string }[]> {
  const rows = check(
    await db
      .from('posts')
      .select('id, snapshot, published_at')
      .eq('author_id', authorId)
      .order('published_at', { ascending: false })
      .limit(PAGE_SIZE),
  );
  return ((rows ?? []) as { id: string; snapshot: { title?: string }; published_at: string }[]).map((r) => ({
    id: r.id,
    title: r.snapshot?.title ?? 'Workout',
    publishedAt: r.published_at,
  }));
}

export const followUser = async (target: string) => check(await db.rpc('follow_user', { p_target: target })) as FollowStatus;
export const unfollowUser = async (target: string) => void check(await db.rpc('unfollow_user', { p_target: target }));
export const blockUser = async (target: string) => void check(await db.rpc('block_user', { p_target: target }));
export const unblockUser = async (target: string) => void check(await db.rpc('unblock_user', { p_target: target }));
export const removeFollower = async (follower: string) => void check(await db.rpc('remove_follower', { p_follower: follower }));
export const respondFollowRequest = async (requester: string, accept: boolean) =>
  void check(await db.rpc('respond_follow_request', { p_requester: requester, p_accept: accept }));

/** Own incoming requests (`list_follow_requests`) and accepted followers (follows RLS: own rows). */
export async function getMyFollowers(userId: string): Promise<{ requests: PersonRow[]; followers: PersonRow[] }> {
  const [requests, follows] = await Promise.all([
    db.rpc('list_follow_requests'),
    db.from('follows').select('requester_id').eq('followee_id', userId).eq('status', 'accepted'),
  ]);
  const followerIds = (check(follows) as { requester_id: string }[]).map((r) => r.requester_id);
  const names = await profilesById(followerIds);
  return {
    requests: ((check(requests) ?? []) as { requesterId: string; handle: string; displayName: string }[]).map((r) => ({
      id: r.requesterId,
      handle: r.handle,
      displayName: r.displayName,
    })),
    followers: followerIds.map((id) => ({ id, handle: names.get(id)?.handle ?? '', displayName: names.get(id)?.displayName ?? '' })),
  };
}

export async function getMyBlocks(): Promise<PersonRow[]> {
  const rows = (check(await db.rpc('list_blocked')) ?? []) as { userId: string; handle: string; displayName: string }[];
  return rows.map((r) => ({ id: r.userId, handle: r.handle, displayName: r.displayName }));
}

// ------------------------------------------------------------------ photos (private bucket)

/** '<uid>/<postId>.<ext>' — the bucket policy and posts_photo_path_owner check require exactly this. */
export function photoPath(userId: string, postId: string, mimeType: string): string {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `${userId}/${postId}.${ext}`;
}

export async function uploadPhoto(path: string, body: ArrayBuffer, contentType: string) {
  // upsert: a retry after a lost response rewrites the same object instead of failing.
  check(await db.storage.from(PHOTO_BUCKET).upload(path, body, { contentType, upsert: true }));
}

/** Best-effort orphan cleanup; failures are ignored (the object stays private to its owner). */
export async function removePhoto(path: string) {
  try {
    await db.storage.from(PHOTO_BUCKET).remove([path]);
  } catch {
    // ignored
  }
}

/** Short-lived URL; the image is cached in memory only, never on disk. */
export async function signedPhotoUrl(path: string): Promise<string | null> {
  const { data } = await db.storage.from(PHOTO_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}
