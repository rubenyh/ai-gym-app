module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Drizzle migrations import .sql files as strings (https://orm.drizzle.team/docs/connect-expo-sqlite).
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
