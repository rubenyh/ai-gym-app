import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { formatWeight } from '@/domain/units';
import { rules } from '@/features/gamification/rules';

import { isQualifyingSession } from './calc/history';
import { detectNewPrs } from './calc/records';
import { Muted, PENDING_LABEL } from './ui';
import { useProgressData } from './use-progress-data';

/**
 * Rewards block for the workout summary screen: completion XP (pending until the server awards it) and
 * new PRs against ALL local history (pending while the session itself is unsynced). SESSION-04, GAME-01.
 */
export function SummaryRewards({ sessionId }: { sessionId: string }) {
  const { sessions, summary, unit } = useProgressData();
  const session = sessions.find((s) => s.id === sessionId);
  const prs = detectNewPrs(sessions, sessionId);
  if (!session) return null;

  const qualifies = isQualifyingSession(session);
  const confirmed = summary?.awardedSessionIds.includes(sessionId) ?? false;

  return (
    <View accessibilityLabel="Rewards" testID="summary-rewards">
      {qualifies ? (
        <ThemedText type="smallBold" testID="summary-xp">
          +{rules.sessionCompletionXp} XP{confirmed ? '' : ` · ${PENDING_LABEL}`}
        </ThemedText>
      ) : (
        <Muted>No XP: complete at least one set to earn it.</Muted>
      )}
      {prs.map((p) => (
        <ThemedText key={`${p.exerciseKey}|${p.kind}|${p.loadGrams}`} type="small" testID="summary-pr">
          New {p.kind === 'weight' ? 'weight' : 'rep'} record: {p.exerciseName}{' '}
          {p.loadGrams !== null ? `${formatWeight(p.loadGrams, unit)} × ${p.reps}` : `${p.reps} reps`}
          {session.pendingOps > 0 ? ` · ${PENDING_LABEL}` : ''}
        </ThemedText>
      ))}
    </View>
  );
}
