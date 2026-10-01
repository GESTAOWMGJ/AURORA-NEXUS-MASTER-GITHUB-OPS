# TRIGGERcmd macOS + Estado Final WMGJ/Firestore

**Data:** 28/08/2026  
**Escopo:** instalação local do agente TRIGGERcmd, comandos remotos não destrutivos e estado final auditável da homologação Firestore.

## Estado comprovado

O conector TRIGGERcmd retornou `No computers found for this user`. Portanto, nenhum comando pôde ser executado no Mac por esta sessão. Não declarar o agente como instalado ou conectado até existir computador visível na conta vinculada.

O pacote local foi criado como instalador autoextraível para Apple Silicon e Intel, com:

- download do DMG oficial conforme `uname -m`;
- validação de assinatura do aplicativo;
- confiança progressiva por SHA-256: o primeiro DMG validado estabelece o hash local e mudanças futuras falham fechadas;
- preservação e backup do `~/.TRIGGERcmdData/commands.json`;
- quatro comandos `foreground`, compatíveis com macOS;
- token inserido somente na interface do próprio agente;
- LaunchAgent para abrir o agente e reaplicar o merge controlado dos comandos;
- Markdown e JSON dinâmicos em `~/WMGJ_OPERACAO/state`;
- instalação opcional de Node 22, Java 21, Firebase CLI, Google Cloud CLI, CLASP, jq e uv;
- build, testes e Emulator Suite sem deploy;
- plano remoto somente leitura para a homologação;
- modo `--apply` bloqueado para TRIGGERcmd e permitido apenas em terminal local com TTY, arquivo de aprovação e confirmação literal do Project ID;
- segredo HMAC no Chaves do macOS e no Secret Manager, nunca em Git, planilha, Markdown ou log;
- bootstrap idempotente de `organizations/wmgj` por Admin SDK e Application Default Credentials;
- preservação de `WMGJ_FIRESTORE_DRY_RUN=true` até diagnóstico e dry run de dez registros.

## Comandos TRIGGERcmd controlados

```text
WMGJ Estado Final
WMGJ Validar Firestore Local
WMGJ Plano Homologacao Firebase
WMGJ Abrir Estado Final
```

Todos usam `ground=foreground` e `allowParams=false`. Nenhum deles cria projeto, vincula billing, grava segredo, faz deploy, altera Script Properties ou executa migração com escrita.

Cada execução remota controlada passa pelo wrapper `wmgj-triggercmd-entry.sh`, que grava um marcador sanitizado com ação, horário, resultado e `productionMutation=NONE`. O estado final aceita esse marcador como evidência real de execução remota.

## Estados fail-closed

```text
BLOCKED_TRIGGERCMD_TOKEN_OR_CONNECTION
BLOCKED_LOCAL_DEPENDENCIES
READY_FOR_FIREBASE_HOMOLOG_PROVISIONING
BLOCKED_HMAC_SECRET
BLOCKED_ORGANIZATION_BOOTSTRAP
READY_FOR_APPS_SCRIPT_CONFIGURATION
READY_FOR_APPS_SCRIPT_DIAGNOSTIC
READY_FOR_DRY_RUN_10
HOMOLOGATION_DRY_RUN_COMPLETE
```

## Ordem obrigatória após conexão do Mac

1. instalar o pacote e inserir o token pela janela do agente;
2. confirmar o computador no TRIGGERcmd;
3. executar `WMGJ Estado Final`;
4. instalar e validar dependências;
5. preencher apenas valores não secretos em `~/WMGJ_OPERACAO/config/wmgj.env`;
6. executar o plano de homologação;
7. realizar o `--apply` exclusivamente no terminal local após aprovação humana;
8. configurar o Apps Script com `WMGJ_FIRESTORE_DRY_RUN=true`;
9. executar, nesta ordem:

```javascript
wmgjFirestoreDiagnostico();
wmgjFirestoreMigracaoDryRun(10);
```

## Estado anterior preservado

- PR nº 13 permanece draft;
- Functions, bridge e políticas já passaram no CI;
- Security Rules foram testadas no Firestore Emulator;
- nenhuma escrita foi feita em produção;
- projeto Firebase real, segredo HMAC, organização `wmgj`, Script Properties, diagnóstico e dry run real continuam não comprovados até execução no ambiente autenticado.

## Regra-mãe

> Nada fecha sem evidência. Nada distribui sem validação. Nada automatiza decisão crítica sem humano.
