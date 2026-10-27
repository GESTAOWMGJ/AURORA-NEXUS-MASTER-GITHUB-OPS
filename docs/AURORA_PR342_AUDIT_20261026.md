# AURORA-DRIVE-STATUS-002 — Auditoria técnica do PR #342

Contrato candidato **2.0.0**, produto **1.1.0-beta.2**, módulos M08/M09/M10.
Escopo: código, CI e evidências sanitizadas; testes exclusivamente sintéticos.
Nenhuma ação operacional, publicação, merge do PR, alteração de fase, fonte,
credencial, registro privado ou trigger foi executada nesta auditoria.

## Parecer

O SHA original `f2bbccaacc5ec1dc1f9267168890be05aa3b2936` **não elimina todos os
falsos sinais de coleta contínua**. Corrige o retorno enganoso de ACTIVATE,
cabeçalhos ausentes na promoção e a fase capturada antes da trava. Entretanto,
sete regressões novas falharam nesse SHA em três grupos materiais abaixo.

O incremento de contrato 2.0.0 fecha os achados reproduzidos, com os testes
deste registro. A candidata incorpora a main
`e03146511354a6b9c0df10af892d28b4c1d35814`, preservando a separação entre
manifestos, documentos e aliases. O commit remoto mantém o head original e
essa main como pais; o relatório acompanha exatamente a árvore testada.

**Aptidão:** candidata à revisão para integração e à homologação controlada em
contenção; não é homologação concluída nem autorização de LIVE_ENUMERATION.
O SHA final é o commit que contém este documento e os testes; seu CI deve ser
consultado no PR. Nenhuma revisão humana foi encontrada no início da auditoria.
O PR permanece draft, sem merge/deploy. Manter REMEDIATE_ONLY até os controles
operacionais abaixo serem comprovados.

## Achados reproduzidos e correção

| Prioridade | Falha no SHA original | Correção e evidência sintética |
|---|---|---|
| P1 — status sem prova documental | `scanExamined>0` + ciclo `ok` bastavam para `continuousExtractionVerified=true`, inclusive com zero documentos aceitos ou erros recuperáveis. STATUS não revalidava o fingerprint do runtime, dry-run ou mirror. | STATUS v2 distingue coletor, fase, ciclo recente e enumeração. Ciclo exige mesmo escopo/ativação, timestamps válidos, frescor de 30 min e contadores inteiros. `continuousExtractionVerified`, `canonicalReadbackVerified` e `fullSynchronizationVerified` ficam falsos nesta API sem READBACK canônico. Configuração divergente recusa o status operacional. |
| P1 — rechecagem não alcançava a enumeração | O scanner não invocava `beforeRequest`; podia continuar lendo/enfileirando após contenção, mesmo sem extração. A promoção verificava janela/configuração somente antes de esperar pela trava. | Scanner revalida antes/depois de leituras e antes de fila/cursor; processamento verifica a autoridade nas fronteiras de extração/envio. Revogação aborta sem converter contenção em falha do documento. Promoção revalida autorização e configuração dentro da trava e antes da mudança. |
| P1 — fila/recibo aceitava conclusão indevida | Cabeçalhos duplicados podiam ocultar a coluna correta; `undefined===undefined` aceitava recibo sem hashes; `DUPLICATE_CONTENT` dispensava prova do alias. Remediação também carecia da validação de cabeçalhos. | Cabeçalhos obrigatórios únicos e linhas retangulares; recibo completo pelo validador existente, identidade/versão e hash vinculados; alias exige âncora única no mesmo tenant/escopo e recibo correspondente. Justificativa exige marcação explícita. Metadados continuam sem representar recuperação. |

O workflow contínuo passa a verificar os bytes e manifesto do Apps Script
publicado com os validadores existentes **antes** da ação e a estabilidade do
deployment **depois**. O artefato v2 distingue `checkedSourceSha` do SHA de
publicação. O gate exige STATUS v2 e confirmação de contenção após ACTIVATE.
O teste offline executa esses blocos com clasp sintético e recusa divergência
de bytes ou troca de deployment, sem autenticação ou acesso à nuvem.

## Reprodutibilidade

- SHA original: 154/154 testes dirigidos reproduzidos em Linux, Node 24.22.1.
  Isso não constitui nova execução no Windows Xeon; os 154 do Windows continuam
  sendo a evidência anteriormente registrada no PR.
- Antes da correção: 98 testes nos dois arquivos ampliados, 91 aprovados e
  **7 falhas esperadas**, reproduzindo os achados acima.
- Candidata reconciliada: **279 aprovados, 0 falhas, 0 skips**, abrangendo os
  contratos Drive, Gmail, replay, onboarding e paridade financeira.
- Auditoria Apps Script: sem erros de sintaxe/duplicidade; permanece o aviso
  preexistente de arquivos legados fora de `src/`.
- YAML analisado, sete blocos shell verificados com `bash -n`; `git diff --check`
  aprovado. Não houve execução dos workflows operacionais.

```bash
node --test tools/test-gmail-ingestion.cjs tools/test-gmail-replay.cjs \
  tools/test-drive-full-ingest.js tools/test-drive-activation.js \
  tools/test-aurora-drive-ingest-run.cjs tools/test-financial-ingestion-parity.cjs \
  tools/test-gmail-drive-onboarding.cjs
node tools/audit-appscript.js
git diff --check
```

Testes adicionais cobrem varredura sem recibo, aceitação sem READBACK,
configuração divergente, prova velha/futura/de outro escopo, cabeçalhos
ambíguos, recibos incompletos, aliases sem âncora, expiração após trava,
revogação durante scanner/extração, primeira execução inválida de ACTIVATE e
bytes/deployment incompatíveis. Recibos e aliases sintéticos válidos conservam
um caminho positivo; contenção não é contornada para satisfazer testes.

