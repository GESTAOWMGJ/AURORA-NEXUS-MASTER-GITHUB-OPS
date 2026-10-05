# AURORA NEXUS — Registro de Evidências de Segurança para Mercado

**Código:** AURORA-SEC-001-EVIDENCE  
**Uso:** procurement, due diligence, homologação e liberação comercial.  
**Regra:** status documental não substitui evidência técnica; evidência técnica não substitui auditoria/certificação independente.

## Estados

- COMPLETE_VERIFIED — evidência atual e verificável.
- PARTIAL — existe material, mas faltam aprovação, escopo ou prova operacional.
- SPECIFIED — requisito definido, ainda não implantado.
- IMPLEMENTED — controle existe em código, ainda sem prova operacional HML.
- HML_VERIFIED — controle comprovado em homologação com evidência rastreável.
- MISSING — artefato ainda não localizado/criado.
- EXTERNAL_REQUIRED — depende de terceiro/auditoria/autoridade.

## Registro inicial

| Artefato / Controle | Estado inicial | Evidência atual | Próximo gate |
|---|---|---|---|
| Arquitetura e data flow | PARTIAL | `firebase-migration/README.md`, docs 02 e 16 | consolidar DFD formal por trust boundary |
| Inventário de ativos e dados | PARTIAL | docs de inventário/migração | inventário de ativos, owners e criticidade |
| Política de Segurança da Informação | PARTIAL | docs 06, 09, 13 + AURORA-SEC-001 | aprovação corporativa/versionamento |
| Política de Controle de Acesso | PARTIAL | Security Rules, membership, RBAC | revisão formal periódica + matriz de acesso |
| Política de Criptografia e Chaves | IMPLEMENTED | docs 23–28; AES-256-GCM envelope + KMS adapter + testes; KMS real ainda depende do gate HML | provisionar KMS e executar self-test MFA |
| Firestore CMEK HML | IMPLEMENTED | `policy/cmek-hml-baseline-v1.json`, `docs/35-firestore-cmek-hml-spec.md`, `scripts/aurora-cmek-hml.sh`, workflow manual | acesso HML externamente confirmado (02/10/2026); execução HML separadamente autorizada, cmekConfig, backup/restore e key-failure test |
| Secure SDLC | PARTIAL | AURORA-DEV-001 + workflows | política formal + métricas |
| Vulnerability/Patch Management | PARTIAL | CodeQL ativo; `npm audit --omit=dev --audit-level=high` cobre Functions; ruleset de bloqueio ainda não comprovado | ampliar cobertura + ruleset + SLA/exceções |
| Threat model | IMPLEMENTED | `docs/30-threat-model.md` — STRIDE + abuse cases | revisão humana + pentest/DAST por boundary |
| Matriz de riscos de segurança | IMPLEMENTED | `docs/32-security-risk-register.md` | atribuir owners nominais, prazos e aceite residual |
| RoPA / registro de tratamentos | SPECIFIED | `docs/31-lgpd-ropa.md` | preencher e aprovar por tenant/controlador |
| RIPD/DPIA | EXTERNAL_REQUIRED | — | elaborar quando risco/tratamento justificar |
| Retenção e descarte | PARTIAL | requisitos dispersos | tabela por categoria + legal hold |
| Incident Response Plan | IMPLEMENTED | `docs/33-incident-response-plan.md` | preencher contatos e executar tabletop |
| Comunicação ANPD/titular | SPECIFIED | AURORA-SEC-001 | procedimento operacional e templates |
| BCP/Disaster Recovery | PARTIAL | PITR/backup/rollback previstos | RTO/RPO + tabletop + restore real |
| Backup/restore | IMPLEMENTED | `docs/35-firestore-cmek-hml-spec.md`, `scripts/aurora-cmek-hml.sh` e workflow manual | executar HML: backup READY + restore em banco novo |
| Logging/monitoramento | PARTIAL | auditEvents/log sanitizado | política, alertas, retenção e revisão |
| Fornecedores/subprocessadores | MISSING | — | inventário, risco, DPA e localização de dados |
| DPA / contrato de tratamento | SPECIFIED | `docs/34-dpa-template-lgpd.md` | revisão jurídica, anexos por tenant e assinatura |
| Direitos dos titulares | MISSING | — | processo, canal, identidade e SLA |
| Governança de IA | PARTIAL | regras de revisão humana/evals | inventário de modelos + risco + incidentes |
| SBOM | MISSING | — | gerar por release comercial |
| SAST/CodeQL | CI_VERIFIED | `Security - CodeQL` run `36900700897` em `650f67d6...`: JS/TS e Python success | manter CI no SHA final e criar ruleset obrigatório |
| Dependency scanning | PARTIAL | `Validate Firestore Migration` run `36900701046`: sem high/critical; 2 moderadas (`uuid@9.0.1`/`gaxios@6.7.1`) | atualizar árvore transitiva, cobrir Python/demais módulos e SLA |
| Secret scanning | SPECIFIED | proibição documental não comprova scanner habilitado | habilitar/provar scanning, push protection ou equivalente e resposta |
| Pentest independente | EXTERNAL_REQUIRED | — | executar antes de escala com dado sensível |
| Evidência de remediação | PARTIAL | `docs/36-vulnerability-consolidated-report.md` registra baseline e achados moderados | anexar Codex Security e fechar/remediar achados |
| Revisão de acesso | MISSING | — | periodicidade, owner e primeira revisão |
| Recuperação IAM Eventarc HML | IMPLEMENTED / TESTED | `scripts/repair-hml-eventarc-iam.py`, testes sintéticos e doc 49 | revisar política atual com administrador GCP, aplicar apenas adições ausentes e validar novo deploy protegido |
| Change/release management | PARTIAL | Release Cockpit/AURORA-DEV-001 | aprovação formal e trilha por release |
| SLA/SLO/Suporte | MISSING | — | disponibilidade, resposta e suporte |
| Security questionnaire pack | PARTIAL | `docs/27-security-questionnaire-cryptography.md` cobre criptografia; pack corporativo ainda incompleto | consolidar questionário geral |
| Trust Center / dossiê | MISSING | — | publicar apenas evidência comprovada |
| Gate CLINICAL_SENSITIVE | IMPLEMENTED | `docs/37-clinical-sensitive-release-gate.md` mantém estado BLOCKED | promover somente após todos os gates HML/jurídicos/independentes |
| ISO/IEC 27001 | EXTERNAL_REQUIRED | não certificada | projeto ISMS + auditoria independente |
| ISO/IEC 27701 | EXTERNAL_REQUIRED | não certificada | projeto PIMS + auditoria independente |
| SOC 2 | EXTERNAL_REQUIRED | não auditado | avaliar demanda comercial e escopo |

