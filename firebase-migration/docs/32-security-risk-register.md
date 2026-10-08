# AURORA NEXUS — Matriz de Riscos de Segurança

**Código:** AURORA-SEC-002-RISK  
**Versão:** 1.0.0-draft  
**Owner do processo:** Security/Governance  
**Regra:** risco HIGH/CRITICAL não é aceito implicitamente.

## 1. Escala

- Probabilidade: 1 rara, 2 improvável, 3 possível, 4 provável, 5 quase certa.
- Impacto: 1 baixo, 2 moderado, 3 relevante, 4 severo, 5 catastrófico.
- Score = probabilidade × impacto.
- 1–4 LOW; 5–9 MEDIUM; 10–16 HIGH; 17–25 CRITICAL.

## 2. Registro

| ID | Risco | P | I | Score | Classe | Controles atuais | Tratamento requerido | Owner | Residual alvo |
|---|---|---:|---:|---:|---|---|---|---|---|
| R001 | exposição cross-tenant por regra/consulta incorreta | 3 | 5 | 15 | HIGH | orgId, membership, Security Rules, testes | pentest multi-tenant + negative tests HML | Security | LOW |
| R002 | credencial/sessão administrativa comprometida | 3 | 5 | 15 | HIGH | Auth, revogação, MFA crítico | MFA admin universal, sessão curta, access review | IAM | MEDIUM |
| R003 | dado clínico persistido em plaintext | 2 | 5 | 10 | HIGH | clinicalSensitiveEnabled=false | AES-256-GCM + KMS + CMEK + schema + tests | Data Security | LOW |
| R004 | CMEK desabilitada ou IAM revogado | 3 | 5 | 15 | HIGH | política KMS | HML failure test + monitoring + recovery runbook | Cloud Security | MEDIUM |
| R005 | destruição de key version ainda necessária | 2 | 5 | 10 | HIGH | destruição bloqueada por política | dual control, org policy, inventory antes de destroy | KMS Owner | LOW |
| R006 | backup existe mas restore não funciona | 3 | 5 | 15 | HIGH | PITR/backup gates | restore real recorrente em banco novo | DR Owner | LOW |
| R007 | supply-chain compromise em dependency/Action | 3 | 5 | 15 | HIGH | lockfiles, CodeQL, npm audit | dependency review, pinning, SBOM, remediation SLA | AppSec | MEDIUM |
| R008 | vulnerabilidade moderada uuid/gaxios permanece transitiva | 3 | 3 | 9 | MEDIUM | audit conhecido | atualizar árvore quando compatível; rastrear GHSA-w5hq-g745-h8pq | AppSec | LOW |
| R009 | segredo exposto em Git/log/documento | 3 | 5 | 15 | HIGH | Secret Manager, proibição de log | secret scanning/push protection + rotação automática | AppSec | LOW |
| R010 | prompt injection em documento/e-mail | 4 | 4 | 16 | HIGH | documento tratado como dado, revisão humana | evals adversariais, tool allowlist, no direct execution | AI Security | MEDIUM |
| R011 | IA produz decisão crítica sem validação | 3 | 5 | 15 | HIGH | human review gate | policy enforcement + audit + evals | AI Governance | LOW |
| R012 | replay/duplicidade na ingestão | 3 | 4 | 12 | HIGH | HMAC v2, nonce, timestamp, idempotência | métricas de replay + rate limiting | Backend | LOW |
| R013 | permissões excessivas WIF/service account | 3 | 5 | 15 | HIGH | WIF e escopo por workflow | IAM diff, least privilege, periodic review | Cloud Security | MEDIUM |
| R014 | main aceita merge sem required checks | 4 | 4 | 16 | HIGH | CI existe, ruleset ausente | criar ruleset/protection com checks obrigatórios | Repo Admin | LOW |
| R015 | instalador sem assinatura/notarização | 3 | 4 | 12 | HIGH | hashes e download privado | assinatura/notarização/provenance | Release | LOW |
| R016 | fonte Gmail/Drive coletada além do escopo | 3 | 4 | 12 | HIGH | autorização declarativa | allowlist técnica de pastas/labels + RoPA | Privacy | LOW |
| R017 | retenção excessiva/indefinida | 4 | 4 | 16 | HIGH | requisitos parciais | tabela de retenção por classe + legal hold | Privacy | MEDIUM |
| R018 | incidente não identificado/comunicado a tempo | 3 | 5 | 15 | HIGH | audit/logs parciais | IRP, alertas, RACI, tabletop, SLA interno | Security | LOW |
| R019 | logs contêm conteúdo sensível | 2 | 5 | 10 | HIGH | sanitização e hashes | testes de log leakage + revisão | Observability | LOW |
| R020 | acesso de ex-funcionário/usuário permanece ativo | 3 | 4 | 12 | HIGH | membership revogável | offboarding + revisão periódica | IAM | LOW |
| R021 | indisponibilidade de Google Cloud/conector | 3 | 4 | 12 | HIGH | rollback e fonte preservada | BCP/SLO/modo degradado | Operations | MEDIUM |
| R022 | corrupção de dado financeiro sem evidência | 2 | 5 | 10 | HIGH | sourceVersion/hash/revisão | reconciliation invariants + immutable evidence | Revenue Audit | LOW |
| R023 | banco HML/produção confundidos | 2 | 5 | 10 | HIGH | project checks e confirmations | org policy/tags/environment gates | Cloud Security | LOW |
| R024 | export/relatório expõe dado não autorizado | 3 | 4 | 12 | HIGH | RBAC | export policy, watermark, field-level filtering | Product | LOW |
| R025 | subprocessador não inventariado | 3 | 4 | 12 | HIGH | documentação parcial | vendor register + DPA + approval gate | Privacy | LOW |
| R026 | Admin Master concentra privilégios | 3 | 5 | 15 | HIGH | MFA/audit required | break-glass, dual review, scoped admin operations | Governance | MEDIUM |
| R027 | key rotation deixa versão antiga desativada cedo | 2 | 5 | 10 | HIGH | policy | verificar activeKeyVersion antes de disable | KMS Owner | LOW |
| R028 | dado clínico enviado a IA externa | 2 | 5 | 10 | HIGH | clinical gate | DLP/schema block + provider contract/retention review | AI/Privacy | LOW |
| R029 | advisories residuais nas ferramentas de teste de Security Rules | 3 | 4 | 12 | HIGH | dependências de desenvolvimento separadas, fixtures sintéticas, CI de validação sem credenciais ou deploy | corrigir árvore upstream e submeter proposta temporária SEC-EXC-TEST-20261007 à revisão do owner | AppSec / Security Governance | LOW |

