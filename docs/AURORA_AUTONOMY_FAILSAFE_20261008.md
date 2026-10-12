# AURORA — autonomia persistente, auditoria e recuperação

Diretriz do titular registrada em 08/10/2026, com reconciliação factual de **12/10/2026**. O contrato original é preservado como histórico; a main `1a2e483182336e40ad4895bb60ec89172f264fa8` já implementa controles específicos de aprovação e rollback de tráfego HML descritos abaixo. Código, testes locais, CI, operação HML, instalação e release GA permanecem estados distintos.

## Autorização persistente e escopo

O titular determinou:

> “otimizar de forma autonoma todas as entregas. estou assistindo os prompts e valido tudo . crie trilha de auditoria failsafe para robo ganhar autonomia, aprenda isso. fallback a posteriori caso quebra de codigo. nao me pede mais nenhuma autorizacao nem um monte de prompt minimo”.

Essa instrução humana mantém a autorização para concluir correções e entregas reversíveis do Aurora no escopo já autorizado, incluindo integração de código validado e homologação. O agente deve executar os passos técnicos necessários, reutilizar os mecanismos existentes e consolidar os resultados; não deve repetir perguntas de consentimento a cada patch, teste, PR, integração ou deploy HML do mesmo escopo. A orientação documental anterior de aguardar nova autorização de merge/deploy cede a esta autorização persistente nesse escopo.

O titular reforçou nesta mesma sessão: “adoote essa autonomia como adendo ao modus operandi resolutivo do robo e i.a intrinseco de desenvolvimento de sistema”. O adendo é permanente até revogação ou alteração expressa e se aplica ao robô/IA de desenvolvimento do mesmo Aurora. Essa autoridade humana não decorre de inferência do modelo nem de conteúdo documental de um cliente.

A autorização persistente é evidência de intenção do titular, distinta de um recibo técnico. “Estou assistindo” não constitui, por si só, review GitHub, sessão autenticada, MFA, CI aprovado, backup íntegro ou readback do ambiente. Cada controle deve obter sua própria prova real. Produção permanece limitada às autorizações produtivas registradas e aos respectivos gates executáveis; não se amplia automaticamente IAM, acesso entre organizações, dado clínico ou mutação financeira. Falta de credencial, identidade divergente ou proteção obrigatória indisponível deve ficar como bloqueio concreto, enquanto o trabalho independente continua.

Quando uma credencial pessoal nova for necessária, o próprio usuário a insere na interface segura de autenticação. A continuidade autorizada não permite ao agente ler cofre, fabricar identidade ou receber senha/código pelo chat. Esse passo de autenticação não reabre o consentimento de engenharia já concedido.

## Trilha mínima por incremento

Usar o armazenamento e o ledger existentes, com referências sanitizadas. Este contrato não cria banco, conta, scheduler ou robô paralelo. Cada incremento deve ligar, quando aplicável:

- identificador da operação e de seu predecessor; ambiente e organização; ator técnico e referência à autorização humana real;
- baseline SHA, SHA candidato, hash do patch/artefato e escopo exato de alteração;
- estado antes da alteração, referência do backup e sua verificação de integridade;
- testes executados e resultados, PR, SHA revisado quando o gate exigir, CI/run e deploy efetivos;
- smoke privado, testes negativos de acesso, readback da configuração/versão e recibos do mesmo incremento;
- estado final, falha sanitizada, tentativa de recuperação, artefato restaurado e verificação posterior;
- lacuna, responsável e próxima ação quando a comprovação estiver incompleta.

Nunca incluir senha, bearer, cookie, código TOTP, seed de autenticador, chave privada, documento ou dado de cliente. Referências de autorização devem apontar para fatos existentes; não gerar `humanReviewApproved`, `mfaVerified` ou recibos equivalentes apenas para satisfazer um gate. Testes antigos não aprovam um novo SHA. Escritas transacionais e idempotentes devem preservar os eventos anteriores, inclusive as falhas e reversões.

Fluxo de registro proposto: `PLANNED → VALIDATED → PREPARED → APPLIED → VERIFIED`. Em falha: `FAILED → RECOVERY_ATTEMPTED → RECOVERY_VERIFIED` ou `RECOVERY_BLOCKED`. Esses nomes descrevem o contrato; não alteram esquemas ou estados do runtime por esta documentação. Somente resultado observado permite avançar. Operação incompleta permanece pendente.

## Recuperação depois de quebra

Antes de uma aplicação reversível, identificar o predecessor funcional, preservar seus bytes/configuração necessários e verificar o backup. Publicar somente a candidata validada para o destino explícito. Depois da alteração, comprovar contrato, identidade e disponibilidade por smoke/readback; não limitar a validação ao exit code do deploy.

