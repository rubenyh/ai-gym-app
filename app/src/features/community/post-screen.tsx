import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, FormMessage, FormScreen, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { useRepositories } from '@/db/repositories-context';
import { friendlyError } from '@/features/account/errors';

import {
  addComment,
  deleteComment,
  deletePost,
  getComments,
  getPost,
  PAGE_SIZE,
  setLiked,
  UnavailableError,
  updatePostSnapshot,
  type Comment,
  type PageCursor,
} from './api';
import { feedKey } from './feed-screen';
import { routineFromSnapshot } from './snapshot';
import { PostPhoto, QueryState, SnapshotView, useMe } from './ui';

export const postKey = (id: string) => ['community', 'post', id] as const;

/** Post detail (SOCIAL-03/04/05): snapshot, photo, likes, comments, copy, owner actions. */
export function PostScreen({ postId }: { postId: string }) {
  const { userId, unit } = useMe();
  const repos = useRepositories();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const post = useQuery({ queryKey: postKey(postId), queryFn: () => getPost(postId) });
  const comments = useInfiniteQuery({
    queryKey: [...postKey(postId), 'comments'],
    queryFn: ({ pageParam }) => getComments(postId, pageParam),
    initialPageParam: null as PageCursor,
    getNextPageParam: (last: Comment[]) => (last.length < PAGE_SIZE ? undefined : { at: last[last.length - 1].createdAt, id: last[last.length - 1].id }),
    enabled: post.isSuccess,
  });

  // Permission refresh: content that became inaccessible is purged from the in-memory cache.
  const unavailable = post.error instanceof UnavailableError;
  useEffect(() => {
    if (!unavailable) return;
    qc.removeQueries({ queryKey: postKey(postId) });
    qc.invalidateQueries({ queryKey: feedKey });
  }, [unavailable, postId, qc]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: postKey(postId) });
    qc.invalidateQueries({ queryKey: feedKey });
  };
  const fail = (e: unknown) => setMessage({ text: friendlyError(e), error: true });

  const like = useMutation({ mutationFn: (liked: boolean) => setLiked(postId, liked, userId), onSettled: refresh, onError: fail });
  const add = useMutation({
    mutationFn: () => addComment(postId, comment.trim()),
    onSuccess: () => setComment(''),
    onSettled: refresh,
    onError: fail,
  });
  const removeComment = useMutation({ mutationFn: deleteComment, onSettled: refresh, onError: fail });
  const update = useMutation({
    mutationFn: () => updatePostSnapshot(postId),
    onSuccess: () => setMessage({ text: 'Post updated from the current workout.', error: false }),
    onSettled: refresh,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => deletePost(post.data!),
    onSuccess: () => {
      qc.removeQueries({ queryKey: postKey(postId) });
      qc.invalidateQueries({ queryKey: feedKey });
      router.back();
    },
    onError: fail,
  });

  if (!post.data) {
    return (
      <FormScreen title="Post">
        <QueryState loading={post.isPending} error={post.error} onRetry={() => post.refetch()} />
      </FormScreen>
    );
  }

  const p = post.data;
  const mine = p.authorId === userId;

  function copy() {
    try {
      // Copy creates an independent routine (origin 'copy'); no session is logged, so no XP (SOCIAL-03).
      repos.routines.save(routineFromSnapshot(p.snapshot, (doc) => repos.catalog.saveCustom(doc)));
      setMessage({ text: 'Copied to your routines.', error: false });
    } catch (e) {
      fail(e);
    }
  }

  function confirmDelete() {
    Alert.alert('Delete post?', 'Your saved workout is not affected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
    ]);
  }

  const allComments = comments.data?.pages.flat() ?? [];

  return (
    <FormScreen title={p.snapshot.title}>
      <ThemedText type="small">
        {p.displayName} @{p.handle}
      </ThemedText>
      {p.photoPath ? <PostPhoto path={p.photoPath} /> : null}
      <SnapshotView snapshot={p.snapshot} unit={unit} />
      {p.caption ? <ThemedText>{p.caption}</ThemedText> : null}
      <Button
        label={p.likedByMe ? `Unlike (${p.likeCount})` : `Like (${p.likeCount})`}
        onPress={() => like.mutate(!p.likedByMe)}
        busy={like.isPending}
        variant="secondary"
      />
      <Button label="Copy to my routines" onPress={copy} variant="secondary" />
      {mine ? (
        <>
          {p.sessionId ? <Button label="Update post from workout" onPress={() => update.mutate()} busy={update.isPending} variant="secondary" /> : null}
          <Button label="Delete post" onPress={confirmDelete} busy={remove.isPending} variant="secondary" />
        </>
      ) : null}
      {message ? <FormMessage text={message.text} tone={message.error ? 'error' : 'info'} /> : null}

      <ThemedText type="smallBold" accessibilityRole="header">
        Comments ({p.commentCount})
      </ThemedText>
      <QueryState loading={comments.isPending && post.isSuccess} error={comments.error} onRetry={() => comments.refetch()} />
      {allComments.map((c) => (
        <View key={c.id} style={styles.comment}>
          <ThemedText type="small">
            @{c.handle}: {c.body}
          </ThemedText>
          {c.authorId === userId ? (
            <Button
              label="Delete comment"
              variant="secondary"
              busy={removeComment.isPending}
              onPress={() =>
                Alert.alert('Delete comment?', 'This cannot be undone.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => removeComment.mutate(c.id) },
                ])
              }
            />
          ) : null}
        </View>
      ))}
      {comments.hasNextPage ? (
        <Button label="Load more comments" variant="secondary" onPress={() => comments.fetchNextPage()} busy={comments.isFetchingNextPage} />
      ) : null}
      <TextField label="Add a comment" value={comment} onChangeText={setComment} maxLength={1000} multiline />
      <Button label="Post comment" onPress={() => comment.trim() && add.mutate()} busy={add.isPending} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  comment: { gap: 4 },
});
