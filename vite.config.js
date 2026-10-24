// Havok's ES build loads its .wasm next to itself (import.meta.url): Vite must not pre-bundle it
export default { optimizeDeps: { exclude: ["@babylonjs/havok"] } };
