# Estado verificável da homologação Firebase — 27/09/2026

Este registro separa **recurso criado**, **código validado** e **serviço implantado**. A existência do projeto não é evidência de deploy.

## Fronteira de segurança

- Projeto isolado: `wmgj-hml-jfn-20260927` (`WMGJ Firebase Homologacao`).
- Projeto operacional anterior `wmgj-ops`: não alterado por esta fase.
- Plano atual do projeto HML: Spark, sem billing vinculado.
- Dados reais, PHI e dados clínicos identificáveis: ausentes e proibidos nesta fase.
- Fonte operacional atual: permanece soberana; não existe dual-write nem cutover.

## Estado remoto observado

| Recurso | Estado em 27/09/2026 | Gate seguinte |
|---|---|---|
| Projeto Firebase | Criado e isolado | Vincular billing somente com aprovação explícita e orçamento |
| Firestore `(default)` | Standard, Native, `southamerica-east1`, regras iniciais deny-all | Habilitar delete protection e validar Rules versionadas |
| Authentication | Inicializado; provedor Email/Password habilitado | Cadastrar usuários individuais, MFA e memberships |
| Aplicativo Web/Hosting | App `Aurora Nexus HML Web` registrado; nenhuma implantação | Deploy apenas pelo ambiente GitHub protegido |
| Functions e motor | Não implantados | WIF, service account, secrets e preflight completos |
| Backup/restore | Não configurado | Backup `READY` e restore real em banco separado, com evidência recente |
| DNS/SSL | Não configurados | Definir domínio, registros e aprovação de mudança |
| Migração operacional | Não iniciada | Amostra sintética, reconciliação e `DRY_RUN=true` |

## Código preparado no PR draft

- Shell privado controlado por Firebase Auth, allowlist e membership ativa.
- RBAC no front-end e autorização repetida no back-end; o cliente não grava diretamente.
- CSRF HMAC ligado à sessão e à rota, idempotência e revisão esperada.
- MFA TOTP para ações de risco alto/crítico quando Identity Platform estiver habilitado.
- Evidências de resolução verificadas transacionalmente por organização e vínculo prévio.
- Motor em `SHADOW`, desabilitado por padrão, com valores monetários em centavos.
- Registros `TEST`/`TESTE` excluídos de todos os indicadores.
- Snapshot persistido no contrato fechado `dashboard-snapshot.schema.json` v2.
- Auditoria server-only e Security Rules que negam escrita direta do cliente.
- Ingestão rejeitada quando a organização sai de `HOMOLOGATION`/`SHADOW`, perde qualquer bloqueio de mutação ou habilita conteúdo clínico.
- Conteúdo clínico/identificável, texto livre e identificadores pessoais são rejeitados no endpoint genérico mesmo quando rotulados como `INTERNAL` ou `RESTRICTED`.
- `beforeHash` e `afterHash` representam o documento lógico efetivamente preservado por uma atualização com merge.

## Gate de deploy modelado

O workflow manual exige o SHA exato da ponta de `main`, confirmação literal, ambiente `firebase-homologation` protegido, OIDC/WIF sem chave JSON e projeto idêntico à variável aprovada. Antes de implantar, ele valida:

1. build, contratos, evals e Security Rules;
2. secrets `latest` habilitados e semanticamente válidos;
3. Firestore em São Paulo com delete protection;
4. organização ativa, `projectionEnabled=false`, `projectionMode=SHADOW` e mutações produtivas bloqueadas;
5. usuário sintético permitido e membership de escopo organizacional;
6. backup `READY`, restore concluído em banco separado e marcador imutável com geração e frescor de até 24 horas.

Depois do deploy, o workflow confere exatamente as Functions esperadas, shell privado, `401` anônimo em `/api/bootstrap`, carregamento do secret de ingestão e bootstrap autenticado. Falha de smoke mantém o gate vermelho e nunca promove o ambiente para produção.

## Evidência de validação local

- Functions/motor: 81 testes.
- API/contratos: 29 testes.
- Evals offline: 3 casos.
- Dashboard estático: 3 testes.
- Firestore Rules no Emulator Suite: 18 testes.
- TypeScript, JSON, YAML e scripts shell: validação sintática aprovada.
- `npm audit --omit=dev --audit-level=high`: sem vulnerabilidade alta ou crítica; duas ocorrências moderadas transitivas permanecem registradas.

O bootstrap integral requer Java 21. O executor local disponível nesta verificação usa Java 17; por isso as suítes foram executadas separadamente com `firebase-tools@14.17.0`, e o CI fornece Java 21 para repetir o bootstrap canônico.

## Autorizações ainda necessárias

Nenhum dos itens abaixo deve ser inferido a partir deste documento:

- billing/Blaze e orçamento;
- criação de WIF e service account de deploy;
- criação de secrets e seus valores;
- cadastro de usuários, papéis e memberships;
- Identity Platform/MFA;
- backup/restore, DNS ou SSL;
- execução do deploy, ingestão de dados reais ou ativação do motor.

Esses atos exigem aprovação explícita e evidência própria. O PR permanece draft até os gates aplicáveis estarem verdes.
