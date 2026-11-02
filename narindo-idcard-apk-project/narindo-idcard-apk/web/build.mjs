// Build offline: menghasilkan SATU file HTML mandiri (dist/narindo-idcard-generator.html)
// Pakai: node build.mjs   (tidak perlu Vite; cukup esbuild + tailwindcss terpasang)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NODE_PATHS = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const twDir = path.dirname(require.resolve('tailwindcss/package.json', { paths: [process.cwd(), ...NODE_PATHS] }));
const { compile } = await import(path.join(twDir, 'dist/lib.mjs'));

const js = await esbuild.build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  format: 'esm',
  minify: true,
  target: ['es2020'],
  jsx: 'automatic',
  loader: { '.jpg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.css': 'empty' },
  nodePaths: NODE_PATHS,
  define: { 'process.env.NODE_ENV': '"production"' },
  write: false,
  logLevel: 'warning',
});
const jsCode = js.outputFiles[0].text;

// Tailwind v4: kumpulkan kandidat class dari source lalu compile
const srcFiles = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (/\.(tsx?|css)$/.test(e.name)) srcFiles.push(p);
});
walk('src');
const candidates = new Set();
for (const f of srcFiles) for (const t of fs.readFileSync(f, 'utf8').split(/[\s"'`{}<>]+/)) if (t) candidates.add(t);
const cssIn = fs.readFileSync('src/index.css', 'utf8');
const compiler = await compile(cssIn, {
  base: process.cwd(),
  loadStylesheet: async (id, base) => {
    const file = id === 'tailwindcss' ? path.join(twDir, 'index.css') : path.resolve(base, id);
    return { path: file, base: path.dirname(file), content: fs.readFileSync(file, 'utf8') };
  },
});
let css = compiler.build([...candidates]);
css = (await esbuild.transform(css, { loader: 'css', minify: true })).code;

const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Narindo ID Card Generator</title>
<meta name="description" content="Generator ID Card karyawan Narindo × Telkomsel">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script type="module">${jsCode.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/narindo-idcard-generator.html', html);
console.log('OK dist/narindo-idcard-generator.html', (html.length / 1024).toFixed(0) + ' KB');
