# Cadastro e primeira ingestão — 08/10/2026

Base: `bebb0a0b62baa47b2057dbf773c87b6ca8e7e3da`.

O cadastro mantém a identidade e o vínculo existentes. O assistente `/setup` verifica automaticamente a primeira ingestão e não libera a conclusão operacional apenas por login ou comunicação HTTP. Uma fonte autorizada continua necessária; nenhum arquivo é descoberto ou enviado sem escopo, e nenhum dado fictício libera o cliente.

## Fluxo implementado

O endpoint existente `/api/integration/documents` persiste a entrada idempotente e tenta continuar a projeção nativa já configurada. Repetir o mesmo envio após resposta incerta retoma a projeção. A projeção de integração tem ID determinístico por competência e hash do estado-fonte: concorrência no mesmo snapshot não duplica o histórico. Uma falha na projeção gera log sanitizado `PROJECTION_PENDING`, preserva o recibo do documento e mantém a preparação pendente.

A releitura transacional usa exclusivamente a organização autenticada, seu checkpoint existente, o documento canônico e a projeção. `FIRST_INGESTION_VERIFIED` exige tenant ativo, documento validado e não revogado/excluído, pronto para processamento nativo e independente da fonte, e prova do mesmo ID/versão/hash na projeção da mesma competência. Esse estado confirma a primeira entrada processada; não é liberação de produção, sincronização integral ou aprovação financeira. A projeção conserva fontes ausentes como ausentes.

A interface consulta automaticamente, com timeout, sem redirects, no máximo 12 tentativas e um único processamento em andamento. Permite verificar novamente e retomar ao reabrir. Não recebe Bearer permanente nem troca o acesso por outro domínio.

## Evidências e limites

Build TypeScript e 33 testes focados executados no Windows Xeon: interface real emitida, organização divergente, sessão expirada, ausência de fonte, versão/hash divergentes, competência, ingestão estruturada e handler real com fixture transacional isolada. O ensaio injeta interrupção entre commit e projeção, repete a chave e faz duas repetições concorrentes: um documento, uma entrada idempotente e um histórico de projeção. Não substitui emulador/Firestore real nem transferência cloud/Xeon com fencing.

A primeira tentativa da suíte completa no Windows teve 470 sucessos e 16 falhas de preparação de ambiente (Bash/Python fora do PATH e comparação de arquivo com CRLF). A suíte completa em Linux permanece a cargo do CI do SHA final; não declarar suíte completa local verde.

Verificação HTTP externa no Xeon em `2026-10-08T05:02:33Z`: `https://auroranexus.com.br/portal` respondeu 200; `/api/bootstrap` e `/api/integration/ping` responderam 404. Nenhum token de integração estava presente no ambiente do processo diagnóstico; isso não prova inexistência de credenciais em outros componentes. A alteração ainda não foi implantada nem o instalador substituído.

## Aceite operacional restante

Disponibilizar o backend correspondente pelo domínio canônico, preservando sessão/MFA/membership, e vincular a fonte real autorizada do cliente. Executar o cadastro/instalação com essa fonte; confirmar recibo remoto e a mesma versão/hash na projeção. Repetir interrupção/retomada no ambiente integrado e comprovar um efeito persistido, com executor antigo rejeitado após handoff. CI verde não é essa comprovação.

Rollback: reverter o patch; os documentos e checkpoints existentes permanecem no mesmo armazenamento. Não há banco, daemon, agendamento ou executor novo.