## 3. Regras de tratamento

- CRITICAL: bloquear release/operação até redução ou aceite executivo formal excepcional.
- HIGH: owner, prazo, plano, evidência e risco residual aprovados antes de produção sensível.
- MEDIUM: remediation SLA definido e acompanhamento mensal.
- LOW: aceitar somente se documentado e monitorado.

## 4. Riscos que bloqueiam CLINICAL_SENSITIVE

R001, R003, R004, R005, R006, R007, R009, R010, R013, R014, R017, R018, R019, R025, R026, R027 e R028 permanecem gates explícitos.

## 5. Evidência

A matriz deve ser atualizada após: incidente, pentest, nova integração, alteração IAM/KMS, mudança de arquitetura, aquisição de fornecedor, nova categoria de dado ou release que mude trust boundary.

## 6. Proposta temporária para R029 — revisão pendente

- **ID:** SEC-EXC-TEST-20261007
- **Status:** `PENDING_OWNER_REVIEW`
- **Owner requerido:** AppSec / Security Governance, com aceite explícito do titular responsável.
- **Revisão até:** 14/10/2026, no fuso `America/Sao_Paulo`.

**Escopo:** somente as ferramentas de teste em `firebase-migration/tests`. Esta proposta não aceita o risco, não libera produção e não altera os gates atuais.

