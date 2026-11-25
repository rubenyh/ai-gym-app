import { Link } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PetCharacter } from '@/components/characters/characters';
import { Button } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useLocalQuery } from '@/db/repositories-context';
import { useAccount } from '@/features/account/account-provider';
import { openLogger, useStartSession } from '@/features/workouts/start-session';

import { weeklyConsistency } from './calc/consistency';
import { isoWeekday, weekStart } from './calc/dates';
import { Meter, Muted, PENDING_LABEL, Section } from './ui';
import { useProgressData } from './use-progress-data';

export function HomeScreen() {
  const { state } = useAccount();
  const name = state.kind === 'ready' ? state.account.profile.displayName : null;
  const { sessions, goals, progression: p, today } = useProgressData();
  const start = useStartSession();

  const active = useLocalQuery((r) => r.sessions.active(), []);
  const weekday = isoWeekday(today);
  const planned = useLocalQuery(
    (r) => {
      const program = r.programs.active();
      const day = program?.days.find((d) => d.weekday === weekday);
      const routine = day ? r.routines.get(day.routineId) : null;
      return program ? { program, routine: routine && !routine.archived ? routine : null } : null;
    },
    [weekday],
  );
  const week = weeklyConsistency(sessions, goals, today)[0];
  const thisWeek = week && week.weekStart === weekStart(today) ? week : null;

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle" accessibilityRole="header">
            {name ? `Hi, ${name}` : 'Home'}
          </ThemedText>

          <Section title="Your pet">
            <PetCharacter stage={p.petStage} />
            <ThemedText type="smallBold" testID="level">
              Level {p.level}
            </ThemedText>
            <Meter value={p.xpIntoLevel} max={p.xpForNextLevel} label={`Level ${p.level}: ${p.xpIntoLevel} of ${p.xpForNextLevel} XP`} />
            <Muted>
              {p.xpIntoLevel} / {p.xpForNextLevel} XP to level {p.level + 1} · {p.totalXp} XP total
            </Muted>
            {p.pendingXp > 0 && <Muted testID="xp-pending">+{p.pendingXp} XP · {PENDING_LABEL}</Muted>}
            {!p.confirmed && <Muted>Rewards not confirmed by the server yet · {PENDING_LABEL}</Muted>}
            <Link href="/insights/achievements" accessibilityRole="button" style={styles.link}>
              <ThemedText type="linkPrimary">Achievements</ThemedText>
            </Link>
          </Section>

          <Section title="This week">
            {thisWeek ? (
              <>
                <Meter value={thisWeek.days} max={thisWeek.targetDays} label={`${thisWeek.days} of ${thisWeek.targetDays} training days`} />
                <Muted testID="week-goal">
                  {thisWeek.days} / {thisWeek.targetDays} training days{thisWeek.achieved ? ' · goal reached' : ''}
                </Muted>
              </>
            ) : (
              <Muted>No weekly goal yet. Set one in settings.</Muted>
            )}
          </Section>

          <Section title="Workout">
            {active ? (
              <Button label={`Resume "${active.name}"`} onPress={() => openLogger(active.id)} />
            ) : (
              <>
                {planned?.routine ? (
                  <>
                    <Muted>
                      Today in {planned.program.name}: {planned.routine.name}
                    </Muted>
                    <Button label={`Start ${planned.routine.name}`} onPress={() => start(planned.routine!.id)} />
                  </>
                ) : (
                  <Muted>{planned ? 'Rest day in your active program.' : 'No active program.'}</Muted>
                )}
                <Button label="Start empty workout" variant="secondary" onPress={() => start()} />
              </>
            )}
          </Section>

          <Link href="/settings" accessibilityRole="button" style={styles.link}>
            <ThemedText type="linkPrimary">Profile & settings</ThemedText>
          </Link>
          {__DEV__ && (
            <Link href="/dev/verify" accessibilityRole="button" style={styles.link}>
              <ThemedText type="linkPrimary">Open M0 native verification (dev only)</ThemedText>
            </Link>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  link: { minHeight: 44, paddingVertical: Spacing.two },
});
