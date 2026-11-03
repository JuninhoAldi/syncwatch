/*
 * Assina o Electron usado pelo `npm start` (modo de desenvolvimento),
 * para Netflix/Prime/Disney+ já funcionarem antes de gerar o instalador.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { signPackage } = require('./evs');

const dist = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
if (!fs.existsSync(dist)) {
  console.error('Electron não instalado ainda. Rode "npm install" primeiro.');
  process.exit(1);
}
try {
  signPackage(dist);
  console.log('[evs] pronto! Netflix, Prime e Disney+ devem tocar no "npm start".');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
