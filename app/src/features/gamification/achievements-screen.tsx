import { View } from 'react-native';

import { petStageName, PetCharacter } from '@/components/characters/characters';
import { FormScreen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Muted, PENDING_LABEL, Section } from '@/features/progress/ui';
import { useProgressData } from '@/features/progress/use-progress-data';

import { badgeDescription, badgeLabel, rules } from './rules';

/** Badges come only from the server summary; locked ones list their rule (GAME-01/02). */
export function AchievementsScreen() {
  const { summary, progression: p } = useProgressData();
  const unlocked = new Map((summary?.badges ?? []).map((b) => [b.badgeId, b.unlockedAt]));

  return (
    <FormScreen title="Achievements">
      <Section title="Pet growth">
        <PetCharacter stage={p.petStage} />
        {rules.petStageLevels.map((level, i) => {
          const stage = i + 1;
          const open = p.petStage >= stage;
          return (
            <ThemedText key={level} type="small" accessibilityLabel={`${petStageName(stage)}, level ${level}, ${open ? 'unlocked' : 'locked'}`}>
              {open ? '✓' : '🔒'} {petStageName(stage)} — level {level}
            </ThemedText>
          );
        })}
        <Muted>Unlocked appearances stay unlocked. There is no penalty for missed workouts.</Muted>
      </Section>

      <Section title="Badges">
        {!summary && <Muted>Badges appear after your rewards sync with the server · {PENDING_LABEL}</Muted>}
        {rules.badges.map((b) => {
          const at = unlocked.get(b.id);
          return (
            <View key={b.id} accessible accessibilityLabel={`${badgeLabel(b.id)}: ${at ? 'unlocked' : 'locked'}. ${badgeDescription(b)}`}>
              <ThemedText type={at ? 'smallBold' : 'small'}>
                {at ? '🏅' : '🔒'} {badgeLabel(b.id)}
              </ThemedText>
              <Muted>{at ? `Unlocked ${at.slice(0, 10)}` : badgeDescription(b)}</Muted>
            </View>
          );
        })}
      </Section>

      <Section title="Level">
        <ThemedText type="small">
          Level {p.level} · {p.totalXp} XP{p.pendingXp ? ` (+${p.pendingXp} ${PENDING_LABEL.toLowerCase()})` : ''}
        </ThemedText>
        <Muted>Qualifying workouts (confirmed): {summary?.qualifyingSessions ?? 0}</Muted>
      </Section>
    </FormScreen>
  );
}
