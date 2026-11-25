// Rive files are bundled by Metro as assets (metro.config.js) and resolve to an asset id.
declare module '*.riv' {
  const assetId: number;
  export default assetId;
}
