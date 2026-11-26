// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Rive runtime files bundled as assets (https://rive.app/docs/runtimes/react-native/loading-rive-files).
config.resolver.assetExts.push('riv');

// expo-sqlite on web runs wa-sqlite from a bundled .wasm file.
config.resolver.assetExts.push('wasm');

// Drizzle local-database migrations are bundled as .sql source (inlined by babel-plugin-inline-import).
config.resolver.sourceExts.push('sql');

// expo-sqlite on web needs SharedArrayBuffer, which browsers expose only to cross-origin isolated pages.
// Dev server only: a deployed web build must send the same two headers from its host.
const enhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, metroServer) => {
  const enhanced = enhanceMiddleware ? enhanceMiddleware(middleware, metroServer) : middleware;
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return enhanced(req, res, next);
  };
};

module.exports = config;
