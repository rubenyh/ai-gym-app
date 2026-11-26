import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

import { PET_FRAME, petStageName } from './pet';
import { RivePet } from './rive-pet';

export { petStageName };

/*
 * Character placeholders (GAME-02). Final pet/coach art and personality are open item O-03; rating.riv is
 * an MIT sample (assets/rive/ATTRIBUTION.md) used only to prove the Rive pipeline. Animation projects game
 * state, it never owns it: the static view below is the always-usable fallback (NFR-06).
 */

function StaticPet({ stage }: { stage: number }) {
  const name = petStageName(stage);
  return (
    <View
      testID="pet-static"
      accessible
      accessibilityLabel={`Pet, stage ${stage}: ${name} (placeholder art)`}
      style={[styles.frame, styles.pet]}>
      <ThemedText type="title">{'●'.repeat(Math.max(stage, 1))}</ThemedText>
      <ThemedText type="smallBold">{name}</ThemedText>
    </View>
  );
}

/** Pet for the current stage. Reduced motion or any Rive error shows the static, labelled view. */
export function PetCharacter({ stage, forceStatic = false }: { stage: number; forceStatic?: boolean }) {
  const reduceMotion = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const label = (
    <ThemedText type="small" themeColor="textSecondary">
      {petStageName(stage)} · placeholder character (final art pending)
    </ThemedText>
  );
  if (forceStatic || reduceMotion || failed) return <View style={styles.wrap}><StaticPet stage={stage} />{label}</View>;
  return (
    <View style={styles.wrap}>
      <RivePet stage={stage} onFail={() => setFailed(true)} />
      {label}
    </View>
  );
}

/** Visually distinct coach placeholder (static; exported for the coach feature). */
export function CoachCharacter({ size = 96 }: { size?: number }) {
  return (
    <View
      testID="coach-character"
      accessible
      accessibilityLabel="Coach (placeholder character)"
      style={[styles.coach, { width: size, height: size, borderRadius: size / 4 }]}>
      <ThemedText type="subtitle" style={styles.coachText}>
        C
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing.one },
  frame: PET_FRAME,
  pet: { alignItems: 'center', justifyContent: 'center', borderRadius: 60, backgroundColor: '#FFE8A3' },
  coach: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#2F6FED' },
  coachText: { color: '#ffffff' },
});
