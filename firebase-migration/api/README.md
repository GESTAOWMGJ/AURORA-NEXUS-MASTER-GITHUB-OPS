# WMGJ Control Plane — FastAPI

Camada de domínio para consultas agregadas, execução de IA auditável e revisão humana. Ela **não substitui** a Cloud Function de ingestão durante a Fase 1 e não cria uma segunda fonte de verdade.

## Limites da Fase 1

- somente homologação;
- Cloud Function continua como writer canônico do espelho legado;
- dados `CLINICAL_SENSITIVE` bloqueados por padrão;
- execução OpenAI bloqueada por kill switch independente (`WMGJ_OPENAI_EXECUTION_ENABLED=false`);
- OpenAI usa Responses API, saída Pydantic estrita e `store=false`;
- toda saída de IA nasce com `reviewState=PENDING`;
- nenhuma aprovação de IA fecha competência, conta, glosa ou decisão clínica;
- autenticação por Firebase ID Token revogável + App Check + membership ativo em `organizations/{orgId}/members/{uid}`;
- MFA obrigatório por padrão para revisão humana.

## Execução local

```bash
cp .env.example .env
uv sync --dev
uv run fastapi dev
uv run pytest
```

O dashboard de homologação fica em `/dashboard?demo=1`. Os dados do modo demo são explicitamente sintéticos. Sem `demo=1`, a interface exige Firebase ID Token e App Check fornecidos pela futura camada de login e consulta apenas agregados autorizados.

## FastAPI Cloud

Preparação e inspeção são permitidas nesta branch; deploy não é automático:

```bash
uv run fastapi cloud deploy --help
uv run fastapi cloud ci print-workflow --branch feat/firestore-migration-foundation-20260826
```

Antes do primeiro deploy de homologação, configurar `OPENAI_API_KEY` e `WMGJ_FIREBASE_PROJECT_ID` como secrets/variáveis externas. Nunca incluir service-account JSON, PDFs, planilhas ou dumps do emulador no pacote.
