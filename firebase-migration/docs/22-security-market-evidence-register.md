# AURORA NEXUS — Registro de Evidências de Segurança para Mercado

**Código:** AURORA-SEC-001-EVIDENCE  
**Uso:** procurement, due diligence, homologação e liberação comercial.  
**Regra:** status documental não substitui evidência técnica; evidência técnica não substitui auditoria/certificação independente.

## Estados

- COMPLETE_VERIFIED — evidência atual e verificável.
- PARTIAL — existe material, mas faltam aprovação, escopo ou prova operacional.
- SPECIFIED — requisito definido, ainda não implantado.
- MISSING — artefato ainda não localizado/criado.
- EXTERNAL_REQUIRED — depende de terceiro/auditoria/autoridade.

## Registro inicial

| Artefato / Controle | Estado inicial | Evidência atual | Próximo gate |
|---|---|---|---|
| Arquitetura e data flow | PARTIAL | `firebase-migration/README.md`, docs 02 e 16 | consolidar DFD formal por trust boundary |
| Inventário de ativos e dados | PARTIAL | docs de inventário/migração | inventário de ativos, owners e criticidade |
| Política de Segurança da Informação | PARTIAL | docs 06, 09, 13 + AURORA-SEC-001 | aprovação corporativa/versionamento |
| Política de Controle de Acesso | PARTIAL | Security Rules, membership, RBAC | revisão formal periódica + matriz de acesso |
| Política de Criptografia e Chaves | PARTIAL | política CI-validada; HMAC implementado; AES/KMS/CMEK ainda não implantados | KMS/CMEK/envelope encryption homologados |
| Secure SDLC | PARTIAL | AURORA-DEV-001 + workflows | política formal + métricas |
| Vulnerability/Patch Management | PARTIAL | CodeQL ativo; `npm audit --omit=dev --audit-level=high` cobre Functions; ruleset de bloqueio ainda não comprovado | ampliar cobertura + ruleset + SLA/exceções |
| Threat model | MISSING | — | STRIDE/abuse cases por trust boundary |
| Matriz de riscos de segurança | MISSING | — | registro de risco, owner e risco residual |
| RoPA / registro de tratamentos | MISSING | — | mapear finalidade, base legal, titulares e fluxo |
| RIPD/DPIA | EXTERNAL_REQUIRED | — | elaborar quando risco/tratamento justificar |
| Retenção e descarte | PARTIAL | requisitos dispersos | tabela por categoria + legal hold |
| Incident Response Plan | MISSING | — | playbook, RACI, contatos e exercício |
| Comunicação ANPD/titular | SPECIFIED | AURORA-SEC-001 | procedimento operacional e templates |
| BCP/Disaster Recovery | PARTIAL | PITR/backup/rollback previstos | RTO/RPO + tabletop + restore real |
| Backup/restore | PARTIAL | gates versionados | evidência de backup READY + restore real |
| Logging/monitoramento | PARTIAL | auditEvents/log sanitizado | política, alertas, retenção e revisão |
| Fornecedores/subprocessadores | MISSING | — | inventário, risco, DPA e localização de dados |
| DPA / contrato de tratamento | MISSING | — | modelo jurídico e anexos de segurança |
| Direitos dos titulares | MISSING | — | processo, canal, identidade e SLA |
| Governança de IA | PARTIAL | regras de revisão humana/evals | inventário de modelos + risco + incidentes |
| SBOM | MISSING | — | gerar por release comercial |
| SAST/CodeQL | PARTIAL | workflow executável para JavaScript/TypeScript e Python; resultado deve ser associado ao SHA final | CI verde no SHA final + ruleset exigindo resultado |
| Dependency scanning | PARTIAL | Dependabot + npm audit de dependências de produção das Functions | cobrir Python, demais módulos e política de exceção/SLA |
| Secret scanning | SPECIFIED | proibição documental não comprova scanner habilitado | habilitar/provar scanning, push protection ou equivalente e resposta |
| Pentest independente | EXTERNAL_REQUIRED | — | executar antes de escala com dado sensível |
| Evidência de remediação | MISSING | — | fechar highs/criticals com prova |
| Revisão de acesso | MISSING | — | periodicidade, owner e primeira revisão |
| Change/release management | PARTIAL | Release Cockpit/AURORA-DEV-001 | aprovação formal e trilha por release |
| SLA/SLO/Suporte | MISSING | — | disponibilidade, resposta e suporte |
| Security questionnaire pack | MISSING | — | questionário padrão para clientes |
| Trust Center / dossiê | MISSING | — | publicar apenas evidência comprovada |
| ISO/IEC 27001 | EXTERNAL_REQUIRED | não certificada | projeto ISMS + auditoria independente |
| ISO/IEC 27701 | EXTERNAL_REQUIRED | não certificada | projeto PIMS + auditoria independente |
| SOC 2 | EXTERNAL_REQUIRED | não auditado | avaliar demanda comercial e escopo |

## Controles criptográficos ainda não homologados\n\n- TLS 1.2 mínimo / TLS 1.3 preferencial: **SPECIFIED/PARTIAL**; HTTPS existente não comprova versão negociada em todos os endpoints.\n- AES-256-GCM / envelope encryption: **SPECIFIED**; implementação e testes de adulteração/AAD/rotação ainda necessários.\n- Cloud KMS/KEK e Firestore CMEK: **SPECIFIED**; nenhuma implantação é inferida desta política.\n- Bloqueio high/critical no GitHub: **SPECIFIED** até ruleset verificado.\n- Exceção legada: `GOOGLE_SERVICE_ACCOUNT_JSON` permanece restrita ao provisionamento Google Workspace via GitHub Actions secret; migrar para fluxo keyless compatível com domain-wide delegation antes de declarar readiness comercial de segurança.\n\n## Gate comercial

### Piloto sem dado clínico identificável

Necessita, no mínimo, acesso nominal, MFA administrativo, segregação, logs, backup, contrato/DPA, incident response básico, CI de segurança e dados sintéticos/anonimizados.

### Piloto com dado pessoal real

Acrescentar RoPA, base legal/finalidade, retenção, direitos do titular, subprocessadores, análise de risco, restore comprovado e criptografia adequada à classificação.

### Dado clínico identificável

Bloqueado até envelope encryption homologada, KMS, estratégia CMEK comprovada, RIPD/DPIA conforme aplicável, pentest, exercício de incidente e aceite formal do risco residual.

### Escala enterprise

Requer evidência recorrente e independente. ISO/IEC 27001, ISO/IEC 27701 e SOC 2 são decisões de posicionamento/procurement; não são declaradas como existentes antes da auditoria competente.
