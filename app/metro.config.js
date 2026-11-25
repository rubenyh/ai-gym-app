// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Rive runtime files bundled as assets (https://rive.app/docs/runtimes/react-native/loading-rive-files).
config.resolver.assetExts.push('riv');

module.exports = config;
