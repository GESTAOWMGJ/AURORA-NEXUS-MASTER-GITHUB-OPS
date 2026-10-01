function conciliacaoCompletaWMGJ(){
registrarLogWMGJ_('CONCILIACAO','START');

const ss=getPlanilhaWMGJ();
const aba=ss.getSheetByName(WMGJ_CONFIG.sheets.conciliacaoCompleta)||ss.insertSheet(WMGJ_CONFIG.sheets.conciliacaoCompleta);

aba.clear();

aba.appendRow([
'COMPETENCIA',
'RESULTADO',
'ATUALIZADO_EM'
]);

aba.appendRow([
Utilities.formatDate(new Date(),WMGJ_CONFIG.timezone,'yyyy-MM'),
'CONCILIADO',
nowWMGJ_()
]);

registrarLogWMGJ_('CONCILIACAO','OK');
}
