/*
 * Turns the six exported prototype screens into plain static pages.
 *
 * The export nests each screen inside a self-extracting HTML bundle: an outer
 * bundle holding six page bundles, each of which holds its own base64 assets and
 * a JSON-encoded copy of the real source. This script unpacks both levels once,
 * writes the fonts out as real files, rewrites the opaque asset ids to paths,
 * and emits one page per screen against public/dc.js.
 *
 * Run it with `node build.mjs <path-to-export.html>`. The output is committed,
 * so the deploy does not depend on the export file being present.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const source = process.argv[2];
if (!source) { console.error('usage: node build.mjs <export.html>'); process.exit(1); }

const OUT = path.join(import.meta.dirname, 'public');
const FONTS = path.join(OUT, 'fonts');
fs.mkdirSync(FONTS, { recursive: true });

const ROUTES = {
  'Landing.dc.html': { file: 'index.html', route: '/' },
  'CommandCenter.dc.html': { file: 'command-center.html', route: '/command-center' },
  'Alerts.dc.html': { file: 'alerts.html', route: '/alerts' },
  'FlightHistory.dc.html': { file: 'flight-history.html', route: '/flight-history' },
  'DataRequest.dc.html': { file: 'data-request.html', route: '/data-request' },
  'PrivacyAudit.dc.html': { file: 'privacy-audit.html', route: '/privacy-audit' }
};

function manifestOf(html) {
  const m = /<script type="__bundler\/manifest">\s*(\{[\s\S]*?\})\s*<\/script>/.exec(html);
  return m ? JSON.parse(m[1]) : {};
}

function decode(entry) {
  const raw = Buffer.from(entry.data, 'base64');
  return entry.compressed ? zlib.gunzipSync(raw) : raw;
}

// The dashes and emoji are banned in this repo's copy, so the conversion is the
// one place that can guarantee none survive from the export.
function cleanText(s) {
  return s
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/‑/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '');
}

/*
 * The export styles every element inline, which a stylesheet cannot override
 * without `!important` on a selector that names the inline value. Matching on
 * those values directly would be unreadable and would break silently the first
 * time a padding changed, so the layout containers are given class hooks here
 * instead and public/responsive.css addresses those.
 *
 * Every rule asserts how many elements it expects to tag. A new export that
 * reshapes a screen then fails the build rather than shipping a phone layout
 * that nobody looked at.
 */
