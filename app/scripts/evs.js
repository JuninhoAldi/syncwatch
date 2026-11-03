/*
 * Utilitários do EVS (assinatura VMP da castlabs).
 * A assinatura é o que faz Netflix, Prime, Disney+ etc. aceitarem tocar no app.
 */
'use strict';

const { spawnSync } = require('child_process');

/** Acha um Python que tenha o castlabs-evs instalado. */
function findPython() {
  const candidates = process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ['-c', 'import castlabs_evs'], { stdio: 'ignore', shell: false });
    if (r.status === 0) return cmd;
  }
  return null;
}

/** Assina (VMP) uma pasta com o Electron/app empacotado. */
function signPackage(dir) {
  const py = findPython();
  if (!py) {
    throw new Error(
      'castlabs-evs não encontrado. Rode o 1-configurar.bat (ou: py -m pip install --upgrade castlabs-evs).',
    );
  }
  console.log(`[evs] assinando ${dir}`);
  const r = spawnSync(py, ['-m', 'castlabs_evs.vmp', 'sign-pkg', dir], { stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(
      'A assinatura EVS falhou. Se a sessão expirou, rode: py -m castlabs_evs.account reauth',
    );
  }
}

module.exports = { findPython, signPackage };
