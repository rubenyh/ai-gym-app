import { useEffect, useState } from 'react';
import { Alert, type AlertButton, Modal, StyleSheet, View } from 'react-native';

import { Button } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/*
 * react-native-web implements Alert.alert as a no-op, which silently dropped every confirmation and error
 * dialog on the web. Callers keep using Alert.alert; on the web it queues here and AlertHost (mounted once in
 * the root layout) shows it as a modal dialog with the same buttons and callbacks.
 */
type Request = { title: string; message?: string; buttons: AlertButton[] };

const queue: Request[] = [];
let notify: (() => void) | null = null;

Alert.alert = (title, message, buttons) => {
  queue.push({ title: title ?? '', message: message ?? undefined, buttons: buttons?.length ? buttons : [{ text: 'OK' }] });
  notify?.();
};

export function AlertHost() {
  const [current, setCurrent] = useState<Request | null>(null);

  useEffect(() => {
    notify = () => setCurrent((shown) => shown ?? queue.shift() ?? null);
    notify();
    return () => {
      notify = null;
    };
  }, []);

  if (!current) return null;
  const choose = (button?: AlertButton) => {
    setCurrent(queue.shift() ?? null);
    button?.onPress?.();
  };
  const cancel = current.buttons.find((b) => b.style === 'cancel');
  return (
    <Modal transparent visible animationType="none" onRequestClose={() => choose(cancel)}>
      <View style={styles.backdrop}>
        <ThemedView
          type="backgroundElement"
          style={styles.dialog}
          accessibilityRole="alert"
          aria-modal
          aria-label={current.title}>
          <ThemedText type="subtitle" accessibilityRole="header">
            {current.title}
          </ThemedText>
          {current.message ? <ThemedText>{current.message}</ThemedText> : null}
          <View style={styles.buttons}>
            {current.buttons.map((b, i) => (
              <Button
                key={`${i}-${b.text}`}
                label={b.text ?? 'OK'}
                variant={b.style === 'cancel' ? 'secondary' : 'primary'}
                onPress={() => choose(b)}
              />
            ))}
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0008', padding: Spacing.three },
  dialog: { width: '100%', maxWidth: 420, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  buttons: { gap: Spacing.two, marginTop: Spacing.two },
});
