// Builds dist/index.html (standalone page for GitHub Pages) and dist/artifact.html (Claude artifact body).
const fs = require('fs');
let body = fs.readFileSync('src/app.html', 'utf8');
body = body.replace('/*__ENGINE__*/', () => fs.readFileSync('engine.js', 'utf8'))
           .replace('/*__WRITER__*/', () => fs.readFileSync('writer.js', 'utf8'))
           .replace('/*__SAMPLE__*/null', () => fs.readFileSync('test/sample.json', 'utf8'));
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/artifact.html', body);
const head = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="description" content="Match a microplan to DIGIT HCM boundary codes and fill the console unified template.">' +
  '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>';
// move the page's own <title>/<link>/<style> into <head>
const m = body.match(/^([\s\S]*?<\/style>)/);
fs.writeFileSync('dist/index.html', head + m[1] + '</head><body>' + body.slice(m[1].length) + '</body></html>');
console.log('built dist/index.html', (fs.statSync('dist/index.html').size / 1024).toFixed(0) + ' KB');
