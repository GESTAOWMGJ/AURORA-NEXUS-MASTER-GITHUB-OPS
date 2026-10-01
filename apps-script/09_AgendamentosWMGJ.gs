function instalarAgendamentosWMGJ(){
  limparAgendamentosWMGJ_();

  ScriptApp.newTrigger('importarAnexosGmailParaDriveWMGJ')
    .timeBased()
    .everyHours(1)
    .create();

  ScriptApp.newTrigger('processarDriveCentralWMGJ')
    .timeBased()
    .everyHours(1)
    .create();

  ScriptApp.newTrigger('executarVigilanciaAutomaticaWMGJ')
    .timeBased()
    .everyHours(1)
    .create();

  registrarLogWMGJ_('AGENDAMENTOS','OK','rotinas instaladas');
}

function limparAgendamentosWMGJ_(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    ScriptApp.deleteTrigger(t);
  });
}
