/*
 * Junta os arquivos que a página do streaming precisa num único preload
 * e copia o motor de sincronização para a interface.
 * Roda sozinho antes de `npm start` e `npm run dist`.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'build');
fs.mkdirSync(out, { recursive: true });

// Fonte do motor: a cópia do servidor (se o projeto estiver completo) ou a do app
const serverEngine = path.join(root, '..', 'server', 'public', 'sync-engine.js');
const appEngine = path.join(root, 'src', 'shared', 'sync-engine.js');
if (fs.existsSync(serverEngine)) {
  fs.mkdirSync(path.dirname(appEngine), { recursive: true });
  fs.copyFileSync(serverEngine, appEngine);
}
const engine = fs.readFileSync(appEngine, 'utf8');

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const preload = [
  '/* GERADO por scripts/bundle.js — não edite aqui, edite src/ */',
  engine,
  read('src/stream/stream-sync.js'),
  read('src/stream/stream-preload.js'),
].join('\n;\n');

fs.writeFileSync(path.join(out, 'stream-preload.js'), preload);
fs.writeFileSync(path.join(out, 'sync-engine.js'), engine);
console.log('[bundle] build/stream-preload.js e build/sync-engine.js prontos');
