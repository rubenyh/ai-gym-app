import type { AggregateType } from '@/domain/contracts';
import type { SyncStatus } from '@/services/sync/engine';

const KIND: Record<AggregateType, string> = {
  custom_exercise: 'Custom exercise',
  routine: 'Routine',
  program: 'Program',
  session: 'Workout',
  body_weight: 'Body weight entry',
  coach_approval: 'Coach plan approval',
};

/** "Routine: Push A" — names only, never private notes or values. */
export function describeChange(type: AggregateType, doc: unknown): string {
  const name = doc && typeof doc === 'object' && 'name' in doc && typeof doc.name === 'string' ? doc.name : null;
  return name ? `${KIND[type]}: ${name}` : KIND[type];
}

export function phaseLabel(status: SyncStatus): string {
  switch (status.phase) {
    case 'syncing':
      return 'Syncing…';
    case 'retry-scheduled':
      return `Offline or server unreachable. Retrying${status.nextRetryAt ? ` at ${new Date(status.nextRetryAt).toLocaleTimeString()}` : ''}.`;
    case 'paused-auth':
      return 'Sync paused: sign in again to continue.';
    case 'stopped':
      return 'Sync stopped.';
    default:
      return 'Up to date with the last sync.';
  }
}
