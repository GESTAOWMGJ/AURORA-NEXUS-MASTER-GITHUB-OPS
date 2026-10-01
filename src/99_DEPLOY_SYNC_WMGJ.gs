/**
 * WMGJ — Marcador de sincronização GitHub -> Apps Script
 *
 * Arquivo sem efeito operacional sobre o pipeline.
 * Serve apenas para comprovar qual revisão do repositório foi publicada.
 */

var WMGJ_DEPLOY_SYNC_MARCADOR = "2026-07-13T20:37:00-03:00";
var WMGJ_DEPLOY_SYNC_ORIGEM = "GESTAOWMGJ/automacao-gestao-wmgj@main";

function diagnosticarSincronizacaoRepositorioWMGJ() {
  var versaoGemini = typeof WMGJ_GEMINI_VERSAO !== "undefined"
    ? WMGJ_GEMINI_VERSAO
    : "NAO_CARREGADA";

  var resultado = {
    ok: versaoGemini === "v1.2.0-gemini-api-validada",
    origem: WMGJ_DEPLOY_SYNC_ORIGEM,
    marcador: WMGJ_DEPLOY_SYNC_MARCADOR,
    versaoGemini: versaoGemini
  };

  Logger.log(JSON.stringify(resultado));
  return resultado;
}
