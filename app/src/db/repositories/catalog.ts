import { and, asc, eq, sql, type SQL } from 'drizzle-orm';

import { customExerciseDoc, type CatalogExercise, type CustomExerciseDoc, type ExerciseKey } from '@/domain/contracts';
import type { CatalogFilter, CatalogRepository, ExerciseDetail, ExerciseSummary } from '@/domain/repositories';

import * as s from '../schema';
import { enqueue, parse, type RepoCtx } from './context';
import type { Db } from './docs';
import { NotFoundError } from './errors';

export type CatalogAsset = { version: number; count: number; source: { url: string; sha: string }; exercises: CatalogExercise[] };

const ATTRIBUTION = 'Exercise data: hasaneyldrm/exercises-dataset (MIT). Media not included.';

/** Seeds or replaces the read-only catalog when the bundled version changes (first open, app update). */
export function seedCatalog(db: Db, asset: CatalogAsset): void {
  const meta = db.select().from(s.catalogMeta).where(eq(s.catalogMeta.id, 1)).get();
  if (meta?.version === asset.version && meta.count === asset.exercises.length) return;
  db.transaction((tx) => {
    tx.delete(s.catalogExercises).run();
    for (const e of asset.exercises) {
      tx.insert(s.catalogExercises)
        .values({
          sourceId: e.sourceId,
          name: e.name,
          bodyPart: e.bodyPart,
          target: e.target,
          primaryMuscles: e.primaryMuscles,
          secondaryMuscles: e.secondaryMuscles,
          equipment: e.equipment,
          instructions: e.instructions,
          loadMode: e.loadMode,
        })
        .run();
    }
    tx.insert(s.catalogMeta)
      .values({ id: 1, version: asset.version, count: asset.exercises.length })
      .onConflictDoUpdate({ target: s.catalogMeta.id, set: { version: asset.version, count: asset.exercises.length } })
      .run();
  });
}

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const hasValue = (column: SQL | unknown, value: string) =>
  sql`EXISTS (SELECT 1 FROM json_each(${column}) WHERE value = ${value})`;

export function createCatalogRepository(ctx: RepoCtx): CatalogRepository {
  const { db } = ctx;

  function filters(table: typeof s.catalogExercises | typeof s.customExercises, f: CatalogFilter): SQL[] {
    const out: SQL[] = [];
    if (f.query?.trim()) out.push(sql`${table.name} LIKE ${like(f.query.trim())} ESCAPE '\\'`);
    if (f.muscle) out.push(sql`(${hasValue(table.primaryMuscles, f.muscle)} OR ${hasValue(table.secondaryMuscles, f.muscle)})`);
    if (f.equipment) out.push(hasValue(table.equipment, f.equipment));
    return out;
  }

  const customSummary = (r: typeof s.customExercises.$inferSelect): ExerciseSummary => ({
    key: `custom:${r.id}`,
    name: r.name,
    primaryMuscles: r.primaryMuscles,
    equipment: r.equipment,
    loadMode: r.loadMode,
    custom: true,
    archived: r.archived,
  });

  function distinct(column: 'primary_muscles' | 'equipment'): string[] {
    const rows = db.all<{ value: string }>(sql`
      SELECT DISTINCT j.value AS value FROM catalog_exercises c, json_each(c.${sql.raw(column)}) j
      UNION SELECT DISTINCT j.value FROM custom_exercises c, json_each(c.${sql.raw(column)}) j WHERE c.deleted = 0
      ORDER BY 1`);
    return rows.map((r) => r.value);
  }

  return {
    search(filter, limit = 50) {
      const custom = db
        .select()
        .from(s.customExercises)
        .where(
          and(
            eq(s.customExercises.deleted, false),
            filter.includeArchived ? undefined : eq(s.customExercises.archived, false),
            ...filters(s.customExercises, filter),
          ),
        )
        .orderBy(asc(s.customExercises.name))
        .limit(limit)
        .all()
        .map(customSummary);
      const catalog = db
        .select()
        .from(s.catalogExercises)
        .where(and(...filters(s.catalogExercises, filter)))
        .orderBy(asc(s.catalogExercises.name))
        .limit(limit)
        .all()
        .map(
          (r): ExerciseSummary => ({
            key: `catalog:${r.sourceId}`,
            name: r.name,
            primaryMuscles: r.primaryMuscles,
            equipment: r.equipment,
            loadMode: r.loadMode,
            custom: false,
            archived: false,
          }),
        );
      // Personal exercises first, then catalog, both alphabetical.
      return [...custom, ...catalog].slice(0, limit);
    },

    get(key: ExerciseKey): ExerciseDetail | null {
      const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      if (kind === 'catalog') {
        const r = db.select().from(s.catalogExercises).where(eq(s.catalogExercises.sourceId, id)).get();
        if (!r) return null;
        return {
          key,
          name: r.name,
          primaryMuscles: r.primaryMuscles,
          secondaryMuscles: r.secondaryMuscles,
          equipment: r.equipment,
          instructions: r.instructions,
          loadMode: r.loadMode,
          custom: false,
          archived: false,
          mediaUri: null,
          attribution: ATTRIBUTION,
        };
      }
      if (kind === 'custom') {
        // Archived (and not-yet-synced deleted) definitions stay readable for routines/history.
        const r = db.select().from(s.customExercises).where(eq(s.customExercises.id, id)).get();
        if (!r) return null;
        return { ...customSummary(r), secondaryMuscles: r.secondaryMuscles, instructions: r.instructions, mediaUri: null, attribution: null };
      }
      return null;
    },

    muscles: () => distinct('primary_muscles'),
    equipment: () => distinct('equipment'),

    saveCustom(input) {
      const doc: CustomExerciseDoc = parse(customExerciseDoc, { ...input, id: input.id ?? ctx.newId() }, 'custom exercise');
      return ctx.mutate((tx) => {
        const existing = tx.select({ deleted: s.customExercises.deleted }).from(s.customExercises).where(eq(s.customExercises.id, doc.id)).get();
        if (existing?.deleted) throw new NotFoundError('Custom exercise');
        const now = ctx.now().toISOString();
        const values = { ...doc, updatedAt: now };
        tx.insert(s.customExercises).values(values).onConflictDoUpdate({ target: s.customExercises.id, set: values }).run();
        enqueue(ctx, tx, 'custom_exercise', doc.id, 'upsert');
        return doc;
      });
    },

    setCustomArchived(id, archived) {
      ctx.mutate((tx) => {
        const r = tx
          .update(s.customExercises)
          .set({ archived, updatedAt: ctx.now().toISOString() })
          .where(and(eq(s.customExercises.id, id), eq(s.customExercises.deleted, false)))
          .returning({ id: s.customExercises.id })
          .all();
        if (!r.length) throw new NotFoundError('Custom exercise');
        enqueue(ctx, tx, 'custom_exercise', id, 'upsert');
      });
    },
  };
}
