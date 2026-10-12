# AURORA-AUTOHML-001 — Robô intrínseco de homologação

Executor nativo de evidências, offline por padrão. Executa verificações allowlisted de destinos CLASP, contrato de autenticação, roteamento canônico e gate de leitura. Agenda diária em GitHub Actions, com `workflow_dispatch`. Sem acesso a secrets, OIDC, IAM, Firestore nem deployment; `contents:read`.

Não executa renovação OAuth, migração de dados, aprovação de ambiente protegido, homologação de paciente ou promoção de release. Logs são resumidos em status e código de saída; a evidência JSON possui hash SHA-256 canônico (integridade interna, **não** selo externo/WORM). A execução autenticada permanece responsabilidade do workflow protegido `.github/workflows/aurora-hml-auth-smoke-once.yml`.

Decisões: BLOCKED em falha, AWAITING_OPERATIONAL_EVIDENCE após regressões offline, ELIGIBLE_FOR_CONTROLLED_REVIEW apenas com evidências externas de OAuth, WIF, smoke, ingestão imutável e restore. A CLI não aceita autoatestado de gates; não produz RELEASE_APPROVED.

Sem instalação no Xeon: a integração local futura exige build assinado, manifest imutável e validação física. Processamento pesado permanece reservado ao Xeon quando disponível; esta rotina GitHub usa apenas regressões curtas.
