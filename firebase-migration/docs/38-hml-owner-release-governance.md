# Aprovação do titular para promoção HML

Em 08/10/2026, o titular declarou ter realizado a revisão das quatro candidatas e do gateway, aceitou especificamente R029 no escopo e prazo existentes e autorizou integração, publicação e promoção HML. A decisão sanitizada e versionada está em [hml-owner-release-approval-v1.json](../policy/hml-owner-release-approval-v1.json).

Em 12/10/2026, o titular reafirmou: “Revisão humana APROVADA E REALIZADA !!! das quatro candidatas e do gateway, com decisão específica de R029.” Essa reafirmação fica preservada na decisão original de 08/10, sem substituir sua identidade, ampliar as cabeças revisadas ou estender naquele momento o prazo original `2026-10-15T03:00:00.000Z`.

Em 14/10/2026, por nova autorização direta, o titular renovou expressamente HML/R029 até 00:00 de 16/10/2026 em Brasília (`2026-10-16T03:00:00.000Z`), com revisão até 15/10. Aceitou os 11 riscos residuais (7 altos, 4 moderados, zero crítico) no mesmo escopo HML, para recuperação/publicação da beta e testes sintéticos Windows/nuvem. A política registra predecessor e novo prazo na reafirmação `AURORA-HML-OWNER-RENEWAL-20261014`. Produção e dados clínicos permanecem excluídos; aprovação real do futuro run, CI, smokes, assinatura e CAS continuam obrigatórios. Não há alegação de nova revisão humana integral ou independente da main posterior.

Em 22/10/2026, a resposta “Renovar nesse escopo até 26/10” à pergunta
`call_8636915dde044199adf7c46270661d0f` originou a decisão adicional
`AURORA-HML-OWNER-RENEWAL-20261022-TO-20261026`: prazo até
`2026-10-26T03:00:00.000Z` (26/10 às 00h de Brasília), revisão até 25/10 e os
mesmos 11 riscos residuais somente das ferramentas de teste HML. A política
preserva como predecessor o aceite separado de 22/10 para PR #299, que terminava
em `2026-10-23T23:00:00.000Z`; sua aprovação de código não é atribuída a outro
head. A renovação cobre publicação da beta e testes sintéticos Windows/nuvem,
sem produção, dados clínicos ou ativação da pasta real. Não prorroga credenciais,
escopo HMAC documental, IAM, piloto real ou janela de regularização da fonte.
Os gates técnicos e de aprovação real do run permanecem; não há nova alegação de
revisão independente, deploy ou ingestão comprovados.

| Objeto revisado | Identidade exata |
|---|---|
| PR #183 | `c76c22c47f2591c33fd9e4bb4216e6b5e593fe1f` |
| PR #184 | `bf5bbc1146245bdf112cedfd9a9c6cc558e46106` |
| PR #187 | `4ae55d9c23f3c5f0c660c7cc579bdf6e8acba017` |
| PR #190 | `804d4a460972cdcc5924cb3cf46a65eddff08b8b` |
| Gateway local | `d94f2c93ca25b8961cec25cb032a636fa630fc64` |
| Patch do gateway SHA-256 | `53531906693f6acc60e52084f10722c592c8aefbbf9885029f3bd2ddd2f6269f` |

`DIRECT_OWNER_CHAT` registra essa decisão humana. A conta GitHub de execução do repositório é `GESTAOWMGJ`; esse identificador técnico não é prova de MFA pessoal nem substitui a proveniência da declaração do titular. Main posterior, este incremento e outros deltas não recebem uma alegação retroativa de revisão integral ou independente.

O gateway v5 é um incremento técnico posterior, fonte `46fa11c7d4be68893a616530509872254ef809e6`, deploy `appgdep_6ac74c3ecd8081919043fc4bf3e2da37` concluído em 08/10/2026 às 07:54:57 UTC, com 22 cenários isolados e 8 GETs anônimos compilados aprovados conforme evidência técnica registrada pelo executor. Esse resultado não amplia retroativamente o escopo da revisão humana de `d94f2c93` nem comprova uma sessão pessoal/MFA.

O caminho padrão `GITHUB_PULL_REQUEST_REVIEW` preserva a exigência de review humano aprovado, no head exato, por pessoa distinta do autor. O modo opcional `OWNER_DEPLOYMENT_APPROVAL` permite a governança pelo titular somente no projeto `wmgj-hml-jfn-20260927`, ambiente `firebase-homologation`, branch `main`, até o prazo expressamente renovado acima. Ele exige:

