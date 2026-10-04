# Aurora beta — frontend e implantação

Decisão do titular em 04/10/2026: alinhar ao versionamento do frontend preparado
pelo Copilot; conduzir o deploy por esta operação. Após a consulta aos PRs e
branches acessíveis, o titular selecionou **usar a main atual**.

Baseline inicial: `52fb02862e31920d558733d99356e627b4109fd7`. Reconciliada com `35a2d5218604f611470e6db3e176a0a6d4cc6736` após PR #126 e request pós-ingestão. O frontend não é redesenhado
nem recebe uma versão paralela. Sua versão continua em `auroraReleaseStatus.ts`.
`desktop/beta-platforms.json` separa a versão do cliente Windows da versão web.
O PR #124 permanece candidato independente; não é promovido por este patch.

## Correção de implantação

Run `37195696367`, job `111416974815`: a publicação Hosting retornou HTTP 400
porque `auroraNexusIntegrationPing` não existia em `southamerica-east1`.
O PR #126 foi incorporado à main durante esta implementação e já amplia o reparo aos backends de todos os rewrites; essa correção foi preservada. O passo anterior já havia reconciliado a amostra e a projeção SHADOW; o run
falhou antes de concluir native insight e kill switch. Isso não libera backfill.

A expressão anterior `all($required[]; $deployed | index(.) != null)` podia
encontrar o próprio array, sem provar cada nome requerido. A nova validação
inspeciona somente entradas de função da resposta, exige região e verifica
todas as dependências dos rewrites antes da publicação. Ela não cria funções,
não amplia IAM e não substitui o deploy protegido completo quando faltar runtime.

O smoke do deploy completo passa a exigir inclusão das funções esperadas,
aceitando funções adicionais legítimas de ingestão e criptografia. Continua
rejeitando a ausência de qualquer função obrigatória.

Requests HML existentes permanecem imutáveis neste patch. O run `37205987011`
foi observado aguardando ambiente protegido no SHA antigo `4542ce89...`.
O run pós-ingestão `37221856821`, SHA `35a2d5218604f611470e6db3e176a0a6d4cc6736`, foi executado por outra operação e terminou com falha. O job `111493631450` retornou HTTP 409, `FIREBASE_NATIVE_CONTRACT_REQUIRED`, no teste autenticado `REVENUE_RISK`. O artefato `11310407727` confirma amostra real reconciliada, SHADOW validado, `nativeInsightVerified=false` e `killSwitch=true`, sem mutação de produção ou da fonte. A falha do passo final não significa falha do kill switch: esse passo também exige native insight aprovado.

O reparo de rotas não executou deploy (`repaired=false`), pois os testes anônimos retornaram 405/401. Eles não provam a versão do motor nem a compatibilidade do snapshot. O runtime exige `nativeDataPlane.storage=FIRESTORE` e `sourceAccessDuringInference=false`; o gerador atual inclui esses campos. A hipótese a verificar é runtime/projeção desatualizados. Não adicionar esses campos manualmente a um snapshot antigo: publicar o motor aprovado, regenerar a projeção canônica e verificar o contrato com identidade real.

Antes de executar novo deploy, reconciliar novamente main, requests, CI e único candidato; não aprovar o run antigo como se fosse a main atual. Esta operação não disparou nem aprovou os runs protegidos observados.

## Windows e plataformas

O instalador por usuário cria o acesso AURORA NEXUS ao portal existente em
janela Edge. Exige login alcançável e `/api/bootstrap` anônimo recusado com
`401/AUTH_REQUIRED`. Não copia perfis, cookies, chaves, banco, fontes ou dados.
Não altera o gateway Windows, tarefas, permissões, políticas ou instalação Mac.

Em teste nativo em 04/10/2026: cliente `0.2.0-beta.1` instalado, login HTTP 200,
bootstrap privado HTTP 401 e native insight anônimo HTTP 401. Integration ping
retornou HTTP 404. A abertura do cliente foi solicitada; visual e sessão
autenticada ainda não foram verificados. O cliente é acesso ao web app,
não o aplicativo completo offline nem comprovação de sincronização autenticada.

Mac mantém o aplicativo original e exige inspeção antes de atualização. iOS
usa o PWA existente; não foi criado ou publicado um binário App Store. Web,
Windows e iOS PWA compartilham o frontend servido, sem inferir o SHA implantado
a partir do SHA consultado no GitHub.

## Próximo gate concreto

1. Revisar este patch e validar CI no head reconciliado.
2. Disparar deploy protegido completo com SHA imutável aprovado e confirmar
   todos os rewrites, incluindo integração, e `auroraNexusProjectionEngine`.
   Regenerar a projeção e verificar o contrato nativo. Não repetir ingestão para corrigir UI.
3. Executar finalização pós-ingestão, native insight e kill switch com evidência.
4. Provisionar identidade revogável do gateway pelo fluxo autenticado/MFA
   existente; validar recibos, isolamento, repetição, backup externo e recuperação
   antes de ampliar dados reais. Nunca copiar secrets de CI para a estação.

O conector GitHub disponível não oferece disparo de workflow nem aprovação de
ambiente protegido. O patch permanece em PR draft para revisão humana conforme
AURORA-DEV-001. O Mac estava offline; não houve atualização ou teste iOS. Não há
evidência suficiente para declarar a beta completa, sincronização local/cloud,
base mestre integralmente alimentada ou produção liberada.

Rollback do cliente: remover somente os atalhos registrados em seu
`installation.json` e a pasta da versão. Preservar gateway, dados, backups e
perfil do navegador. Rollback do código: reverter o commit do patch, mantendo
requests e evidências históricas.
