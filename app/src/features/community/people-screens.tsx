import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, FormMessage, FormScreen, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { friendlyError } from '@/features/account/errors';

import {
  blockUser,
  followUser,
  getAuthorPosts,
  getMyBlocks,
  getMyFollowers,
  getProfileCard,
  removeFollower,
  respondFollowRequest,
  searchProfiles,
  unblockUser,
  unfollowUser,
  type PersonRow,
} from './api';
import { Message, QueryState, useMe } from './ui';

const peopleKey = ['community', 'people'] as const;

/** User search (SOCIAL-01): public identity only. */
export function SearchScreen() {
  const [query, setQuery] = useState('');
  const q = query.trim();
  const results = useQuery({ queryKey: [...peopleKey, 'search', q], queryFn: () => searchProfiles(q), enabled: q.length >= 2 });

  return (
    <FormScreen title="Find people">
      <TextField label="Handle or name" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} />
      {q.length < 2 ? <Message text="Type at least 2 characters." /> : null}
      <QueryState loading={results.isLoading} error={results.error} onRetry={() => results.refetch()} />
      {results.data?.length === 0 ? <Message text="No people found." /> : null}
      {results.data?.map((p) => (
        <Link key={p.id} href={`/social/profile/${p.handle}`} asChild>
          <Pressable accessibilityRole="link" style={styles.row}>
            <ThemedText>
              {p.displayName} @{p.handle}
            </ThemedText>
            <ThemedText type="small">{p.visibility === 'private' ? 'Private' : 'Public'}</ThemedText>
          </Pressable>
        </Link>
      ))}
    </FormScreen>
  );
}

/** Profile card: private profiles without an approved follow show identity and request status only. */
export function ProfileScreen({ handle }: { handle: string }) {
  const { userId } = useMe();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const card = useQuery({ queryKey: [...peopleKey, 'card', handle], queryFn: () => getProfileCard(handle) });
  const c = card.data;
  const canSeePosts = !!c && (c.id === userId || c.visibility === 'public' || c.followStatus === 'accepted') && c.followStatus !== 'blocked';
  const posts = useQuery({
    queryKey: [...peopleKey, 'posts', c?.id],
    queryFn: () => getAuthorPosts(c!.id),
    enabled: canSeePosts,
  });

  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onMutate: () => setError(null),
    onError: (e) => setError(friendlyError(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['community'] }),
  });

  if (!c) {
    return (
      <FormScreen title={`@${handle}`}>
        <QueryState loading={card.isPending} error={card.error} onRetry={() => card.refetch()} />
        {card.isSuccess ? <Message text="This profile is unavailable." /> : null}
      </FormScreen>
    );
  }

  const status = c.followStatus;
  return (
    <FormScreen title={c.displayName}>
      <ThemedText type="small">
        @{c.handle} · {c.visibility === 'private' ? 'Private profile' : 'Public profile'}
      </ThemedText>
      {c.id !== userId ? (
        <>
          {status === 'none' ? (
            <Button label={c.visibility === 'private' ? 'Request to follow' : 'Follow'} busy={act.isPending} onPress={() => act.mutate(() => followUser(c.id))} />
          ) : null}
          {status === 'pending' ? (
            <>
              <ThemedText type="small">Follow request sent.</ThemedText>
              <Button label="Cancel request" variant="secondary" busy={act.isPending} onPress={() => act.mutate(() => unfollowUser(c.id))} />
            </>
          ) : null}
          {status === 'accepted' ? (
            <Button label="Unfollow" variant="secondary" busy={act.isPending} onPress={() => act.mutate(() => unfollowUser(c.id))} />
          ) : null}
          {status === 'blocked' ? (
            <Button label="Unblock" variant="secondary" busy={act.isPending} onPress={() => act.mutate(() => unblockUser(c.id))} />
          ) : (
            <Button label="Block" variant="secondary" busy={act.isPending} onPress={() => act.mutate(() => blockUser(c.id))} />
          )}
        </>
      ) : null}
      <FormMessage text={error} />

      {canSeePosts ? (
        <>
          <ThemedText type="smallBold" accessibilityRole="header">
            Posts
          </ThemedText>
          <QueryState loading={posts.isPending} error={posts.error} onRetry={() => posts.refetch()} />
          {posts.data?.length === 0 ? <Message text="No posts yet." /> : null}
          {posts.data?.map((p) => (
            <Link key={p.id} href={`/social/post/${p.id}`} asChild>
              <Pressable accessibilityRole="link" style={styles.row}>
                <ThemedText>{p.title}</ThemedText>
                <ThemedText type="small">{p.publishedAt.slice(0, 10)}</ThemedText>
              </Pressable>
            </Link>
          ))}
        </>
      ) : (
        <Message text="This profile is private. Workouts are visible to approved followers." />
      )}
    </FormScreen>
  );
}

/** SOCIAL-04: own follow requests, followers and blocked users. */
export function ConnectionsScreen() {
  const { userId } = useMe();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const followers = useQuery({ queryKey: [...peopleKey, 'followers'], queryFn: () => getMyFollowers(userId) });
  const blocks = useQuery({ queryKey: [...peopleKey, 'blocks'], queryFn: getMyBlocks });
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onMutate: () => setError(null),
    onError: (e) => setError(friendlyError(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['community'] }),
  });

  const person = (p: PersonRow, actions: { label: string; run: () => Promise<unknown> }[]) => (
    <View key={p.id} style={styles.person}>
      <ThemedText>
        {p.displayName} @{p.handle}
      </ThemedText>
      <View style={styles.actions}>
        {actions.map((a) => (
          <Button key={a.label} label={a.label} variant="secondary" busy={act.isPending} onPress={() => act.mutate(a.run)} />
        ))}
      </View>
    </View>
  );

  return (
    <FormScreen title="Followers & requests">
      <FormMessage text={error} />
      <QueryState loading={followers.isPending} error={followers.error} onRetry={() => followers.refetch()} />
      {followers.data ? (
        <>
          <ThemedText type="smallBold" accessibilityRole="header">
            Follow requests
          </ThemedText>
          {followers.data.requests.length === 0 ? <Message text="No pending requests." /> : null}
          {followers.data.requests.map((p) =>
            person(p, [
              { label: 'Accept', run: () => respondFollowRequest(p.id, true) },
              { label: 'Reject', run: () => respondFollowRequest(p.id, false) },
            ]),
          )}
          <ThemedText type="smallBold" accessibilityRole="header">
            Followers
          </ThemedText>
          {followers.data.followers.length === 0 ? <Message text="No followers yet." /> : null}
          {followers.data.followers.map((p) =>
            person(p, [
              { label: 'Remove', run: () => removeFollower(p.id) },
              { label: 'Block', run: () => blockUser(p.id) },
            ]),
          )}
        </>
      ) : null}
      <ThemedText type="smallBold" accessibilityRole="header">
        Blocked
      </ThemedText>
      <QueryState loading={blocks.isPending} error={blocks.error} onRetry={() => blocks.refetch()} />
      {blocks.data?.length === 0 ? <Message text="You have not blocked anyone." /> : null}
      {blocks.data?.map((p) => person(p, [{ label: 'Unblock', run: () => unblockUser(p.id) }]))}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, paddingVertical: 8 },
  person: { gap: 4 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
