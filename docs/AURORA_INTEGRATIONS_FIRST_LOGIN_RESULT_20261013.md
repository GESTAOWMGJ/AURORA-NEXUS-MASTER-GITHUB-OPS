# Integrações e primeiro login — resultado verificado em 13/10/2026

## FATO COMPROVADO

- PR #242 mergeado: `a89d431c42d79210b48867d59a3cf3153e7153fc`.
- CI da main: Validate Firestore Migration run `38435289308`, SUCCESS.
- Deploy protegido HML run `38435627327` (#60), SUCCESS nos três jobs: validação `115428717052`, deploy `115429142768`, publicação `115431524566`.
- Validação da candidata: 764 testes Functions, 29 testes complementares e 3 testes adicionais passaram.
- Smoke autenticado: `AUTH_SMOKE_UID_VERIFIED`; leitura técnica: `CANONICAL_SOURCE_BOUND_RUNTIME_VERIFIED`.
- Publicação: `ACTIVE_PIN_PUBLISHED`, certificado SHA256 `a71a53a3cfa56005b30b793defe73be188d9a4a079f199974b390826ba7d58f5`, predecessor `c266645df3363df1789064507c52aad741ffc0a126059016315047215add0a0b`.
- Readback do Firestore `platformRuntime/activeRelease`: ACTIVE, `productVersion=1.1.0-beta.1`, sourceSha acima, releaseRunId `38435627327`, publishedAtUtc `2026-10-13T17:12:33.573Z`; checks ciPassed/humanReviewApproved/protectedDeploySucceeded/smokePassed verdadeiros.
- A revisão implementa prontidão automática desde o login, importação documental por sessão com MFA e CSRF, identidade por organização, conclusão com a mesma versão imutável e status relatado dos conectores.
- Testes Python locais: 121 testes, 1 skip existente. CI Windows/Linux do agente e provedores aprovado. Sete testes sintéticos do agente/provedores também passaram no Mac de contingência.
- Pacote IA Master produzido da main limpa (`dirty=false`), SHA256 ZIP `513697b7f82c6d2356d7fbcb952e1c75eb99335ce4f35464ea7812f7d8a52557`, contendo o componente leve client-agent 1.0.0 e seus seis arquivos com hashes conferidos no Mac.
- No Mac, fonte preparada em worktree da main exata. Aplicativo existente e alterações locais de outro checkout preservados. Windows observado offline.

## INFERÊNCIA

O fluxo está preparado para repetição por empresa sem compartilhar dados privados. A validação sintética e a publicação não comprovam autorização OAuth real, instalação do agente no destino ou transmissão real de documentos WMGJ nesta revisão.

## PENDÊNCIA

- Credencial de integração da organização, fontes delimitadas e credenciais/consentimentos próprios dos provedores para ativar a primeira transmissão física.
- Configuração e ativação do agente no destino identificado, seguidas de recibo e readback reais. Fonte preparada não equivale a componente instalado.
- Inscrição/renovação OAuth automática e extração de formatos não estruturados continuam pendentes; os adaptadores atuais leem exportações JSON no escopo autorizado e declaram cobertura limitada.
- Adoção operacional no motor local requer recibo próprio. Rotina nativa `AURORA-INSTALL-INTEGRATION-001` e padrão reutilizável representados em código/documentação, sem alegação de treinamento de pesos.

## Continuidade

Cloud é o control plane primário; Windows é servidor físico/fallback para trabalho pesado; Mac é contingência temporária leve; cliente mantém leitura/cache/fila seguros quando disponível. Retomar da evidência acima, preservar amostra maio/2026, bloqueio de escrita e gates já encerrados. Não repetir restore, rotação HMAC ou ingestão inicial. Esta publicação é HML; não comprova atualização produtiva.

Evidências: [PR242](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/pull/242), [CI da main](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/38435289308), [deploy e publicação](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/38435627327).
