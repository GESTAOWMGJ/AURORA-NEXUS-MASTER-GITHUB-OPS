function processarGmailWMGJ() {
  const label = GmailApp.getUserLabelByName(WMGJ_CONFIG.GMAIL.LABEL_IMPORTAR);
  if (!label) {
    registrarLogWMGJ('GMAIL', 'SEM_LABEL', WMGJ_CONFIG.GMAIL.LABEL_IMPORTAR);
    return { ok: false, erro: 'Label não encontrada' };
  }

  const threads = label.getThreads(0, 10);
  let processados = 0;

  threads.forEach(thread => {
    const messages = thread.getMessages();

    messages.forEach(msg => {
      const anexos = msg.getAttachments();

      anexos.forEach(anexo => {
        const nome = anexo.getName();

        if (!nome) return;

        DriveApp.getFolderById(WMGJ_CONFIG.PASTA_ENTRADA_ID)
          .createFile(anexo.copyBlob());

        processados++;
      });
    });

    thread.removeLabel(label);
    thread.addLabel(GmailApp.getUserLabelByName(WMGJ_CONFIG.GMAIL.LABEL_PROCESSADO) || GmailApp.createLabel(WMGJ_CONFIG.GMAIL.LABEL_PROCESSADO));
  });

  registrarLogWMGJ('GMAIL', 'OK', 'Anexos processados: ' + processados);

  return { ok: true, processados };
}
