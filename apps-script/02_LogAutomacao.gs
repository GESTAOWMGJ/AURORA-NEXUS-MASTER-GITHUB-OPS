function registrarLogWMGJ_(acao,status,detalhes){
const ss=getPlanilhaWMGJ();
const aba=ss.getSheetByName(WMGJ_CONFIG.sheets.log);
aba.appendRow([
nowWMGJ_(),
acao,
status,
detalhes||''
]);
}
