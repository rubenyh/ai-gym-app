// Integration tests against the LOCAL Supabase stack (npm run test:integration). Plain Node environment
// instead of the jest-expo preset, which replaces global fetch with a stub that supabase-js cannot use.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.integration.test.ts'],
  transform: { '\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  globals: { __SYNC_INTEGRATION__: true },
};
