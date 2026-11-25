import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/form';
import { Card, Row, SectionTitle, SmallButton } from '@/components/ui/layout';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useLocalQuery } from '@/db/repositories-context';

import { SyncBadge, WEEKDAYS } from './common';
import { openLogger, useStartSession } from './start-session';

/** Workouts tab: resume, start, active program, routines, history and catalog entry points. */
export function WorkoutsHome() {
  const start = useStartSession();
  const [showArchived, setShowArchived] = useState(false);
  const data = useLocalQuery(
    (r) => ({
      active: r.sessions.active(),
      program: r.programs.active(),
      programs: r.programs.list(),
      routines: r.routines.list({ includeArchived: true }),
    }),
    [],
  );
  const routineName = new Map(data.routines.map((r) => [r.id, r.name]));
  const routines = showArchived ? data.routines : data.routines.filter((r) => !r.archived);

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle" accessibilityRole="header">
            Workouts
          </ThemedText>

          {data.active ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Resume active workout ${data.active.name}`}
              onPress={() => openLogger(data.active!.id)}>
              <Card>
                <ThemedText type="smallBold">Workout in progress</ThemedText>
                <ThemedText>{data.active.name} · Tap to resume</ThemedText>
              </Card>
            </Pressable>
          ) : null}

          <Button label="Start empty workout" onPress={() => start()} />
          <Row>
            <SmallButton label="History" accessibilityLabel="Workout history" onPress={() => router.push('/training/history')} />
            <SmallButton label="Exercise catalog" onPress={() => router.push('/training/catalog')} />
          </Row>

          <SectionTitle>Program</SectionTitle>
          {data.program ? (
            <Card>
              <Row>
                <ThemedText type="smallBold">{data.program.name} (active)</ThemedText>
                <SyncBadge meta={data.program} />
              </Row>
              {WEEKDAYS.map((day, i) => {
                const assigned = data.program!.days.find((d) => d.weekday === i + 1);
                const name = assigned ? (routineName.get(assigned.routineId) ?? 'Routine') : 'Rest';
                return (
                  <Row key={day}>
                    <ThemedText type="small" style={styles.day}>
                      {day}
                    </ThemedText>
                    <ThemedText type="small">{name}</ThemedText>
                    {assigned ? (
                      <SmallButton label="Start" accessibilityLabel={`Start ${name} (${day})`} onPress={() => start(assigned.routineId)} />
                    ) : null}
                  </Row>
                );
              })}
            </Card>
          ) : (
            <ThemedText themeColor="textSecondary">No active program. Create one to plan routines by weekday.</ThemedText>
          )}
          <Row>
            {data.programs.map((p) => (
              <SmallButton
                key={p.id}
                label={`Edit ${p.name}`}
                onPress={() => router.push({ pathname: '/training/program', params: { id: p.id } })}
              />
            ))}
            <SmallButton label="New program" onPress={() => router.push('/training/program')} />
          </Row>

          <SectionTitle>Routines</SectionTitle>
          <Row>
            <SmallButton label="New routine" onPress={() => router.push({ pathname: '/training/routine/[id]', params: { id: 'new' } })} />
            <SmallButton
              label={showArchived ? 'Hide archived' : 'Show archived'}
              selected={showArchived}
              onPress={() => setShowArchived((v) => !v)}
            />
          </Row>
          {routines.length === 0 ? (
            <ThemedText themeColor="textSecondary">No routines yet. Create one or save a finished workout as a routine.</ThemedText>
          ) : (
            routines.map((r) => (
              <Card key={r.id}>
                <Row>
                  <ThemedText type="smallBold">{r.name}</ThemedText>
                  {r.archived ? <ThemedText type="small">Archived</ThemedText> : null}
                  <SyncBadge meta={r} />
                </Row>
                <ThemedText type="small" themeColor="textSecondary">
                  {r.exercises.length} {r.exercises.length === 1 ? 'exercise' : 'exercises'}
                </ThemedText>
                <Row>
                  <SmallButton label="Start" accessibilityLabel={`Start ${r.name}`} disabled={r.archived} onPress={() => start(r.id)} />
                  <SmallButton
                    label="Edit"
                    accessibilityLabel={`Edit ${r.name}`}
                    onPress={() => router.push({ pathname: '/training/routine/[id]', params: { id: r.id } })}
                  />
                </Row>
              </Card>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six * 2 },
  day: { minWidth: 96 },
});
