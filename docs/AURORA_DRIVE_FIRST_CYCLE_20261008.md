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
