/*
 * Hook do electron-builder (afterPack): assina o app empacotado com o EVS
 * antes de virar instalador. Sem isso, streamings pagos não tocam.
 */
'use strict';

const { signPackage } = require('./evs');

exports.default = async function afterPack(context) {
  signPackage(context.appOutDir);
};
