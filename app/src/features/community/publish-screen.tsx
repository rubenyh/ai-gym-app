import { useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, FormMessage, FormScreen, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { useLocalQuery } from '@/db/repositories-context';
import { friendlyError } from '@/features/account/errors';
import { validateImage } from '@/services/image-validation';

import { photoPath, publishPost, removePhoto, uploadPhoto } from './api';
import { feedKey } from './feed-screen';
import { previewSnapshot } from './snapshot';
import { Message, SnapshotView, useMe } from './ui';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export const SHARED_FIELDS = ['Workout title', 'Date', 'Duration', 'Exercise names', 'Sets: reps and weight'];
export const EXCLUDED_FIELDS = ['Workout and exercise notes', 'Body weight', 'Private stats (XP, records, goals)', 'Timezone and routine details'];

type Photo = { uri: string };

/**
 * SOCIAL-02 publication. The post ID is generated once and reused for every retry, so
 * `publish_post` (idempotent on the ID) and the photo path never duplicate. The workout itself is
 * already saved locally; nothing here can lose it.
 */
export function PublishScreen({ sessionId }: { sessionId: string }) {
  const { userId, unit } = useMe();
  const qc = useQueryClient();
  const [postId] = useState(() => randomUUID());
  const [caption, setCaption] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-reads after each local write / pull page, so the screen unlocks once the workout syncs.
  const session = useLocalQuery((r) => r.sessions.get(sessionId), [sessionId]);
  if (!session || session.status !== 'completed') {
    return (
      <FormScreen title="Share workout">
        <Message text="Only finished workouts can be shared." />
      </FormScreen>
    );
  }
  if (session.serverRevision === null || session.pendingOps > 0) {
    return (
      <FormScreen title="Share workout">
        <Message text="Sync this workout first. Posts are built from the synced copy on the server." />
        <Link href="/sync-status" accessibilityRole="link" style={styles.link}>
          <ThemedText type="linkPrimary">Open sync status</ThemedText>
        </Link>
      </FormScreen>
    );
  }

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) return setError('Choose a photo smaller than 5 MB.');
    setError(null);
    discardUpload();
    setPhoto({ uri: asset.uri });
  }

  /** Replacing/removing the photo before a successful publish leaves no orphaned object. */
  function discardUpload() {
    if (uploadedPath) void removePhoto(uploadedPath);
    setUploadedPath(null);
  }

  async function publish() {
    setBusy(true);
    setError(null);
    let path = uploadedPath;
    try {
      if (photo && !path) {
        const body = await (await fetch(photo.uri)).arrayBuffer();
        // Storage checks only the declared label: validate the real bytes and upload with the detected type.
        const check = validateImage(body, { maxBytes: MAX_PHOTO_BYTES });
        if (!check.ok) throw new Error(check.error);
        path = photoPath(userId, postId, check.mimeType);
        await uploadPhoto(path, body, check.mimeType);
        setUploadedPath(path);
      }
      try {
        await publishPost({ postId, sessionId, caption: caption.trim() || null, photoPath: path });
      } catch (e) {
        // Definitive server rejection: the uploaded object is an orphan, remove it (best effort).
        // A network failure may hide a committed publish, so the object is kept for the retry.
        if (path && (e as { code?: string }).code) {
          await removePhoto(path);
          setUploadedPath(null);
        }
        throw e;
      }
      await qc.invalidateQueries({ queryKey: feedKey });
      router.replace(`/social/post/${postId}`);
    } catch (e) {
      setError(`${friendlyError(e)} Your workout is still saved. You can try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormScreen title="Share workout">
      <ThemedText type="smallBold" accessibilityRole="header">
        Preview
      </ThemedText>
      <SnapshotView snapshot={previewSnapshot(session)} unit={unit} />
      <View style={styles.fields}>
        <ThemedText type="smallBold">Shared</ThemedText>
        {SHARED_FIELDS.map((f) => (
          <ThemedText key={f} type="small">
            • {f}
          </ThemedText>
        ))}
        <ThemedText type="smallBold">Never shared</ThemedText>
        {EXCLUDED_FIELDS.map((f) => (
          <ThemedText key={f} type="small">
            • {f}
          </ThemedText>
        ))}
      </View>
      <TextField label="Caption (optional)" value={caption} onChangeText={setCaption} maxLength={500} multiline />
      {photo ? <Image source={{ uri: photo.uri }} cachePolicy="memory" style={styles.photo} accessibilityLabel="Selected photo" /> : null}
      <Button label={photo ? 'Change photo' : 'Add photo (optional)'} variant="secondary" onPress={pickPhoto} />
      {photo ? <Button label="Remove photo" variant="secondary" onPress={() => (setPhoto(null), discardUpload())} /> : null}
      <FormMessage text={error} />
      <Button label={error ? 'Retry publish' : 'Publish'} onPress={publish} busy={busy} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  fields: { gap: 2 },
  link: { minHeight: 44, paddingVertical: 10 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12 },
});
