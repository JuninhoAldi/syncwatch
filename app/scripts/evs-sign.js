/*
 * Hook do electron-builder (afterSign): assina o app empacotado com o EVS
 * antes de virar instalador. Sem isso, streamings pagos não tocam.
 *
 * Precisa ser afterSign (e não afterPack): no Windows o electron-builder grava
 * ícone e versão dentro do .exe DEPOIS do afterPack, o que invalidava a assinatura VMP
 * (a Netflix então recusava a licença e derrubava a sessão com erro 401).
 */
'use strict';

const { signPackage } = require('./evs');

exports.default = async function afterSign(context) {
  signPackage(context.appOutDir);
};
