// Build: inline the engine, the content and the app into one HTML file (dist/breaking-bellman.html).
// The engine source is also kept as text so the page can start Web Workers from a blob URL.
// node build.mjs              -> a complete HTML document: open it from disk or serve it (npm start).
// node build.mjs --fragment   -> the page body only (for hosts that add their own <html> skeleton).
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

export const ENGINE_FILES = [
  'src/core/rng.js', 'src/core/nn.js',
  'src/worlds/bandit.js', 'src/worlds/cliff.js', 'src/worlds/cartpole.js', 'src/worlds/mirage.js',
  'src/worlds/goalgrid.js', 'src/worlds/pendulum.js', 'src/worlds/reach.js', 'src/worlds/fork.js', 'src/worlds/fetch.js',
  'src/agents/value.js', 'src/agents/pg.js', 'src/agents/ac.js',
  'src/sim/run.js', 'src/sim/autopsy.js',
];
const CONTENT_FILES = ['web/content.js', 'web/content2.js', 'web/measured.js', 'web/content3.js', 'web/expert.js', 'web/papers.js', 'web/wonder.js', 'web/fetch-level.js'];
const APP_FILES = ['web/llm.js', 'web/scenes.js', 'web/pagemd.js', 'web/app.js'];

const exists = (f) => fs.existsSync(path.join(root, f));
const join = (files) => files.filter(exists).map(read).join('\n;\n');
const noClose = (s) => s.replace(/<\/script/gi, '<\\/script');

const body = read('web/page.html')
  .replace('/*@ENGINE@*/', () => noClose(join(ENGINE_FILES)))
  .replace('/*@CONTENT@*/', () => join(CONTENT_FILES))
  .replace('/*@APP@*/', () => join(APP_FILES))
  .replace('/*@CSS@*/', () => read('web/style.css'))
  .replace('/*@FONTS@*/', () => (exists('web/fonts/fonts.css') ? read('web/fonts/fonts.css').replace(/url\(\.\/([\w.-]+\.woff2)\)/g,
    (m, file) => 'url(data:font/woff2;base64,' + fs.readFileSync(path.join(root, 'web/fonts', file)).toString('base64') + ')') : ''));

const fragment = process.argv.includes('--fragment');
// MathJax (Apache-2.0, web/vendor/MATHJAX-LICENSE.txt) rides along as text, so the math view works offline; the page
// starts it from a blob URL only when a math box opens. The fragment build skips it and loads MathJax from cdnjs.
const MATHJAX = 'web/vendor/mathjax-tex-svg-3.2.2.min.js';
const mathjax = !fragment && exists(MATHJAX) ? '\n<script type="text/plain" id="mathjax-src">' + noClose(read(MATHJAX)) + '</script>\n' : '';
const page = fragment ? body
  : '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    + '<meta name="description" content="Breaking Bellman: learn reinforcement learning by breaking it. Real algorithms train in your browser and fail in front of you.">\n'
    + '</head>\n<body>\n' + body + mathjax + '\n</body>\n</html>\n';
const out = fragment ? 'dist/breaking-bellman.fragment.html' : 'dist/breaking-bellman.html';
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, out), page);
console.log(out, (page.length / 1024).toFixed(1), 'KiB');
