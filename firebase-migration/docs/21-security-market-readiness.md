# AURORA NEXUS — Segurança Digital e Market Readiness

**Código:** AURORA-SEC-001  
**Versão:** 1.0.0-draft  
**Escopo:** AURORA NEXUS / WMGJ / JF Neto SM  
**Objetivo:** elevar segurança técnica e evidência documental para homologação, venda B2B e futura escala regulada.

## 1. Estado verificado do produto

O repositório já possui controles relevantes: HMAC v2 rotacionável, nonce, idempotência, segregação por organização, Firebase Auth, membership, MFA em ações críticas, WIF/OIDC para CI/CD, Secret Manager, Security Rules testadas, delete protection, PITR/backup como gates e revisão humana.

Isso é uma base de engenharia. Não equivale a certificação ISO, SOC 2, pentest aprovado, conformidade LGPD completa nem produção comercial comprovada.

## 2. Upgrade criptográfico aprovado como arquitetura-alvo

### 2.1 Transporte

- TLS 1.3 preferencial.
- TLS 1.2 mínimo.
- Verificação de certificado obrigatória.
- mTLS para integrações privadas de alto risco quando tecnicamente aplicável.

### 2.2 Firestore em repouso

Firestore já criptografa dados em repouso por padrão. Para o nível comercial regulado, o alvo é CMEK com Cloud KMS, permitindo governança e auditoria das chaves.

Limitação estrutural importante: um banco Firestore já criado com Google default encryption não pode ser convertido in-place para CMEK. A promoção deve ocorrer para um banco novo criado com CMEK, usando clone, restore ou export/import conforme o caso e sempre com reconciliação, rollback e aprovação.

Nenhum banco existente será apagado ou recriado automaticamente por este incremento.

### 2.3 Criptografia de aplicação

Para CLINICAL_SENSITIVE e campos RESTRICTED selecionados:

- AES-256-GCM;
- DEK aleatória de 256 bits;
- nonce único de 96 bits;
- AAD vinculando tenant, entidade, schema e campo/documento;
- envelope encryption;
- KEK no Cloud KMS;
- HSM para contratos/risco que exijam maior assurance;
- plaintext de chave proibido em banco, código, GitHub ou log.

HMAC-SHA-256 permanece adequado para autenticação da ingestão; aumentar o tamanho do digest sem melhorar key management não elevaria materialmente a segurança.

## 3. Fases de implantação criptográfica

### Fase A — implementada em código

- política criptográfica versionada;
- AES-256-GCM envelope encryption implementada;
- DEK 256-bit por envelope, nonce 96-bit e AAD tenant-bound;
- adapter Cloud KMS por workload identity/ADC;
- self-test administrativo com MFA/CSRF/audit ledger;
- validação CI do baseline e testes de adulteração;
- CodeQL;
- Secret Manager/WIF preservados;
- dados clínicos continuam bloqueados até HML/produção comprovados.

### Fase B — homologação forte

- solicitar/confirmar disponibilidade de CMEK para Firestore Native;
- criar key ring e chave simétrica no mesmo requisito de localização;
- configurar IAM mínimo do service agent;
- rotação automática;
- Cloud Audit Logs para uso de KMS;
- criar banco HML CMEK novo;
- testar backup, restore, revogação e indisponibilidade de chave;
- validar latência e operação.

### Fase C — campo sensível

A primitive criptográfica e o schema de envelope estão implementados. Ainda falta promover o uso para campos clínicos reais:

- definir matriz de campos criptografados por entidade;
- HML KMS real + self-test MFA;
- teste de rotação/rewrap e rollback;
- proibir indexação/consulta em plaintext;
- documentar limitações de busca;
- habilitar dados clínicos somente após os gates regulatórios e de segurança.

### Fase D — produção

- migração controlada para banco CMEK;
- dupla reconciliação;
- corte somente após evidência;
- chave e banco com owners distintos quando possível;
- pentest independente;
- aceite formal de risco residual.

## 4. Documentação necessária para produto vendável

### Obrigatória para operação e LGPD

