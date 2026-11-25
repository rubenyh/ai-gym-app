import { defineConfig } from 'drizzle-kit';

// Local SQLite schema only (Supabase migrations live in ../supabase/migrations).
// Regenerate after editing src/db/schema.ts: npm run db:generate
export default defineConfig({
  dialect: 'sqlite',
  driver: 'expo',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
});
