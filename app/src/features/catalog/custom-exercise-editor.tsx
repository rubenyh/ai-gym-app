import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Choice, FormMessage, TextField } from '@/components/form';
import { Screen } from '@/components/ui/layout';
import { useRepositories } from '@/db/repositories-context';
import { customExerciseDoc, type LoadMode } from '@/domain/contracts';

const LOAD_MODES = [
  { value: 'external', label: 'External load' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'assisted', label: 'Assisted' },
] as const;

const splitList = (text: string, sep: RegExp) => text.split(sep).map((s) => s.trim()).filter(Boolean);

/** Create/edit a personal exercise (CAT-02). Personal records never enter the global catalog. */
export function CustomExerciseEditor({ id }: { id?: string }) {
  const repos = useRepositories();
  // Snapshot once: this is an edit form, not a live view.
  const [existing] = useState(() => (id ? repos.catalog.get(`custom:${id}`) : null));
  const [name, setName] = useState(existing?.name ?? '');
  const [primary, setPrimary] = useState(existing?.primaryMuscles.join(', ') ?? '');
  const [secondary, setSecondary] = useState(existing?.secondaryMuscles.join(', ') ?? '');
  const [equipment, setEquipment] = useState(existing?.equipment.join(', ') ?? '');
  const [instructions, setInstructions] = useState(existing?.instructions.join('\n') ?? '');
  const [loadMode, setLoadMode] = useState<LoadMode>(existing?.loadMode ?? 'external');
  const [error, setError] = useState<string | null>(null);

  if (id && !existing) return <Screen><FormMessage text="This custom exercise was not found on this device." /></Screen>;

  function save() {
    const doc = {
      name: name.trim(),
      primaryMuscles: splitList(primary, /,/),
      secondaryMuscles: splitList(secondary, /,/),
      equipment: splitList(equipment, /,/),
      instructions: splitList(instructions, /\n/),
      loadMode,
      archived: existing?.archived ?? false,
    };
    const check = customExerciseDoc.omit({ id: true }).safeParse(doc);
    if (!check.success) {
      setError(doc.name ? 'Check the fields: at most 10 muscles/equipment items and 30 instruction lines.' : 'Enter a name.');
      return;
    }
    try {
      const saved = repos.catalog.saveCustom(id ? { ...check.data, id } : check.data);
      router.replace({ pathname: '/training/exercise', params: { key: `custom:${saved.id}` } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Screen>
      <TextField label="Name" value={name} onChangeText={setName} maxLength={100} />
      <TextField label="Primary muscles (comma separated)" value={primary} onChangeText={setPrimary} />
      <TextField label="Secondary muscles (comma separated)" value={secondary} onChangeText={setSecondary} />
      <TextField label="Equipment (comma separated)" value={equipment} onChangeText={setEquipment} />
      <TextField label="Instructions (one step per line)" value={instructions} onChangeText={setInstructions} multiline />
      <Choice label="Load" options={LOAD_MODES} value={loadMode} onChange={setLoadMode} />
      <FormMessage text={error} />
      <Button label={id ? 'Save changes' : 'Create exercise'} onPress={save} />
    </Screen>
  );
}
