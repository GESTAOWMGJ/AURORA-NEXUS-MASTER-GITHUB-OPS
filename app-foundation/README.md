# WMGJ App Foundation

> Clinical-readiness only: clinical use, patient communication, production
> deployment and real-data migration are disabled.

MVP operacional para migrar gradualmente a base-mestra WMGJ para Cloud Firestore sem interromper o pipeline V3 atual.

## Entrega atual

- dashboard React/TypeScript responsivo, com dados demonstrativos sanitizados;
- contrato de ações validado no backend;
- Cloud Functions para comandos idempotentes e projeção de fontes;
- classificação opcional com OpenAI Structured Outputs, limitada a metadados não sensíveis;
- Firestore e Storage com negação por padrão e escrita de domínio somente pelo backend;
- trilha de auditoria encadeada por hash;
- regras, índices, emuladores, seed e testes automatizados;
- plano de migração incremental, mantendo Sheets/Apps Script como sistema vigente até o aceite de cada fase.
- ponte Firebase em `shadow mode`, opt-in e fail-isolated, para SLA, governança e aprendizado supervisionado sem alterar a fonte oficial.

Este MVP é estritamente operacional e não clínico. Dados identificáveis, prontuários, diagnósticos, OCR bruto e qualquer PHI ficam fora desta entrega.

## Fluxo

```mermaid
flowchart LR
  A["Sheets + Apps Script V3"] --> B["Adaptador sanitizado"]
  B --> C["Cloud Functions"]
  C --> D["Firestore"]
  D --> E["Validação humana"]
  E --> F["Dashboard e relatórios"]
```

O frontend pode ler projeções autorizadas. Toda mutação relevante passa pelas funções, com Auth, App Check, MFA quando exigido, autorização por tenant, idempotência e auditoria.

## Implantação paralela WMGJ

O arquivo `src/15_FIREBASE_SHADOW_WMGJ.gs` coleta somente contagens e indicadores agregados do pipeline V3. A ponte permanece desligada até que `WMGJ_FIREBASE_SHADOW_ENABLED` seja configurada como `true`. Mesmo ativa, uma falha de rede, contrato ou Firebase é registrada como `SHADOW_ERRO_ISOLADO` e não altera o retorno nem os dados do fluxo vigente.

No Firebase, `ingestShadowSnapshot` valida contrato estrito, assinatura HMAC e janela antirreplay, grava o snapshot idempotente e calcula o SLA. Desvios criam uma `learning_observation` com `autoApplyAllowed=false`; nenhuma regra, prompt ou modelo é atualizado sem revisão e nova versão aprovada.

Consulte [Rollout shadow](docs/migration/shadow-rollout.md) e [Aprendizado contínuo supervisionado](docs/governance/continuous-learning.md).

## Executar localmente

Requisitos: Node.js 22+, npm e Java 21 para o Emulator Suite.

```bash
cd app-foundation
npm ci
cp .env.example .env.local
npm run build
npm test
```

Para testar as regras no emulador:

```bash
npm run test:rules
```

Para subir a interface:

```bash
npm run dev
```

A interface desta entrega permanece deliberadamente demonstrativa. As variáveis Firebase apenas preparam os adaptadores cliente; a troca para dados autenticados pertence à F3. O projeto de produção não é criado nem implantado por este repositório.

## Antes de criar o Firestore de produção

1. confirmar a região `southamerica-east1`;
2. decidir se CMEK é requisito contratual;
3. configurar Secret Manager, IAM mínimo, Auth, App Check e MFA;
4. validar regras e isolamento entre tenants em homologação;
5. definir retenção, backup/PITR, logs de auditoria e procedimento LGPD;
6. cadastrar `OPENAI_API_KEY` somente no Secret Manager, caso a classificação seja habilitada.

## Estrutura principal

```text
app-foundation/
  api/                 contrato FastAPI sintético e somente leitura
  functions/src/       backend e contratos
  src/                 dashboard e adaptadores cliente
  tests/               contratos e Security Rules
  scripts/migration/   dry-run sintético sem I/O externo
  docs/                arquitetura e migração
  firestore.rules      autorização de leitura
  storage.rules        objetos privados
  firebase.json        emuladores e deploy
```

Consulte [Arquitetura Firestore](docs/FIRESTORE_ARCHITECTURE.md) e [Plano de migração](docs/MIGRATION_PLAN.md).