## Controles criptográficos ainda não homologados

- TLS 1.2 mínimo / TLS 1.3 preferencial: **SPECIFIED/PARTIAL**; HTTPS existente não comprova versão negociada em todos os endpoints.
- AES-256-GCM / envelope encryption: **IMPLEMENTED/TESTED/CI** no código existente; KMS real e uso HML permanecem pendentes.
- Cloud KMS/KEK de aplicação: **IMPLEMENTED/PENDING_HML**; Firestore CMEK: automação **IMPLEMENTED**, porém banco CMEK **não criado** e permanece sem `HML_VERIFIED`.
- Bloqueio high/critical no GitHub: **SPECIFIED** até ruleset verificado.
- Exceção legada: `GOOGLE_SERVICE_ACCOUNT_JSON` permanece restrita ao provisionamento Google Workspace via GitHub Actions secret; migrar para fluxo keyless compatível com domain-wide delegation antes de declarar readiness comercial de segurança.

## Gate comercial

### Piloto sem dado clínico identificável

Necessita, no mínimo, acesso nominal, MFA administrativo, segregação, logs, backup, contrato/DPA, incident response básico, CI de segurança e dados sintéticos/anonimizados.

### Piloto com dado pessoal real

Acrescentar RoPA, base legal/finalidade, retenção, direitos do titular, subprocessadores, análise de risco, restore comprovado e criptografia adequada à classificação.

### Dado clínico identificável

Bloqueado até envelope encryption homologada, KMS, estratégia CMEK comprovada, RIPD/DPIA conforme aplicável, pentest, exercício de incidente e aceite formal do risco residual.

### Escala enterprise

Requer evidência recorrente e independente. ISO/IEC 27001, ISO/IEC 27701 e SOC 2 são decisões de posicionamento/procurement; não são declaradas como existentes antes da auditoria competente.

## Reconciliação de acesso Firestore CMEK — 02/10/2026

Fonte: Gmail `1a0fd2f51798e6ef`, Cloud Firestore Engineering Team. Acesso ao recurso externamente confirmado apenas para `wmgj-hml-jfn-20260927`; isso não comprova banco, `cmekConfig`, backup READY, restore reconciliado ou teste de falha/recuperação da chave. Firestore CMEK permanece sem promoção para `HML_VERIFIED`.

`aurora-nexus-prod-wmgj` é candidato: não reconhecido pelo provedor como projeto GCP naquela resposta, sem acesso CMEK concedido. Existência atual exige consulta autenticada bem-sucedida; não inferir inexistência de erro IAM. Allowlist organizacional não foi confirmada. Nenhuma autorização de apply ou produção deriva do e-mail.
