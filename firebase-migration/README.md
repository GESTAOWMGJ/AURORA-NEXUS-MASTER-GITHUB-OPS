# WMGJ → Cloud Firestore — Kit de Migração Segura

**Data da fundação:** 26/08/2026  
**Escopo:** WMGJ Operação, gestão hospitalar replicável e auditoria runtime  
**Estado:** projeto Firebase isolado de homologação inicializado e código-base preparado; **nenhum deploy, dado real ou escrita em Firestore de produção foi executado**. Estado verificável: `docs/17-estado-homologacao-2026-09-27.md`.

## Decisão arquitetural

A planilha-mestre, o Gmail, o Drive e o Apps Script permanecem como sistema-fonte durante a transição. O Cloud Firestore entra primeiro como camada canônica paralela, com ingestão idempotente, trilha imutável, runtime auditável e isolamento por organização.

```text
Gmail / Drive / Sheets
        ↓
Apps Script atual (adaptador temporário)
        ↓ HTTPS + HMAC v2/keyId + nonce + idempotency key
Cloud Function v2 / API de ingestão
        ↓
Cloud Firestore
  ├─ projeções operacionais atuais
  ├─ eventos imutáveis de auditoria
  ├─ runtime / fila / watchdog
  ├─ financeiro e conciliação
  └─ módulos hospitalares replicáveis

Usuário autenticado
        ↓ Firebase ID Token + App Check
FastAPI Control Plane (homologação)
  ├─ snapshots sanitizados
  ├─ OpenAI Responses API tipada
  ├─ revisão humana com revision lock
  └─ auditoria servidor-only
```

## Regras inegociáveis

1. Nada fecha sem evidência.
2. Nada migra apagando ou sobrescrevendo a fonte.
3. Toda escrita possui `orgId`, `schemaVersion`, `idempotencyKey`, origem e versão.
4. IA classifica, extrai e recomenda; decisão crítica exige revisão humana.
5. Dados clínicos identificáveis não entram no primeiro backfill.
6. O modo inicial do Apps Script é `DRY_RUN=true`.
7. Deploy de código e execução operacional são pipelines separados.

## Conteúdo

- `docs/`: inventário, arquitetura, mapeamento, plano de migração, auditoria runtime, segurança e dicionário.
- `firestore/`: regras e índices.
- `functions/`: API TypeScript de ingestão assinada e watchdog.
- `api/`: BFF FastAPI para dashboard, IA auditável e revisão humana.
- `apps-script/`: ponte segura e migrador incremental por checkpoint.
- `migration/`: mapa das abas e critérios de reconciliação.
- `schemas/`: contratos JSON canônicos.
- `tests/`: testes mínimos das Security Rules.
- `api/evals/`: casos sintéticos de regressão; live eval é opt-in.
- `skills/`: habilidade operacional aprendida para continuidade.
- `policy/`: política sanitizada e versionada do aplicativo.

## Aplicação Full Firebase

O pacote inclui um shell operacional privado no Firebase Hosting, APIs autenticadas em Cloud Functions e um motor de projeções sanitizadas. O agendamento roda a cada 15 minutos, mas o motor nasce desabilitado e só publica quando a organização define `projectionEnabled=true`, `projectionMode=SHADOW` e uma competência `YYYY-MM`. Ele cobre o mapa M01–M10, lê a réplica canônica, calcula indicadores e grava snapshot+auditoria atomicamente sem escrever na fonte atual.

O back-end exige simultaneamente allowlist de e-mail, sessão Firebase revogável e membership ativa em `organizations/wmgj/members/{uid}`. Mutações humanas usam CSRF HMAC vinculado à sessão/rota, RBAC, idempotência e controle de revisão. Ações irreversíveis, dados clínicos sensíveis e mutação da fonte continuam bloqueados.

Arquitetura, gates, implantação e rollback: `docs/16-full-firebase-shadow-mode.md`.

## Validação controlada

```bash
bash scripts/bootstrap-homologacao.sh
```

O script exige Node 22 e Java 21+, usa lockfiles, compila as Functions e executa as Security Rules no Emulator Suite. Ele não faz login, configura segredo nem executa deploy. O workflow repete apenas essas validações.

## Provisionamento controlado de homologação

Depois do merge, do CI verde e da instalação local WMGJ no Mac autorizado, use somente em terminal local interativo:

```bash
chmod 700 scripts/PROVISIONAR_FIREBASE_HOMOLOGACAO.command
bash scripts/PROVISIONAR_FIREBASE_HOMOLOGACAO.command
```

O launcher:

- aceita somente Project ID com prefixo `wmgj-hml-jfn-`;
- bloqueia indicadores de produção;
- exige autenticação Firebase, gcloud e ADC;
- exige seleção local da conta de faturamento e duas confirmações literais;
- cria orçamento de alerta com limiares de 50%, 80% e 100%;
- cria Firestore Native com delete protection;
- configura Secret Manager, Rules, índices, Functions e `organizations/wmgj`;
- solicita TTL para `requestNonces.expiresAt`;
- mantém dados clínicos desabilitados e Apps Script em `DRY_RUN=true`;
- falha se não comprovar infraestrutura, organização, health check e controles de custo.

Detalhes: `docs/15-provisionamento-controlado-homologacao.md`.

A camada FastAPI é implantada separadamente e somente em homologação. Não existe auto-deploy:

```bash
cd api
uv sync --dev
uv run pytest
uv run fastapi cloud deploy --help
```

`OPENAI_API_KEY` permanece exclusivamente como secret do backend. `CLINICAL_SENSITIVE` fica bloqueado até validação contratual, retenção, IAM, LGPD e aprovação clínica formal.

No Apps Script, configure somente em **Script Properties**:

```text
WMGJ_FIRESTORE_INGEST_URL=https://<regiao>-<projeto>.cloudfunctions.net/ingestWmgjEvent
WMGJ_FIRESTORE_HMAC_KEY_ID=apps-script-homolog-2026-08
WMGJ_FIRESTORE_HMAC_SECRET=<segredo longo e exclusivo>
WMGJ_FIRESTORE_ORG_ID=wmgj
WMGJ_FIRESTORE_DRY_RUN=true
WMGJ_FIRESTORE_MAX_ROWS=10
```

Depois execute:

```javascript
wmgjFirestoreDiagnostico();
wmgjFirestoreMigracaoDryRun(10);
```

A virada para `WMGJ_FIRESTORE_DRY_RUN=false` só deve ocorrer no ambiente de homologação, depois dos testes das regras, da criação da organização `wmgj` e da validação dos totais.

O backend recebe `WMGJ_INGEST_HMAC_KEYRING` como secret JSON rotacionável. Cada entrada contém `active`, `secret`, `orgIds` e `entityTypes`; o `keyId` do Apps Script deve apontar para uma entrada ativa e escopada. A política TTL do Firestore deve ser habilitada para `requestNonces.expiresAt`.

O primeiro backfill de Sheets usa `sourceVersion=1` como fotografia congelada. Qualquer alteração posterior da mesma entidade falha fechada; dual-write só pode começar depois que a fonte tiver uma coluna ou versionador monotônico durável por registro.

## Critério de cutover

O Firestore só passa a ser fonte de leitura principal após dois fechamentos completos em paralelo, sem divergência material em contagens, valores, competência, vínculos de evidência, notas substituídas, conciliações e pendências críticas.
