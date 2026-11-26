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
// Set on every response of this process, not via config.server.enhanceMiddleware: Expo CLI answers `/` from its
// manifest middleware ahead of Metro, so `/` (the URL people open first) never got them and loaded non-isolated.
const http = require('node:http');
const writeHead = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function (...args) {
  if (!this.headersSent && !this.hasHeader('Cross-Origin-Opener-Policy')) {
    this.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    this.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  }
  return writeHead.apply(this, args);
};

module.exports = config;
