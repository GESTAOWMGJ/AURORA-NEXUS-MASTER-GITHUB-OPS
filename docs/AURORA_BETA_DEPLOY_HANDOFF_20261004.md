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
Novo candidato pós-ingestão observado: run `37221856821`, SHA `35a2d5218604f611470e6db3e176a0a6d4cc6736`, aguardando `firebase-homologation`. Antes de executar, reconciliar novamente main, requests, CI e único candidato;
não aprovar o run antigo como se fosse a main atual.

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
   todos os rewrites, incluindo integração. Não repetir ingestão para corrigir UI.
3. Executar finalização pós-ingestão, native insight e kill switch com evidência.
4. Provisionar identidade revogável do gateway pelo fluxo autenticado/MFA
   existente; validar recibos, isolamento, repetição, backup externo e recuperação
   antes de ampliar dados reais. Nunca copiar secrets de CI para a estação.

Rollback do cliente: remover somente os atalhos registrados em seu
`installation.json` e a pasta da versão. Preservar gateway, dados, backups e
perfil do navegador. Rollback do código: reverter o commit do patch, mantendo
requests e evidências históricas.
