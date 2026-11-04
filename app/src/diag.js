/*
 * SyncWatch — registro de diagnóstico.
 * Grava em %APPDATA%\SyncWatch\diagnostico.log o que acontece com cookies,
 * requisições com erro e mensagens de erro das páginas de streaming.
 * Não grava valores de cookies nem conteúdo de requisições (só nomes, status e URLs sem parâmetros).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 2 * 1024 * 1024;
let file = null;

function stripQuery(url) {
  try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch (_) { return String(url).slice(0, 200); }
}

function log(...parts) {
  if (!file) return;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${parts.join(' ')}\n`);
  } catch (_) { /* diagnóstico nunca derruba o app */ }
}

/** Liga o diagnóstico para a sessão do streaming e para a WebContents do navegador. */
function start({ app, ses, partition }) {
  file = path.join(app.getPath('userData'), 'diagnostico.log');
  log('==== app iniciado', `versao=${app.getVersion()}`, `empacotado=${app.isPackaged}`,
    `electron=${process.versions.electron}`, `chrome=${process.versions.chrome}`);
  log('userData', app.getPath('userData'));
  log('particao', partition, 'persistente=', String(ses.isPersistent()), 'storagePath=', String(ses.storagePath));
  log('userAgent', ses.getUserAgent());

  // Cookies das páginas de streaming: só nome, domínio e se é de sessão
  ses.cookies.on('changed', (_e, cookie, cause, removed) => {
    if (!/netflix|nflx|primevideo|amazon|disney|hbomax|max\.com|globo|crunchyroll/.test(cookie.domain || '')) return;
    log('cookie', removed ? 'REMOVIDO' : 'gravado', `causa=${cause}`, `nome=${cookie.name}`, `dominio=${cookie.domain}`,
      `sessao=${!!cookie.session}`, `sameSite=${cookie.sameSite}`, `secure=${cookie.secure}`);
  });

  // Requisições que falharam ou deram erro HTTP
  ses.webRequest.onCompleted({ urls: ['*://*/*'] }, (d) => {
    if (d.statusCode >= 400) log('http', d.statusCode, d.method, stripQuery(d.url));
  });
  ses.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, (d) => {
    if (d.error === 'net::ERR_ABORTED') return;
    log('erro-rede', d.error, d.method, stripQuery(d.url));
  });
}

/** Erros de console e navegação da página do streaming. */
function watchContents(wc) {
  wc.on('console-message', (e) => {
    const level = e.level ?? e.params?.level;
    const message = e.message ?? e.params?.message ?? '';
    if (level === 'error' || level === 3) log('console-erro', String(message).slice(0, 400));
  });
  wc.on('did-navigate', (_e, url, code) => log('navegou', code || '', stripQuery(url)));
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (code !== -3) log('falha-carregar', code, desc, isMain ? 'principal' : 'frame', stripQuery(url));
  });
  wc.on('render-process-gone', (_e, d) => log('render-caiu', d && d.reason));
}

module.exports = { start, watchContents, log };
