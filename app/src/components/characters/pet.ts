export const PET_FRAME = { width: 160, height: 120 };

const PET_STAGE_NAMES = ['Egg', 'Hatchling', 'Sprout', 'Champion'];

export function petStageName(stage: number): string {
  return PET_STAGE_NAMES[Math.min(Math.max(stage, 1), PET_STAGE_NAMES.length) - 1];
}
