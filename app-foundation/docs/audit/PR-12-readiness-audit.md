# PR 12 readiness audit

## Baseline — 2026-08-26 UTC

- PR 12: open, draft, head `4b5d03b04099394e9b3ed2d95a3d0d94eec32070`.
- Functions TypeScript build: exit 0.
- React/TypeScript production build: exit 0.
- Existing unit/contract tests: 9/9 passed, exit 0.
- GitHub workflow `Validate Firestore MVP` run 32989238224: success.
- Legacy `Docker Image CI` and `iOS starter workflow`: pre-existing failures,
  outside this change and not treated as passed.
- Local Rules run: blocked by the executor's external binary/network policy; the
  prior GitHub emulator run is the current external evidence.

## Change scope

- synthetic, read-only FastAPI contract surface;
- operational readiness visualization with mobile fallback;
- deterministic contract tests;
- clinical boundary and approvals documents;
- PR-only CI and disabled manual deployment template.

## Gate state

| Gate | State | Rationale |
|---|---|---|
| G0 | CONCLUÍDO E VERIFICADO | Baseline and prior CI evidence captured |
| G1 | PREPARADO, NÃO EXECUTADO | Controls represented; new CI pending |
| G2 | PREPARADO, NÃO EXECUTADO | Clinical use absent and blocked |
| G3 | PENDENTE DE APROVAÇÃO | Independent reviews and new CI required |
| G4 | PENDENTE DE APROVAÇÃO | Synthetic migration rehearsal not yet complete |

No deploy, migration, production credential, Gmail, Drive, Sheets or real
Firestore access occurred.

## Incremento shadow — 2026-09-12 UTC

- Apps Script V3 preservado como sistema oficial.
- Ponte Firebase agregada adicionada atrás de feature flag desligada por padrão.
- Ingestão protegida por contrato estrito, HMAC, janela temporal e idempotência.
- Avaliação de SLA versionada gera somente observação pendente de revisão humana.
- Workflow de homologação preparado com `dry_run=true`, SHA imutável, ambiente protegido, allowlist de projeto e autenticação federada.
- Nenhum projeto Firebase, segredo, recurso, gatilho Apps Script ou dado real foi criado ou alterado nesta execução.

### Evidência local do incremento

- Functions TypeScript: compilação aprovada.
- Frontend React/TypeScript: build aprovado.
- Testes unitários e contratuais: 17/17 aprovados.
- Auditoria estática e sintática do Apps Script: aprovada, sem erros; diretórios legados permanecem apenas como aviso preexistente.
- YAML dos workflows: sintaxe aprovada.
- `git diff --check`: aprovado.
- Firestore Rules local: não executado porque o executor oferece Java 17 e a versão atual do Emulator Suite exige Java 21; o workflow do PR instala Java 21 e permanece como evidência obrigatória antes de aprovação.

## Post-change local evidence

- FastAPI tests: 5/5 passed; OpenAPI exposes only `GET /health` and
  `GET /v1/readiness`.
- React readiness model and existing contracts: 12/12 passed.
- Functions and production dashboard builds: exit 0.
- Synthetic migration dry-run: 1 tenant, 1 site, 2 records; zero duplicates,
  zero orphans, `externalReads=0`, `externalWrites=0`.
- Workflow YAML syntax: parsed successfully.
- FastAPI Cloud authentication/link check: `not_logged_in`; no app, token,
  secret or deployment created.
- Browser-based local visual QA: BLOQUEADO by the remote browser policy
  (`ERR_BLOCKED_BY_CLIENT`); no visual-pass claim is made. Responsive behavior
  remains covered by explicit CSS breakpoints and production build evidence.