## CI original — diferença entre SHA do PR e SHA executado

Os cinco workflows associados ao head original foram consultados, incluindo
logs dos nove jobs. Todos concluíram com sucesso. **Somente dois workflows
executaram diretamente o head**; os outros três usaram o merge sintético do
GitHub `e4a8637674827e26e57d4995735b4627035e0b3d` com a base `8264dcc...`.

| Workflow | Run | Checkout observado nos logs |
|---|---|---|
| Validate HML Auth Contract | [40278884340](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/40278884340) | `f2bbcca...` |
| Validate Gmail Ingestion Contract | [40278884576](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/40278884576) | `f2bbcca...`; 220 testes |
| Validate Aurora Onboarding | [40278884347](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/40278884347) | `e4a8637...`; Windows, Ubuntu e descoberta local |
| Security — CodeQL | [40278884493](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/40278884493) | `e4a8637...`; JavaScript/TypeScript e Python |
| AURORA Realtime Guardian | [40278884323](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/40278884323) | `e4a8637...` |

Esses resultados não validam automaticamente o incremento, a nova base, o
Apps Script publicado nem a autorização operacional.

## Confronto com as evidências reais disponíveis

Os três ZIPs abaixo foram baixados, abertos e tiveram SHA-256 conferido contra
o digest retornado pelo GitHub. São snapshots históricos, sem leitura da fila
real atual ou nova consulta autenticada ao runtime nesta auditoria.

| Camada | Evidência verificada | Conclusão permitida |
|---|---|---|
| Trigger instalado | [Contenção 40277310678](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/40277310678): 1 trigger, 0 duplicados, 4 raízes do escopo existente | Um coletor naquele snapshot; quatro raízes não significam quatro coletores. Não prova execução atual. |
| Fase habilitada | Mesmo run: `REMEDIATE_ONLY`; primeiro ciclo `REMEDIATION_GATE`, varredura/tentativas/aceites = 0 | Contenção confirmada naquele momento. O `continuousExtraction=true` antigo do ACTIVATE é contraditório e não serve como prova. |
| Metadados saneados | [Remediação 40274154147](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/40274154147): changed=282, pending=282, justified=282, unjustified=0 | 282 classificações de pendência; nenhum documento recuperado é demonstrado por essa ação. O último ciclo informado era falho. |
| Documentos/aliases comprovados | [READBACK 40194120781](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/40194120781): 51 canônicos, 192 referências de alias e 12 pendências | 51 documentos canônicos verificados no snapshot de 25/10; aliases não somam novos documentos. Não conciliar com as 282 linhas por simples subtração. |
| Sincronização integral | READBACK: `complete=false`, `scopedQueueDrained=false`, `fullSynchronizationVerified=false` | Não comprovada. Pendências históricas: 10 falhas de conversão e 2 sem código registrado. |

| Artefato | ID | SHA-256 do ZIP |
|---|---|---|
| Contenção | 12630199038 | `bf7d826006dba61eb595019161d4d86beef7905d6d1b75f04af49e29bd418862` |
| Remediação | 12628714848 | `51320ae3cc512175883d3e95df5ec0339b9ec9e5c4d1c7be57c2e2a502bea3b9` |
| READBACK | 12598449534 | `2f464afa44e7e7bb2fb5be9fb4f41b6e88234580c231374194bccb8003cbb413` |

## Contrato de status v2

`ok` / `STATUS_VERIFIED` qualificam a configuração operacional, não o conteúdo.
`collectorConfigured` indica fonte registrada e trigger único; `liveEnumerationEnabled`
indica fase LIVE sob configuração/autorização válidas. `recentCycleVerified`
indica resumo de execução recente e vinculado à ativação; `enumerationObserved`
indica itens visitados nesse ciclo. `canonicalReceiptsRecorded` é contagem de
metadados de recibos, podendo incluir manifestos; não é documento recuperado.

A API STATUS não realiza leitura canônica/versão imutável. Por isso mantém
`canonicalReadbackVerified=false`, `continuousExtractionVerified=false` e
`fullSynchronizationVerified=false`, com `verificationCode=CANONICAL_READBACK_REQUIRED`.
A comprovação documental continua no READBACK existente; nenhum coletor,
banco, enrollment ou autorização foi criado para produzir esse sinal.

## Controles restantes e rollback

1. Revisão humana e CI da candidata final, confrontada com a main vigente;
   não reutilizar o CI original como liberação. Release Cockpit permanece
   `IMPLEMENTED_PENDING_HML_VALIDATION`; nenhum avanço de GA.
2. Publicação HML separada, protegida e autorizada, conferindo bytes/SHA do
   Apps Script; STATUS v2 em REMEDIATE_ONLY, trigger único e escopo privado
   exatamente igual. Testar no runtime a persistência da fase durante contenção.
3. Reconciliar fila/recibos atuais, versões, manifestos e aliases por identidade;
   documentar as exclusões, justificar resíduos e executar READBACK canônico
   novo antes de considerar promoção. Respeitar a janela aplicável, sem renovar
   autorização por interpretação do status ou do CI.

Limites: chamada síncrona já enviada não pode ser cancelada retroativamente;
a revogação impede os próximos passos nos checkpoints. Os testes de concorrência
são sintéticos; não comprovam o comportamento concorrente de PropertiesService
no runtime real. O saneamento examina itens vinculados ao escopo legível, não
prova completude do Drive nem converte linhas legadas em extração.

Rollback de código: reverter somente o incremento revisado, preservando a
fase REMEDIATE_ONLY, recibos, fila e fontes. Não reverter cegamente a main
reconciliada nem reativar LIVE. Este trabalho não alterou estado operacional.
