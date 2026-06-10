import { defineConfig } from 'tsup';

// Production build (to-do «Прод / деплой»). Bundling our own sources (not plain tsc)
// is forced by ESM: the codebase uses extensionless relative imports (tsconfig
// `moduleResolution: Bundler`), which `node` can't load from a bare tsc emit.
//
// Dependencies stay EXTERNAL (tsup's default) and ship as pruned node_modules in the
// image. A full self-contained bundle was tried and reverted: converting the dep
// graph breaks runtime identity/load assumptions (node-cron touches __dirname at
// load; grammY's fetch stack failed `instanceof AbortSignal` against the bundled
// polyfill). External deps keep the runtime exactly what dev runs under tsx —
// boring beats ~60MB of image size here.
export default defineConfig({
  // Two entries: the bot itself and the startup migrator (run by the container
  // entrypoint before the bot — see docker-entrypoint.sh).
  entry: ['src/index.ts', 'src/migrate.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true, // pairs with NODE_OPTIONS=--enable-source-maps in the image
  clean: true,
});
