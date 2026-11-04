#!/usr/bin/env node
// Builds the TypeScript sources:
//   src/client/main.ts → public/app.js  (one bundle for the browser)
//   src/{shared,server,electron}/*.ts → out/…/*.js  (CommonJS, file for file, for Node and Electron)
// `node scripts/build.mjs --watch` rebuilds on every change.
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const watch = process.argv.includes('--watch');

// Writes only the files whose contents changed. The server compares a saved PDF's age with
// out/server/invoice-template.js, so rewriting unchanged files would make every PDF stale.
const writeChanged = {
  name: 'write-changed',
  setup(build) {
    build.onEnd((result) => {
      let written = 0;
      for (const { path: file, contents } of result.outputFiles || []) {
        try {
          if (Buffer.compare(fs.readFileSync(file), contents) === 0) continue;
        } catch {}
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents);
        written++;
      }
      if (watch && written) console.log(`rebuilt ${written} file${written === 1 ? '' : 's'} (${build.initialOptions.outfile || build.initialOptions.outdir})`);
    });
  },
};

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
    entryPoints: ['src/shared/*.ts', 'src/server/*.ts', 'src/electron/*.ts'],
    outbase: 'src',
    outdir: 'out',
    format: 'cjs',
    platform: 'node',
    target: 'node22',
  },
];

const options = (o) => ({ ...o, write: false, plugins: [writeChanged], logLevel: 'warning' });
if (watch) {
  for (const o of builds) await (await esbuild.context(options(o))).watch();
  console.log('watching src/ for changes…');
} else {
  const results = await Promise.all(builds.map((o) => esbuild.build(options(o))));
  if (results.some((r) => r.errors.length)) process.exit(1);
}
