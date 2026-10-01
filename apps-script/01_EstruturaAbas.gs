function garantirAbasConciliacaoWMGJ(){
const ss=getPlanilhaWMGJ();
const abas={
'08_PRODUCAO_MEDICA':['COMPETENCIA','DATA','MEDICO'],
'09_NFS_REPASSES':['COMPETENCIA','NF_NUMERO','VALOR'],
'10_CONCILIACAO_COMPLETA':['COMPETENCIA','MEDICO','STATUS'],
'11_PENDENCIAS_CONCILIACAO':['DATA_HORA','PENDENCIA']
};
Object.keys(abas).forEach(function(nome){
let aba=ss.getSheetByName(nome);
if(!aba){
aba=ss.insertSheet(nome);
aba.appendRow(abas[nome]);
}
});
}
