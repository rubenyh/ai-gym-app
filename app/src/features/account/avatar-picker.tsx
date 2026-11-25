import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, FormMessage } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { supabase } from '@/services/supabase/client';

import { friendlyError } from './errors';

/** Max bytes accepted by the private `avatars` bucket (D-20). */
const MAX_BYTES = 2 * 1024 * 1024;

/** Object path inside the avatars bucket; the folder must be the owner's id (Storage policy + profiles check). */
export function avatarObjectPath(userId: string, mimeType: string, version: number): string {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `${userId}/avatar-${version}.${ext}`;
}

/** PROFILE-02 avatar: pick from the library, upload to the private bucket, then point the profile at it. */
export function AvatarPicker({
  userId,
  avatarPath,
  onChanged,
}: {
  userId: string;
  avatarPath: string | null;
  onChanged: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!avatarPath) return;
    // Short-lived signed URL: the bucket is private (D-20); nothing is written to disk.
    supabase.storage
      .from('avatars')
      .createSignedUrl(avatarPath, 600)
      .then(({ data }) => !cancelled && setUrl(data?.signedUrl ?? null));
    return () => {
      cancelled = true;
    };
  }, [avatarPath]);

  async function pick() {
    setMessage(null);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (result.canceled) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? 'image/jpeg';
    if (asset.fileSize && asset.fileSize > MAX_BYTES) {
      setMessage({ text: 'Choose an image smaller than 2 MB.', error: true });
      return;
    }
    setBusy(true);
    try {
      const body = await (await fetch(asset.uri)).arrayBuffer();
      if (body.byteLength > MAX_BYTES) throw new Error('Choose an image smaller than 2 MB.');
      const path = avatarObjectPath(userId, mimeType, Date.now());
      const upload = await supabase.storage.from('avatars').upload(path, body, { contentType: mimeType });
      if (upload.error) throw upload.error;
      const update = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId);
      if (update.error) {
        await supabase.storage.from('avatars').remove([path]); // do not leave an orphaned object
        throw update.error;
      }
      if (avatarPath) await supabase.storage.from('avatars').remove([avatarPath]);
      setMessage({ text: 'Avatar updated.', error: false });
      onChanged();
    } catch (e) {
      setMessage({ text: friendlyError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.row}>
      {avatarPath && url ? (
        <Image source={{ uri: url }} cachePolicy="memory" style={styles.avatar} accessibilityLabel="Your avatar" />
      ) : (
        <View style={[styles.avatar, styles.placeholder]} accessibilityLabel="No avatar">
          <ThemedText type="small">No avatar</ThemedText>
        </View>
      )}
      <View style={styles.flex}>
        <Button label={avatarPath ? 'Change avatar' : 'Choose avatar'} onPress={pick} busy={busy} />
        {message ? <FormMessage text={message.text} tone={message.error ? 'error' : 'info'} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  flex: { flex: 1, gap: 8 },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  placeholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#8888' },
});