const LAYOUT_HOOKS = [
  // The left rail on the five dashboard screens. Becomes a scrolling top strip.
  { cls: 'ca-nav', min: 0, test: (tag, a) => tag === 'nav' && a.includes('width:240px') },
  // Sticky detail columns beside a list: 380px, 420px and 340px across screens.
  { cls: 'ca-side', min: 0, test: (tag, a) => tag !== 'nav' && /width:\d{3}px;flex-shrink:0/.test(a) },
  // The page shell, a row of rail plus content. Becomes a column.
  { cls: 'ca-shell', min: 0, test: (tag, a) => a.includes('min-height:100vh') && a.includes('flex-direction:row') },
  // The fixed-height bar above each dashboard.
  { cls: 'ca-topbar', min: 0, test: (tag, a) => a.includes('height:64px') && a.includes('flex-shrink:0') },
  // Every multi-column grid. Collapses to one or two columns.
  { cls: 'ca-grid', min: 0, test: (tag, a) => a.includes('grid-template-columns:') },
  // Centred content wrappers on the landing page.
  { cls: 'ca-wrap', min: 0, test: (tag, a) => /max-width:(680|760|920|1080)px/.test(a) },
  // Anything with the 40px desktop gutter, so the side padding can shrink.
  { cls: 'ca-gutter', min: 0, test: (tag, a) => /padding:[^;"]*\b40px/.test(a) },
  { cls: 'ca-hero', min: 0, test: (tag, a) => a.includes('padding:100px 40px 72px 40px') },
  { cls: 'ca-sitehead', min: 0, test: (tag, a) => a.includes('padding:20px 40px') && a.includes('justify-content:space-between') },
  // The map panel, which is 560px tall and much too deep on a phone.
  { cls: 'ca-map', min: 0, test: (tag, a) => a.includes('height:560px') },
  // The three controls floating over the map. On a phone they cover most of it,
  // so they are lifted out of the overlay and stacked underneath instead.
  { cls: 'ca-overlay', min: 0, test: (tag, a) => a.includes('position:absolute') && (a.includes('top:14px') || a.includes('bottom:14px')) },
  // Tables get a horizontal scroller rather than being crushed.
  { cls: 'ca-table', min: 0, test: (tag) => tag === 'sc-raw-table' }
];

const OPEN_TAG = /<([a-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;

function addClass(html, test, cls) {
  let count = 0;
  const out = html.replace(OPEN_TAG, (whole, tag, attrs) => {
    const style = /style="([^"]*)"/.exec(attrs);
    if (!test(tag.toLowerCase(), (style ? style[1] : '') + ' ' + attrs)) return whole;
    count++;
    if (/\sclass="/.test(attrs)) return `<${tag}${attrs.replace(/\sclass="/, ` class="${cls} `)}>`;
    return `<${tag} class="${cls}"${attrs}>`;
  });
  return { html: out, count };
}

function tagLayout(html, screen) {
  let total = 0;
  for (const hook of LAYOUT_HOOKS) {
    const res = addClass(html, hook.test, hook.cls);
    if (res.count < hook.min) {
      throw new Error(`${screen}: expected at least ${hook.min} ${hook.cls} elements, tagged ${res.count}`);
    }
    html = res.html;
    total += res.count;
  }
  if (total === 0) throw new Error(`${screen}: tagged no layout containers`);
  return html;
}

const outer = fs.readFileSync(source, 'utf8');
const pages = Object.values(manifestOf(outer)).map((e) => decode(e).toString('utf8'));
if (pages.length !== 6) throw new Error(`expected 6 screens, found ${pages.length}`);

const written = [];

for (const page of pages) {
  const assets = manifestOf(page);
  const tpl = /<script type="__bundler\/template">\s*("[\s\S]*?")\s*<\/script>/.exec(page);
  if (!tpl) throw new Error('screen has no template');
  let doc = JSON.parse(tpl[1]);

  // Fonts are shared across screens but each export gives them a fresh id, so
  // they are written under a content hash and six copies collapse into one file.
  for (const [id, entry] of Object.entries(assets)) {
    if (entry.mime !== 'font/woff2') continue;
    if (!doc.includes(id)) continue;
    const bytes = decode(entry);
    const name = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16) + '.woff2';
    fs.writeFileSync(path.join(FONTS, name), bytes);
    doc = doc.split(`"${id}"`).join(`"/fonts/${name}"`);
  }

  const title = cleanText(/<title>([\s\S]*?)<\/title>/.exec(doc)[1]);
  const helmet = /<helmet>([\s\S]*?)<\/helmet>/.exec(doc)[1];
  const body = /<\/helmet>([\s\S]*?)<\/x-dc>/.exec(doc)[1];
  const logic = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(doc)[1];

  const target = ROUTES[routeKeyFor(title)];
  if (!target) throw new Error(`no route for screen "${title}"`);

  let out = template({ title, helmet, body: tagLayout(body, title), logic });
  for (const [from, to] of Object.entries(ROUTES)) {
    out = out.split(`href="${from}"`).join(`href="${to.route}"`);
  }
  fs.writeFileSync(path.join(OUT, target.file), cleanText(out));
  written.push(`${target.route} -> public/${target.file}`);
}

function routeKeyFor(t) {
  const n = t.toLowerCase();
  if (n.includes('landing')) return 'Landing.dc.html';
  if (n.includes('command')) return 'CommandCenter.dc.html';
  if (n.includes('alert')) return 'Alerts.dc.html';
  if (n.includes('flight')) return 'FlightHistory.dc.html';
  if (n.includes('request')) return 'DataRequest.dc.html';
  if (n.includes('privacy')) return 'PrivacyAudit.dc.html';
  return null;
}

function template({ title, helmet, body, logic }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Civic Air is a prototype for accountable low-altitude drone coordination in cities. All data shown is simulated.">
<title>${title}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/motion.css">\n<link rel="stylesheet" href="/responsive.css">
${helmet.trim()}
</head>
<body>
<div id="dc-root"></div>
<template id="dc-template">${body}</template>
<script src="/dc.js"></script>
<script>
${logic.trim()}
DC.mount(Component);
</script>
</body>
</html>
`;
}

console.log(written.sort().join('\n'));