No candidato derivado da baseline `203670bc562bbb48694b08e55af363a07d90a8f5`, a auditoria desse pacote passou de 29 agregações (1 crítica, 17 altas e 11 moderadas) para 11 (0 críticas, 7 altas e 4 moderadas). Essas contagens incluem pacotes afetados transitivamente; não são contagens de falhas independentes ou prova de exploração. A auditoria do runtime Functions é uma verificação separada e não cobre as ferramentas de teste.

O candidato atualiza o Firebase CLI de teste de `15.28.1` para `15.32.1`, preserva `firebase@12.18.0` e `@firebase/rules-unit-testing@5.0.2` e atualiza o lockfile. Os nove alertas altos/críticos inicialmente identificados no GitHub (proxy-addr, compression, SDK MCP, gRPC, undici e fast-uri) têm versões corrigidas na árvore candidata. O fechamento desses alertas na branch padrão só pode ser confirmado após integração e nova leitura do GitHub.

O override de `@grpc/grpc-js@1.13.6` fica restrito à árvore de `@firebase/firestore`. Ele mantém o major 1, mas ultrapassa a faixa upstream `~1.9.0`; exige instalação limpa e paridade no emulador, e não é apresentado como atualização dentro da faixa original. Os advisories de gRPC descrevem uso de servidor; a suíte usa o cliente Firebase. Esse contexto limita a exposição observada, sem provar ausência de risco. A atualização minor do CLI também traz majors transitivos declarados pelo próprio CLI, que precisam passar pela mesma validação.

| Origem do risco residual | Versão candidata | Severidade da folha | Tratamento requerido |
|---|---|---|---|
| `braces`, via `chokidar` do Firebase CLI | 3.0.3 | HIGH | acompanhar correção upstream; a consulta ao registry não encontrou versão corrigida publicada. Não substituir o watcher por outro major sem validar seu contrato |
| `basic-ftp`, via `get-uri` / agentes de proxy do Firebase CLI | 5.3.1 | HIGH | versão corrigida 6.2.2 exige sair do intervalo do pacote pai; aguardar atualização upstream ou validar mudança própria em incremento separado |
| `@opentelemetry/core`, via `@google-cloud/pubsub` | 1.30.1 | MODERATE | acompanhar atualização compatível da cadeia do CLI |
| `uuid`, via `gaxios` do Firebase CLI | 9.0.1 | MODERATE | acompanhar atualização compatível da cadeia do CLI; o override do runtime Functions não se propaga a este pacote |

Compensações verificáveis do fluxo existente:

- `Validate Firestore Migration` possui `permissions: contents: read`, não recebe credenciais de cloud e não executa deploy.
- O bootstrap usa `npm ci --ignore-scripts`, projeto sintético `wmgj-firestore-rules-test` e fixtures sintéticas no emulador. Downloads de pacotes e do emulador continuam usando a rede; isolamento de rede não foi comprovado.
- O pacote de testes declara essas ferramentas como `devDependencies`. A configuração Firebase aponta o código de Functions para seu diretório próprio, com manifesto e lockfile separados; este candidato não altera suas dependências de runtime nem o CLI de deploy.
- A instalação local no Node `22.23.3`, `npm ls` e o carregamento do CLI `15.32.1` passaram. O workflow existente usa Node 22 e Java 21. Os 27 testes de Rules e os checks necessários continuam obrigatórios no SHA final do PR; os resultados anteriores não substituem essa verificação.

Antes de qualquer aceite, registrar o SHA final, run de CI, resultado dos 27 testes de Rules, auditoria atualizada, responsável pela decisão e condições de revogação. A proposta permanece pendente mesmo com CI verde. A revisão deve ocorrer até a data acima ou antes de mudança de escopo, introdução de credenciais/dados reais, falha de teste ou novo advisory relevante.

Rollback do candidato: reverter o commit que altera manifesto, lockfile e este registro, mantendo o risco aberto e a promoção bloqueada. Não aplicar downgrade do Firebase SDK, `npm audit fix --force` ou alteração de política para ocultar os advisories.