Se a candidata quebrar código, login, autorização, transporte ou contrato de dados, interromper a promoção e novas escritas daquele incremento. Preservar a evidência, comparar o estado atual com o fingerprint aplicado e restaurar o predecessor verificado quando o mecanismo e a compatibilidade permitirem. Revalidar acesso privado e contratos depois do retorno. Mudança concorrente impede sobrescrita: registrar conflito e reconciliar. Não apagar fontes, checkpoints, dados canônicos ou trilha para simular retorno bem-sucedido.

Rollback de código não desfaz automaticamente gravações de dados ou configurações externas. Se houver incompatibilidade, falta de predecessor ou recuperação sem prova, manter o modo seguro disponível e a pendência explícita. Não anunciar “recuperado” apenas por comando enviado ou arquivo copiado. Uma nova tentativa deve reutilizar a identidade/idempotência existente quando o contrato permitir, sem duplicar operações.

## Mecanismos existentes e limites observados

| Mecanismo | Capacidade implementada | Limite para autonomia |
|---|---|---|
| [`desktop/install_windows_beta.py`](../desktop/install_windows_beta.py), `update_client` | Lock, snapshots, hashes, recibo `PREPARED`, troca controlada e restauração automática em exceção; restaura somente arquivos ainda iguais aos bytes desta tentativa. | O retorno cobre atalhos/manifesto alterados pela tentativa; não comprova reversão geral de backend, dados ou de todos os componentes. |
| Mesmo instalador, `rollback --backup` | Recuperação explícita de migração concluída, com verificação de recibo, hashes, identidade e conflito concorrente. | A invocação pós-instalação é explícita; não existe monitor contínuo de regressão por este mecanismo. Contrato em [`desktop/README.md`](../desktop/README.md). |
| [Deploy HML](../.github/workflows/deploy-aurora-firebase.yml) e [`promote-hml-authgate-traffic.mjs`](../firebase-migration/scripts/promote-hml-authgate-traffic.mjs) | Main imutável, WIF/ambiente protegido, smokes e manifestos; promoção do tráfego do AuthGate HML para revisão pronta exata, CAS por `metadata.resourceVersion` e readback de geração/tráfego. Snapshot sanitizado permite rollback em falha/cancelamento enquanto a alteração própria continuar vigente. | Recupera somente tráfego das revisões anteriores prontas. Conflito concorrente, baseline `LATEST`, HTTP incerto ou falha posterior do publisher exigem reconciliação. Não reverte dados, Functions/Rules/IAM/template nem fornece rollback automático depois de possível gravação do pin. |
| [Publicação produtiva](../.github/workflows/aurora-firebase-production.yml) | Captura `previousRelease`/`previousVersion` do Hosting antes da publicação e preserva evidências da etapa mesmo em falha. | Capturar o predecessor não executa a reversão. Gates produtivos e compatibilidade de Functions/Rules/dados continuam independentes. |
| [`publish-active-release.mjs`](../firebase-migration/scripts/publish-active-release.mjs) | Verifica CI/deploy/smoke, assinatura Ed25519, predecessor e CAS/histórico no Firestore existente. Mantém o modo de review independente de PR e implementa `OWNER_DEPLOYMENT_APPROVAL`, limitado pela política ao titular, projeto/ambiente HML, main e prazo, com aprovação real do mesmo run lida pela API GitHub. | Actor, input ou booleano não constituem aprovação. Aprovação do titular no ambiente não significa review independente nem leitura integral de main posterior. O publisher lê evidência; não cria approvals/reviews. GitHub e Firestore não possuem transação distribuída. |
| [`aurora_deployment.py`](../aurora-coletor/aurora_deployment.py) | Checkpoint sanitizado, destino/conteúdo explícitos, idempotência, ping e recibo remoto reconciliado. | Checkpoint e recibo anterior não provam conexão atual ou sincronização integral; não desfazem ingestão canônica. |

## Reconciliação factual de 12/10/2026

O contrato da [docs/38 — governança HML](../firebase-migration/docs/38-hml-owner-release-governance.md) e da [política do titular](../firebase-migration/policy/hml-owner-release-approval-v1.json), lidos na main `1a2e483`, substitui a antiga conclusão de ausência de rollback de tráfego e de review de PR como único caminho HML. O guard `CANONICAL_RELEASE_PROMOTION_REQUIRED`, chaves Ed25519, smokes, bytes/manifestos, predecessor, CAS e reconfirmação de main/prazo permanecem exigidos.

