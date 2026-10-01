# AURORA NEXUS — Threat Model

**Código:** AURORA-SEC-002-TM  
**Versão:** 1.0.0-draft  
**Método:** STRIDE + abuso operacional/LGPD  
**Escopo:** web/PWA, apps instaláveis, Firebase/Google Cloud, conectores, CI/CD, IA opcional e operação multi-tenant.

## 1. Objetivo

Modelar ameaças antes de promover o AURORA NEXUS para piloto real, dados pessoais ou dados clínicos identificáveis. Este documento é um artefato técnico; não substitui pentest, RIPD/DPIA, parecer jurídico ou certificação independente.

## 2. Ativos críticos

| ID | Ativo | Criticidade |
|---|---|---|
| A01 | Identidades Firebase, sessões, MFA e claims | CRITICAL |
| A02 | Memberships, orgId, roles e escopo por unidade | CRITICAL |
| A03 | Firestore operacional, evidências e audit trail | CRITICAL |
| A04 | Dados financeiros, contratuais e fiscais | HIGH |
| A05 | CLINICAL_SENSITIVE e identificadores de pacientes | CRITICAL |
| A06 | Cloud KMS KEKs, versões e IAM | CRITICAL |
| A07 | DEKs envelopadas e envelopes AES-256-GCM | CRITICAL |
| A08 | Secret Manager, HMAC keyrings e OAuth secrets | CRITICAL |
| A09 | Backups, PITR e artefatos de restore | CRITICAL |
| A10 | GitHub/WIF/CI/CD e artefatos de release | HIGH |
| A11 | Gmail/Drive/Sheets e demais fontes autorizadas | HIGH |
| A12 | Instaladores, wrappers e updater desktop | HIGH |
| A13 | Modelos/prompts/outputs de IA e evals | HIGH |

## 3. Trust boundaries

1. Cliente visual → Firebase Hosting/backend.
2. Firebase Auth/App Check → Cloud Functions.
3. Function → Firestore/Storage.
4. Function → Secret Manager/KMS.
5. GitHub Actions → Google Cloud via OIDC/WIF.
6. Conectores → Gmail/Drive/Sheets e fontes de cliente.
7. Coletor local → endpoint de ingestão.
8. Documento ingerido → parser/classificador/IA.
9. Admin humano → consoles GitHub/Firebase/Google Cloud.
10. Tenant A → tenant B: fronteira obrigatoriamente impermeável.

## 4. Fluxos de maior risco

```text
usuário → Auth/MFA → membership → backend → Firestore
fonte externa → ingestão HMAC/idempotência → validação → Firestore
backend → KMS unwrap/wrap → AES-256-GCM → envelope persistido
GitHub → WIF → deploy controlado
backup → restore em banco novo → reconciliação → promoção
documento não confiável → parser/IA → proposta → revisão humana → ação autorizada
```

## 5. Catálogo STRIDE

