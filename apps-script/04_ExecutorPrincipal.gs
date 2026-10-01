function sistemaWMGJCompleto(){
registrarLogWMGJ_('SISTEMA','START');
try{
garantirAbasConciliacaoWMGJ();
conciliacaoCompletaWMGJ();
registrarLogWMGJ_('SISTEMA','OK');
}catch(err){
registrarLogWMGJ_('SISTEMA','ERRO');
throw err;
}
}
