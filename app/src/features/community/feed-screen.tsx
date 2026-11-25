import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

import { getFeed, PAGE_SIZE, type PageCursor, type Post } from './api';
import { Message, QueryState, SnapshotView, useMe } from './ui';

export const feedKey = ['community', 'feed'] as const;

/** Following feed (SOCIAL-01): accessible posts from followed authors and own, newest first. */
export function FeedScreen() {
  const { unit } = useMe();
  const feed = useInfiniteQuery({
    queryKey: feedKey,
    queryFn: ({ pageParam }) => getFeed(pageParam),
    initialPageParam: null as PageCursor,
    getNextPageParam: (last: Post[]) => (last.length < PAGE_SIZE ? undefined : { at: last[last.length - 1].publishedAt, id: last[last.length - 1].id }),
  });
  const posts = feed.data?.pages.flat() ?? [];

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <ThemedText type="subtitle" accessibilityRole="header">
            Community
          </ThemedText>
          <View style={styles.links}>
            <Link href="/social/search" style={styles.link} accessibilityRole="link">
              <ThemedText type="linkPrimary">Find people</ThemedText>
            </Link>
            <Link href="/social/connections" style={styles.link} accessibilityRole="link">
              <ThemedText type="linkPrimary">Followers & requests</ThemedText>
            </Link>
          </View>
        </View>
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} />}
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          ListEmptyComponent={
            feed.isPending || feed.error ? undefined : <Message text="No posts yet. Follow people or publish a finished workout." />
          }
          ListHeaderComponent={<QueryState loading={feed.isPending} error={feed.error} onRetry={() => feed.refetch()} />}
          renderItem={({ item }) => (
            <Link href={`/social/post/${item.id}`} asChild>
              <Pressable accessibilityRole="link" accessibilityLabel={`Post by ${item.displayName}: ${item.snapshot.title}`}>
                <ThemedView type="backgroundElement" style={styles.card}>
                  <ThemedText type="small">
                    {item.displayName} @{item.handle}
                  </ThemedText>
                  <SnapshotView snapshot={item.snapshot} unit={unit} />
                  {item.caption ? <ThemedText>{item.caption}</ThemedText> : null}
                  <ThemedText type="small">
                    {item.likeCount} likes · {item.commentCount} comments
                  </ThemedText>
                </ThemedView>
              </Pressable>
            </Link>
          )}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { padding: 16, gap: 8 },
  links: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  link: { minHeight: 44, paddingVertical: 10 },
  list: { padding: 16, gap: 12, paddingBottom: 128 }, // room for the floating ActiveSessionBar
  card: { padding: 16, borderRadius: 12, gap: 8 },
});
