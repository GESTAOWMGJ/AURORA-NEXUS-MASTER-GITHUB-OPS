# Recuperação de uma mensagem — M01/M08/M10

Estado: diagnóstico e contenção implementados; executor de replay especificado, não implantado.
Baseline da investigação: `cbe469558e5c00cf7fc01095d563c36457c72f3a`.
Dados do incidente permanecem no relatório privado do tenant, fora deste repositório público.

## Diagnóstico disponível

Executar `diagnosticarMensagemGmailWMGJ(messageId)` por identidade autorizada no projeto
Apps Script canônico. A função usa `GmailApp.getMessageById` e obtém anexos automaticamente;
não percorre mensagens irmãs da thread. Retorna hashes completos e legados, referências
de registros, divergências de layout, último timestamp nativo e gatilhos visíveis ao executor.
`ok=true` significa diagnóstico retornado, não permissão nem sucesso de reprocessamento.

Gatilhos instaláveis pertencem ao criador. A lista de um usuário não prova ausência de
gatilhos de outro. Conferir proprietário, scopes, versão implantada, execuções e erros após
o último sucesso. O deploy atual preserva separação entre publicar fonte e instalar/executar
rotinas; não reativar todos os perfis nem limpar todas as propriedades.

## Menor intervenção operacional

1. Capturar snapshot restrito de índice/fila/log e inventário atual de gatilhos. Suspender
   somente escritores concorrentes da ingestão durante a manutenção, com restauração definida.
2. Validar contrato de 25 colunas do escritor. Em tabela mista, reconstruir linhas a partir
   de evidências verificáveis; conservar a origem e as linhas não resolvidas como exceções.
   Não trocar o cabeçalho nem apagar duplicatas como forma de corrigir o histórico.
3. Testar deduplicação e rejeição de schema. Só então reativar um perfil de rotina existente,
   na conta correta, se estiver ausente/desabilitado. Se já ativo, reparar a falha de execução
   comprovada. Falta de evidência não autoriza inventar causa de suspensão.
4. Gerar manifesto restrito para o ID exato, anexos esperados, tamanhos, SHA-256 completo,
   chave legada e destinos. Conferir Drive por metadados e conteúdo, além de índice e fila.
5. Executor com lock compartilhado deve revalidar manifesto e estado sob trava. Reutilizar
   cópia íntegra existente; se não houver, criar arquivo com chave persistida atomicamente
   nos metadados da criação. Persistir etapas para recuperar timeout entre arquivo, índice
   e fila. Um simples `createFile` seguido de `appendRow` não fornece atomicidade.
6. Inserir somente registros ausentes; fila por arquivo/versão; extração e parsing limitados
   aos IDs do manifesto. Indexar não equivale a reconhecer movimentação financeira.
   Conta corrente, investimentos, saldos e transações exigem tratamento próprio.
7. Repetir em modo de verificação: zero novas cópias, índice e fila; confirmar os dois
   recibos de arquivo e a trilha de etapas. Encerrar somente com conciliação dos destinos.

## Falhas já cobertas pelo patch

- Cabeçalho trocado que faz `MESSAGE_ID` apontar para a versão do código.
- Linha histórica de outro layout mesmo após restaurar o cabeçalho.
- Erro e registro parcial tratados incorretamente como processamento concluído.
- Diagnóstico por query ampla ou seleção de thread em lugar do ID da mensagem.

O patch contém novas escritas no schema inválido; não normaliza os dados históricos e não
implementa replay mutante. O reparo definitivo depende das evidências e gates acima.

## Rollback e testes

Reverter este commit reverte código/política, sem tocar fontes. Não retomar ingestão no
schema misto apenas para contornar o bloqueio. Teste: `node --test tools/test-gmail-ingestion.cjs`.
Validar depois CI, conta real, concorrência, interrupção após criar arquivo e nova tentativa.

Fontes técnicas: [GmailApp](https://developers.google.com/apps-script/reference/gmail/gmail-app),
[gatilhos instaláveis](https://developers.google.com/apps-script/guides/triggers/installable),
[LockService](https://developers.google.com/apps-script/reference/lock/lock-service).
