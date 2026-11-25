import { router } from 'expo-router';
import { Alert } from 'react-native';

import { useRepositories } from '@/db/repositories-context';

import { confirmDestructive, errorMessage } from './common';

export function openLogger(id: string) {
  router.push({ pathname: '/training/session/[id]', params: { id } });
}

/**
 * Starts a routine snapshot or empty workout (SESSION-01). If a workout is already active the user must
 * resume it or explicitly discard it (confirmed) first; only one active workout exists at a time.
 */
export function useStartSession() {
  const repos = useRepositories();

  function begin(routineId?: string) {
    try {
      const session = routineId ? repos.sessions.startFromRoutine(routineId) : repos.sessions.startEmpty();
      openLogger(session.id);
    } catch (e) {
      Alert.alert('Could not start workout', errorMessage(e));
    }
  }

  return function start(routineId?: string) {
    const active = repos.sessions.active();
    if (!active) return begin(routineId);
    Alert.alert('Workout in progress', `"${active.name}" is still active. Resume it, or discard it to start a new workout.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () =>
          confirmDestructive('Discard active workout?', 'All sets logged in it will be deleted.', 'Discard', () => {
            repos.sessions.discard(active.id);
            begin(routineId);
          }),
      },
      { text: 'Resume', onPress: () => openLogger(active.id) },
    ]);
  };
}
