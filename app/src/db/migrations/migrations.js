// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_m1_account_cache.sql';
import m0001 from './0001_m2_training_sync.sql';
import m0002 from './0002_m3_account_settings_sync.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002
    }
  }
  