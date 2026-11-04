#!/usr/bin/env node
// Builds the TypeScript sources:
//   src/client/main.ts → public/app.js  (one bundle for the browser)
//   src/shared/*.ts    → out/shared/*.js (CommonJS, for server.js and the tests)
// `node scripts/build.mjs --watch` rebuilds on every change.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const builds = [
  {
    entryPoints: ['src/client/main.ts'],
    outfile: 'public/app.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    sourcemap: 'linked',
  },
  {
    entryPoints: ['src/shared/lines.ts', 'src/shared/ledger.ts'],
    outdir: 'out/shared',
    format: 'cjs',
    platform: 'node',
    target: 'node18',
  },
];

const log = { name: 'build', setup: (b) => b.onEnd((r) => r.errors.length || console.log(`built ${b.initialOptions.outfile || b.initialOptions.outdir}`)) };

if (watch) {
  for (const options of builds) await (await esbuild.context({ ...options, plugins: [log], logLevel: 'warning' })).watch();
  console.log('watching src/ for changes…');
} else {
  await Promise.all(builds.map((options) => esbuild.build({ ...options, logLevel: 'warning' })));
}