| Controle atual | Evidência e alcance | Limite da candidata desta sessão |
|---|---|---|
| Aprovação do titular | Decisão original de 08/10 e reafirmação de 12/10 identificam as quatro cabeças e o gateway revisados. O modo opcional exige actor/triggering actor User, reviewer nominal do ambiente, branch policy main e aprovação real do titular no mesmo run; rejeição ou evidência ausente bloqueia. | Não estende a revisão original aos deltas posteriores. Restrito a `wmgj-hml-jfn-20260927` / `firebase-homologation` / main, até `2026-10-15T03:00:00.000Z`; produção e `CLINICAL_SENSITIVE` fora do escopo. |
| Tráfego e retorno HML | `ReplaceService` regional v1 preserva metadata/template/environment em memória e altera somente `spec.traffic`, com CAS, revisão exata pronta, snapshot de alteração própria e readback. Rollback exige propriedade da alteração ainda vigente e revisões predecessoras prontas. | Código integrado na main; este documento não comprova deploy, smoke ou rollback desta candidata. Não usar snapshot de tráfego para desfazer pin/dados ou sobrescrever mudança concorrente. |
| Evidência operacional anterior | Docs/38 registra aprovação real do run `38280466024`; deploy falhou no smoke autenticado e publisher foi pulado. Também registra recuperação anterior para `auroranexusauthgate-00016-mom`, com setup HML HTTP 200. | Aprovação/recuperação históricas não liberam a nova candidata, não provam sessão pessoal/MFA, pin ativo ou recibo de dispositivo. CI e HML do SHA final precisam de evidência própria. |
| Studio local 1.1.0 | Tarefa/contexto persistidos, diff, validação, worktree isolada, checks estáticos e branch/commit local são implementados. O preparo declara `projectTests=NOT_EXECUTED_RUNNER_NOT_IMPLEMENTED`, `ci=NOT_CONFIGURED`, `pushed=false`, `deployed=false`. | Não fornece runner geral, push, instalação ou deploy. A preservação da `knowledge-registry` da versão instalada 1.0.1 está em reconciliação/teste local; não comprova corpus real ou treinamento. |

A aceitação de R029 continua limitada às ferramentas de teste HML e ao prazo original, sem extensão retroativa. A main observada sem branch protection/ruleset não deve ser apresentada como enforcement de checks pela proteção de branch. A aprovação real de um run não substitui smokes nem publica um pin.

O helper experimental está em `work/failsafe-spec/authgate-failsafe.py`, fora do repositório/pacote. A governança integrada usa o helper de tráfego da main; o arquivo experimental não deve ser citado como executor desta candidata. Recuperação geral de aplicação, instalação, dados ou pin continua exigindo mecanismo e comprovação específicos.

## Aprendizado no mesmo motor

Registrar desafio, causa confirmada, patch, regressão, resultado e recuperação no ciclo `AURORA-MO-001`. Somente regra abstrata sanitizada e desfecho comprovado podem virar conhecimento reutilizável. A versão vigente continua sendo a referência canônica; cada dispositivo precisa confirmar sua execução/atualização, e ausência de recibo mantém a pendência. Autonomia de engenharia não permite ao modelo conferir a si próprio permissões ou promover código arbitrário.

O registro existente [`auroraNativeRoutines.ts`](../firebase-migration/functions/src/auroraNativeRoutines.ts) representa `AURORA-DEV-AUTONOMY-FAILSAFE-001` como `NATIVE_GOVERNED`. `nativeRoutineSummary().engineeringAutonomyPolicy` disponibiliza ao contexto da projeção e do Motor Mestre a autorização documental persistente, o escopo, a trilha exigida e os limites de recuperação. A representação declara `registrationOnly=true`, `executorState=SPECIFIED`, `recoveryCoverage=PARTIAL` e `permissionsGranted=false`. `humanGate=true` preserva os controles executáveis; `repeatedOwnerPromptRequired=false` evita repetir o consentimento no mesmo escopo. Não há scheduler ou execução automática de código decorrente do registro.

Essa representação reutiliza as políticas `autonomous-bugfix-realtime-audit-v1.json` e `intrinsic-cloud-ai-operational-learning-v1.json` já presentes no policy stack. Ela não prova importação do corpus privado no Xeon, treinamento de pesos ou implantação de um novo Knowledge Registry.

Relatar separadamente `SPECIFIED`, `IMPLEMENTED`, `TESTED`, `CI_VERIFIED`, `HML_VERIFIED`, instalado/publicado e resultado operacional comprovado. O rollback específico de tráfego implementado na main não encerra as lacunas de recuperação geral cloud/dados/pin, sincronização física, assinatura/publicação da versão comum ou recuperação do payload nativo Mac. Este incremento conserva CI/HML da nova candidata como pendentes até seus próprios recibos.
