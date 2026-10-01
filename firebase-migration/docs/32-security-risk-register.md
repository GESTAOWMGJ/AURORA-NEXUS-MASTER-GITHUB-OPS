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

## 3. Regras de tratamento

- CRITICAL: bloquear release/operação até redução ou aceite executivo formal excepcional.
- HIGH: owner, prazo, plano, evidência e risco residual aprovados antes de produção sensível.
- MEDIUM: remediation SLA definido e acompanhamento mensal.
- LOW: aceitar somente se documentado e monitorado.

## 4. Riscos que bloqueiam CLINICAL_SENSITIVE

R001, R003, R004, R005, R006, R007, R009, R010, R013, R014, R017, R018, R019, R025, R026, R027 e R028 permanecem gates explícitos.

## 5. Evidência

A matriz deve ser atualizada após: incidente, pentest, nova integração, alteração IAM/KMS, mudança de arquitetura, aquisição de fornecedor, nova categoria de dado ou release que mude trust boundary.
