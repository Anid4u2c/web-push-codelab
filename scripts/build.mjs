import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const output = 'app/dist';
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const result = await build({
  entryPoints: ['src/main.mjs'], bundle: true, minify: true,
  format: 'esm', target: 'es2022', outdir: output,
  entryNames: 'main-[hash]', metafile: true
});
const entry = Object.entries(result.metafile.outputs).find(([, file]) => file.entryPoint)[0];
const css = await readFile('app/styles/index.css');
const cssName = `index-${createHash('sha256').update(css).digest('hex').slice(0,12)}.css`;
const html = (await readFile('app/index.html', 'utf8'))
  .replace('dist/main.js', entry.slice(output.length + 1))
  .replace('styles/index.css', `styles/${cssName}`);
await writeFile(`${output}/index.html`, html);
for (const asset of ['styles', 'images', 'sw.js', 'favicon.svg', 'favicon.ico', '404.html']) {
  await cp(`app/${asset}`, `${output}/${asset}`, { recursive: true });
}
await writeFile(`${output}/styles/${cssName}`, css);
console.log(`Built ${entry}`);
