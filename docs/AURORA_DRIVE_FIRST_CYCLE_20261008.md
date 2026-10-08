# Primeiro ciclo documental Drive — 08/10/2026

Baseline `d5f502eaeb89d66c50024ecb4240ed021e76b676`, módulos M01/M08/M10.

O ciclo Apps Script processava a fila V3 antes da extração real. V3 podia registrar
memória local e marcar `PROCESSADO` sem recibo Firebase; a extração posterior aceita
somente `PENDENTE`/`ERRO_REPROCESSAR`. O mirror obrigatório agora escolhe a fila de
extração existente, sob a trava compartilhada, antes de qualquer consumo V3.
Mirror opcional preserva o caminho anterior.

A ativação autorizada do conector executa imediatamente uma preparação e extração
de até cinco documentos, no mesmo registro de fontes e fila existentes. Reutiliza
o gatilho de 15 minutos, sem outro executor, agendamento ou pipeline amplo Gmail.
Falhas ou revisão documental permanecem pendentes. Contagens e recibo local não
concluem cadastro operacional: `firstIngestionVerified=false` e
`operationalReady=false` até leitura autenticada do documento/versão/projeção no
Firebase. Reconfigurar outro tenant sobre o registro existente é recusado.

Validação: fixture executa os scripts reais de seleção, ativação e trava; cobre
ordem, limite, ausência de fallback, conflito de tenant, dependência ausente,
concorrência, falha de fonte e falha de extração. Não é aceite de fonte real,
Google Workspace, cloud/Xeon ou produção.

Aceite pendente: confirmar registry e proprietário do executor na operação
autorizada; executar primeiro ciclo limitado nessa identidade; reconciliar um
documento, uma versão imutável e sua projeção, sem efeito duplicado em retomada.
Nenhuma ScriptProperty, trigger real, fonte, DNS, IAM ou deployment é alterado
pela candidata. Rollback de código: reverter o commit sem apagar fila/memória.

## Status administrativo somente leitura

`auroraLerStatusConectoresPlugAndPlay(expectedOrgId)` é público para a Execution API existente. O único parâmetro é o tenant esperado, minúsculo e validado; a resposta contém apenas flags, contagens e códigos fixos. Divergência de tenant bloqueia leitura de secrets, registry, fontes e gatilhos. JSON de registry malformado não usa fallback silencioso. O acesso às pastas existentes é contado por `getFolderById`, sem nomes, IDs, listagem de arquivos ou payloads na resposta. Nenhum gatilho é criado, nenhum documento é processado e nenhum log em Sheets é gravado.

O wrapper reutiliza `PropertiesService`, `DriveApp` e `ScriptApp`, já contemplados pelo manifest OAuth atual; não requer novo scope nem cliente OAuth. No contexto `build-appscript` já autenticado, o contrato é `bash tools/run-clasp-checked.sh auroraLerStatusConectoresPlugAndPlay "$RUNNER_TEMP/connector-status.json" '["wmgj"]'`. O workflow atual de deploy ainda não chama esse wrapper e executar o workflow completo também faz push/redeploy; essa operação não equivale a uma consulta isolada.

`ok=true` significa conclusão da leitura de status. `firstIngestionVerified` e `operationalReady` permanecem `false`: recibo, versão imutável, projeção e isolamento de tenant exigem readback canônico separado. Contagens de gatilhos abrangem apenas o usuário OAuth executor da consulta.