- PR integrado cujo merge commit seja o SHA exato promovido, main atual e CI/checks exatos aprovados;
- actor e triggering actor GitHub do titular, ambos do tipo User, e identidade do runner correspondente;
- reviewer nominal ainda configurado no ambiente, política de deployment restrita somente à main e configuração que permita explicitamente o aceite pelo próprio titular;
- aprovação real desse titular em `GET /actions/runs/{runId}/approvals`, no mesmo run do publisher e no ambiente HML exato; ausência, Bot, outro titular/ambiente ou qualquer rejeição registrada bloqueiam;
- as quatro cabeças originalmente revisadas ainda identificadas nos PRs integrados;
- deploy e todos os smokes existentes aprovados, bytes reais, assinatura Ed25519, predecessor explícito e CAS/histórico atômico, com main e prazo novamente conferidos em cada tentativa transacional.

O actor, um booleano, uma opção de input ou a possibilidade de bypass administrativo não constituem aprovação. O publisher usa `github.token` com `actions: read` e `pull-requests: read`: seu código lê evidências e não cria approvals/reviews. O ambiente permite revisão pelo mesmo titular; portanto este modo não representa segregação de funções ou revisão independente. A main observada sem branch protection/ruleset não deve ser descrita como enforcement de checks por proteção de branch.

Os endpoints de [environment](https://docs.github.com/en/rest/deployments/environments#get-an-environment), [branch policies](https://docs.github.com/en/rest/deployments/branch-policies#list-deployment-branch-policies) e [review history do run](https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run) exigem `Actions: read` e aceitam installation access tokens. A documentação de permissão não é prova de uma chamada já executada com o token desse job: resposta indisponível, 403/404, truncamento ou evidência divergente impedem a promoção, sem fallback para token privilegiado ou flag de aprovação.

O certificado mantém o schema atual. O histórico protegido registra separadamente `approvalProvenance`, incluindo modo, SHA promovido, run/ambiente/titular, digest da decisão, cabeças originais, gateway e escopo de R029. Nenhum review GitHub é fabricado; nenhum pin é publicado pela existência desta documentação ou de testes. GitHub e Firestore continuam sistemas separados, sem transação distribuída.

O booleano compatível `humanReviewApproved` representa a aprovação humana para promoção segundo o modo registrado no histórico. No modo do titular ele não significa review independente ou leitura integral da main posterior. A declaração de revisão original continua limitada às identidades acima.

Na reconciliação local de 12/10, a baseline observada é `cd296dc46366429d5b09d7117f5ee66e757980b5`. O ambiente GitHub consultado conserva reviewer `GESTAOWMGJ` do tipo User, ID `278915189`, e uma única branch policy `main`. O run `38280466024` registra aprovação desse titular no ambiente `firebase-homologation`, ID `22941465860`, e validação bem-sucedida; seu deploy falhou no smoke autenticado e o publisher foi pulado. A aprovação real desse run não comprova deploy/smoke nem libera promoção. O guard `CANONICAL_RELEASE_PROMOTION_REQUIRED`, a verificação do par Ed25519 e os gates de fonte, smoke e CAS permanecem preservados após #211/#212. Esta reconciliação é código/teste local; nenhum pin foi publicado por ela.

R029 mantém 7 agregações HIGH e 4 MODERATE, zero CRITICAL, apenas nas ferramentas de teste. As compensações, prazo e condições de suspensão estão no [registro de risco](32-security-risk-register.md). Produção e `CLINICAL_SENSITIVE` continuam fora desta autorização. Reverter este incremento restaura o modo exclusivamente baseado em review de PR, preservando o histórico já gravado.

## Tráfego da revisão exata

A promoção assinada exige o preflight canônico completo antes de autenticar a etapa de nuvem e novamente antes de alterar o tráfego. O helper `scripts/promote-hml-authgate-traffic.mjs` limita a alteração ao AuthGate HML existente, à revisão pronta declarada pela publicação atual e à main novamente conferida. Ele usa `ReplaceService` regional v1 com CAS por `metadata.resourceVersion`; template, environment e metadata permanecem em memória e são preservados, e somente `spec.traffic` muda. O readback precisa comprovar a geração reconciliada e 100% na revisão exata.

O snapshot sanitizado no `RUNNER_TEMP` preserva o tráfego anterior e a identidade da alteração própria. Falha ou cancelamento no job de deploy permite rollback somente se essa alteração ainda for a vigente e os destinos anteriores estiverem prontos. Resultado HTTP incerto, baseline `LATEST`, conflito concorrente ou falha posterior do publisher exigem reconciliação explícita. Não há rollback automático após uma possível gravação do pin: é necessário conferir o ponteiro e o histórico para preservar sua relação com a fonte realmente servida.

Em 12/10, a recuperação operacional restaurou 100% em `auroranexusauthgate-00016-mom`, anteriormente validada no run `37733907172`, e conferiu HTTP 200 no setup HML. Quatorze verificações HTTP anônimas e oito GETs do Worker compilado passaram. A origem canônica ainda retornava 404 e `platformRuntime/activeRelease` estava ausente. Essa recuperação preserva a entrada HML; não constitui promoção assinada, sessão nominal com MFA ou recibo de dispositivo.