| ID | STRIDE | Cenário | Impacto | Controles atuais | Gate residual |
|---|---|---|---|---|---|
| T01 | Spoofing | roubo de sessão/credencial | acesso indevido multi-tenant | Auth, revogação, MFA crítico | MFA universal administrativo + revisão de sessão |
| T02 | Spoofing | conta compartilhada ou impersonation | perda de não repúdio | usuários individuais, audit trail | proibir conta genérica e revisar acessos |
| T03 | Tampering | alteração de ciphertext/envelope | corrupção/exposição | AES-256-GCM + AAD | HML KMS real + pentest |
| T04 | Tampering | transplantar ciphertext entre tenants | cross-tenant | AAD com orgId | teste HML e adversarial |
| T05 | Tampering | alteração silenciosa de documento/faturamento | decisão financeira errada | hash, sourceVersion, idempotência | proveniência end-to-end |
| T06 | Repudiation | ação crítica sem trilha | disputa/auditoria insuficiente | auditEvents server-only | retenção e revisão formal |
| T07 | Information Disclosure | falha em Security Rules/orgId | vazamento entre clientes | deny-by-default, rules tests | pentest e teste multi-tenant real |
| T08 | Information Disclosure | segredo no front-end/log | comprometimento de backend | Secret Manager, log sanitizado | secret scanning/push protection comprovados |
| T09 | Information Disclosure | dado clínico em plaintext | dano grave/LGPD | clinicalSensitiveEnabled=false | envelope + CMEK + RIPD + pentest |
| T10 | DoS | KMS key desabilitada/revogada | Firestore CMEK indisponível | key policy/rollback especificados | teste controlado de falha/recovery HML |
| T11 | DoS | backup inexistente ou restore falha | perda operacional | PITR/backup gates | restore real recorrente |
| T12 | Elevation | role/claim excessiva | admin indevido | backend revalidation/RBAC | access review periódica |
| T13 | Elevation | WIF/service account amplo | alteração cloud | WIF, menor privilégio pretendido | policy review + ruleset |
| T14 | Supply chain | dependência/Action comprometida | execução maliciosa CI | lockfiles, CodeQL, npm audit | pinning/SBOM/dependency review abrangente |
| T15 | Supply chain | instalador adulterado | endpoint comprometido | SHA-256, download privado | assinatura/notarização e provenance |
| T16 | Injection | prompt injection em PDF/e-mail | ação indevida | documento tratado como dado, revisão humana | evals adversariais + tool policy |
| T17 | Injection | payload malformado/SSRF | backend compromise | schemas fechados, allowlists | DAST/pentest |
| T18 | Replay | evento HMAC reutilizado | duplicidade/fraude | nonce, timestamp, idempotência | monitorar colisões e abuso |
| T19 | Privacy | coleta excessiva de Gmail/Drive | desvio de finalidade | fontes autorizadas/minimização | RoPA + allowlist de pastas/labels |
| T20 | Privacy | retenção indefinida | risco regulatório | requisitos parciais | política de retenção por classe |
| T21 | Admin | KMS key destruction | perda irreversível | destruição proibida sem gate | dual control + org policy |
| T22 | Admin | main sem ruleset | bypass de checks | CI existente | ruleset obrigatório em main |
| T23 | Vendor | indisponibilidade Google/OpenAI/conector | operação degradada | IA não é motor essencial | BCP e modos degradados |
| T24 | Insider | acesso legítimo abusivo | exfiltração | RBAC/audit | least privilege + access review + alertas |

## 6. Abuse cases prioritários

- usuário de um cliente tenta consultar IDs de outro orgId;
- auditor com papel válido tenta elevar para org_admin;
- documento instrui o sistema a ignorar políticas ou executar ferramenta;
- invasor reproduz requisição HMAC dentro da janela;
- operador cola segredo em campo/documento ingerido;
- administrador desabilita CMEK ativa;
- workflow tenta deploy fora do SHA aprovado;
- artefato binário diverge do manifesto;
- backup existe, mas nenhuma restauração foi comprovada;
- dado clínico tenta entrar por campo genérico/renomeado;
- modelo de IA devolve instrução financeira/contratual como decisão final.

## 7. Critério de aceitação

Nenhuma ameaça CRITICAL/HIGH pode ser aceita implicitamente. O risco residual deve ter owner, evidência, prazo e decisão humana. CLINICAL_SENSITIVE permanece bloqueado enquanto T07, T09, T10, T11, T12, T14, T16 e T21 não possuírem evidência HML e, quando aplicável, validação independente.

## 8. Evidências exigidas para promoção

- CodeQL e dependency scan no SHA final;
- scan Codex Security quando a conexão estiver disponível;
- Security Rules e isolamento multi-tenant;
- KMS/CMEK HML;
- backup READY e restore em banco novo;
- teste controlado de chave indisponível e recuperação;
- RoPA, matriz de riscos, IRP e DPA;
- pentest antes de escala com dados sensíveis;
- aceite formal do risco residual.