1. Política de Segurança da Informação.
2. Política de Controle de Acesso.
3. Política de Criptografia e Gestão de Chaves.
4. Política de Desenvolvimento Seguro.
5. Política de Vulnerabilidades e Patching.
6. Arquitetura e diagrama de fluxo de dados.
7. Inventário de ativos e dados.
8. Registro das Operações de Tratamento — RoPA.
9. Matriz controlador/operador/suboperadores.
10. RIPD/DPIA quando aplicável.
11. Política de retenção e descarte.
12. Plano de resposta a incidentes.
13. Processo de comunicação à ANPD/titulares quando aplicável.
14. Plano de continuidade e disaster recovery.
15. Evidência de backup e restore.
16. Política de logs e monitoramento.
17. Registro de fornecedores e subprocessadores.
18. DPA/modelo de contrato de tratamento de dados.
19. Processo de atendimento aos direitos dos titulares.
20. Registro de treinamento e responsabilidades.

### Obrigatória para procurement técnico B2B

21. Threat model.
22. Matriz de riscos e risco residual.
23. SBOM por release comercial.
24. Relatório de CodeQL/SAST.
25. Relatório de dependency scanning.
26. Relatório de secret scanning.
27. Pentest independente antes de escalar dado sensível.
28. Plano e evidência de remediação.
29. Matriz de acessos e última revisão.
30. Release/change management.
31. SLA/SLO e suporte.
32. Inventário de integrações e subprocessadores.
33. Security questionnaire pack.
34. Trust Center ou dossiê de segurança.

### IA

35. Política de Governança de IA.
36. Inventário de modelos/provedores.
37. finalidade, base de dados e retenção por uso;
38. registro de versões de modelo/prompt/schema;
39. evals, falhas conhecidas e taxa de revisão humana;
40. processo de incidentes de IA.

## 5. Referenciais de mercado

O produto deve ser mapeado, sem afirmar certificação, contra:

- LGPD e atos ANPD aplicáveis;
- ISO/IEC 27001:2022 — ISMS;
- ISO/IEC 27701:2025 — PIMS;
- NIST Cybersecurity Framework 2.0;
- NIST SP 800-218 SSDF 1.1 (a versão 1.2 permanece draft nesta data);
- OWASP ASVS 5.0;
- Firebase Security Checklist;
- requisitos específicos de TISS/TUSS e contratos quando houver saúde suplementar.

## 6. O que realmente muda a capacidade de venda

### Produto vendável para piloto controlado

Pode ser apresentado comercialmente quando houver:

- contrato e DPA;
- LGPD operacional mínima;
- login individual + MFA;
- segregação por cliente;
- backups e restore testados;
- logs;
- CI de segurança;
- gestão de vulnerabilidades;
- dados clínicos fora do escopo ou criptografia de aplicação homologada;
- incident response;
- evidência de homologação.

### Produto vendável para hospitais com dado sensível

Exige adicionalmente:

- criptografia de campo homologada;
- estratégia CMEK comprovada;
- KMS/Secret Manager;
- pentest independente;
- RIPD/DPIA conforme risco;
- subprocessadores contratualmente governados;
- exercício de incidente e recuperação;
- evidência de remediação.

### Enterprise/escala

ISO/IEC 27001, ISO/IEC 27701 e/ou SOC 2 podem reduzir atrito de procurement e aumentar confiança, mas são projetos de certificação/auditoria independentes. Não são declarados como já existentes nem como obrigação legal universal.

## 7. Critério de prontidão

AURORA-SEC-001 usa os estados:

SPECIFIED → IMPLEMENTED → TESTED → CI_VERIFIED → HML_VERIFIED → PRODUCTION_VERIFIED → AUDITED_INDEPENDENTLY → CERTIFIED

O baseline criptográfico de aplicação pode atingir IMPLEMENTED/TESTED/CI_VERIFIED quando o código e os checks correspondentes estiverem verdes no SHA final. Isso não eleva automaticamente KMS para HML_VERIFIED, nem CMEK, pentest, LGPD operacional ou produção. Cada controle mantém evidência separada.\n\nExceção legada conhecida: o provisionamento de Google Workspace ainda consome `GOOGLE_SERVICE_ACCOUNT_JSON` via GitHub Actions secret para domain-wide delegation. A exceção é transitória e deve migrar para mecanismo keyless/WIF + assinatura compatível antes de readiness comercial de segurança.
