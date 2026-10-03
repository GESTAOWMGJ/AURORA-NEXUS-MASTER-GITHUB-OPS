# AURORA NEXUS — progresso até a versão vendável

## Release train

- Produto: **1.0.0-rc.1**
- Política operacional: **2.3.0**
- Motor orgânico: **1.2.0**
- Native Intelligence: **0.1.0**
- Piloto de referência: **WMGJ Operação**
- Baseline de código: `main` pós-PR #39

## O que já é produto

- login-first, sessão e membership;
- Firestore protegido e tenant WMGJ;
- módulos M01–M10 e M03.1;
- dashboard SHADOW;
- ações de auditoria com evidência;
- AURORA-ORG-001 AUDIT/FINANCE;
- deploy HML protegido e smoke autenticado;
- retomada/idempotência do fluxo orgânico;
- Native Intelligence v0 sem provedor externo, neste RC.

## Bloqueios objetivos

### Ingestão real

Restore real e cleanup foram comprovados no run `37092175109`. Não liberar
enquanto o formato do keyring permanecer incompatível e faltarem amostra real,
reconciliação e projeção governada.

### Desktop
Não tratar launcher HML como sucessor do aplicativo funcional. Inspecionar a baseline instalada e validar atualização in-place/rollback.

### Collective Intelligence
Privacy Gate → Knowledge Capsule → Knowledge Registry → Pattern Matcher permanece o próximo grande módulo de produto; não deve receber dados brutos de outro tenant.

## Definição de avanço por prompt

Toda solicitação relevante deve:
1. gerar ou atualizar patch;
2. adicionar teste;
3. alterar um gate ou explicar por que não altera;
4. manter rollback;
5. reportar SHA/CI/deploy separadamente;
6. escolher o próximo bloqueio de maior impacto.

## Próximos incrementos recomendados

1. fechar recovery gate e liberar amostra operacional real WMGJ;
2. implementar M12 Collective Intelligence em modo PRIVATE/COLLABORATIVE;
3. consolidar a IA nativa com Knowledge Registry e Pattern Matcher;
4. validar atualização do app Mac instalado;
5. hardening comercial, domínio, distribuição e documentação;
6. promover RC aprovada para `1.0.0` GA.

## Saneamento técnico — 02/10/2026 (America/Sao_Paulo)

Estado: `TESTED_LOCAL`, candidato em revisão; **NO-GO para escrita real e
liberação comercial**. Este registro não altera os gates históricos acima.

- Baseline remota reconciliada: `f8699caa254ed058fea67beff2d275f51602b394`.
- Origem do patch preservada: `0a5e13ba4ddf97e11f7ab2aff1f38b565c95a712`.
- Reexecução isolada histórica no patch `0a5e13b`: Functions 288/288, lint e
  build; API 39/39;
  três evals contratuais offline; dashboard estático 3/3; coletor 68/68;
  Rules estáticas 1/1; auditoria de fronteiras Apps Script e sintaxe shell.
- Emulador Firestore pendente no ambiente local (Java 17; requerido Java 21).
  O workflow `Validate Firestore Migration` fornece Java 21. CI remoto precisa
  ser comprovado no SHA final; resultado anterior não libera este candidato.
- Instaladores: build local não executado por ausência de Go. Build em CI não
  comprova instalação, abertura, retorno remoto ou rollback no Mac real.

O patch endurece competência mensal, recebimentos `RECEIPT` vinculados à fatura,
ausência versus zero, contratos versionados, evidência selecionável, auditoria,
isolamento clínico, idempotência, quarentena do backfill e descoberta do endpoint
Gen2. Não existe novo executor multiplataforma do boot patcher nesta entrega.

### Limites de execução

A request v6 presente em `.github/requests/aurora-rc11-run.json` permanece
inalterada em relação à main reconciliada. O workflow candidato recusa essa
versão histórica: uma futura execução requer request v7 separado, vinculado à
baseline aprovada e nova revisão do ambiente. O run `37092175109` falhou no gate
HMAC após restore/cleanup e publicação de Hosting/Rules/indexes; não realizou
amostra real, reconciliação, SHADOW ou migração do secret. Não o reexecutar para
validar este patch. Publicação de branch/PR draft aciona apenas validações de
código; não autoriza merge, deploy, dados reais ou mudança de segredo.

### Pendências para decisão

| Pendência | Status/evidência | Risco | Responsável sugerido | Próxima ação e aceite | Bloqueador real |
| --- | --- | --- | --- | --- | --- |
| Compatibilidade dos schemas | COMPROVADO localmente: testes de contratos e leitura v1/v2/v3 | regressão entre produtores e consumidores | backend | repetir CI completo no SHA final, incluindo Java 21 | CI do candidato ainda não comprovado |
| Contrato operational-status v2 | COMPROVADO na main; v1 preservado | cliente interpretar estado novo como legado | backend | preservar negociação explícita e regressões | aceite integrado pendente |
| Local do organic-patcher | COMPROVADO na main: `firebase-migration/schemas` | duplicação de contrato | plataforma | manter fonte canônica e ativação bloqueada | nenhum para localização; runtime permanece separado |
| Runtime boot patcher | PENDENTE: contrato não é executor web/PWA/desktop/mobile | patch indevido ou cruzamento de tenant | plataforma/segurança | manifesto server-side por orgId/clientSkill; auditoria, rollback e nenhum segredo no frontend | implementação e ensaio integrado não comprovados |
| Smoke sem produção | PARCIAL: testes offline; sem ensaio nativo do iMac nesta etapa | despacho confundido com instalação | QA/plataforma | revalidar PR #95 na main atual, retorno sanitizado do dispositivo e rollback nativo | ausência de canal com resultado verificável do iMac |
| Keyring HMAC/ponte | BLOQUEADO: formato não reconhecido no run `37092175109`; exit 77; nenhuma versão criada | migração incorreta ou indisponibilidade da ingestão | cloud/IAM e backend | diagnosticar o formato sem expor conteúdo, preparar correção protegida e somente então emitir request v7 | keyring incompatível e ausência de nova aprovação |

Billing/orçamento, Secret Manager/API, presença de `AURORA_NEXUS_ALLOWED_EMAILS`
(sem ler valor), identidade/WIF, usuários/memberships/MFA, App Check, Rules,
backup/restore, ambiente protegido, DNS/HTTPS/SSL e autenticação real exigem
evidências atuais antes de liberação. Dados anteriores são históricos; sem acesso
atual, o estado é DESCONHECIDO, não falha comprovada. Nenhum gate é promovido por
esta nota. AURORA NEXUS permanece sistema-mãe; WMGJ Operação, tenant-piloto.

Rollback desta candidata: descartar/reverter o patch na branch antes de qualquer
implantação; não há estado remoto ou instalação modificados nesta etapa.

### Regressão encontrada pelo emulador no PR #98

O run `37078422306` executou Java 21 e identificou uma falha de disponibilidade
na autorização de `clinicalEvidence`: repetição dos helpers de membership e
escopo ultrapassou o limite de 1.000 expressões do Firestore Rules. Não houve
escrita em HML/produção. Instaladores, criptografia e integração orgânica passaram
no primeiro SHA remoto `6cf04cbd637dcfc3983c233a6a28e507d8a3de7b`.

Correção candidata: reutilizar o profile em variáveis locais e validar o escopo
sem reentrar repetidamente nos mesmos helpers. Mantidos organização ativa,
membership ativo, papel/permissão, gate clínico e unidade. Testes individualizam
papel clínico e permissão explícita e cobrem membership ausente/inativo, escopo
vazio/malformado e permissão malformada. Aceite: suíte inteira no emulador, sem
remover negativos; até nova evidência o gate permanece pendente.

Referência técnica: https://firebase.google.com/docs/firestore/security/rules-structure

### Incremento independente do Mac — 02/10/2026, America/Sao_Paulo

O SHA anterior do PR #98 `8b8e4fd1065f69d7a9c318911902d82a95f77a69`
concluiu cinco workflows: Functions 289, Rules 28, API 39, dashboard 3 e nenhum
alerta CodeQL novo no código alterado. Essa evidência substitui as pendências de
CI acima apenas para aquele SHA; nova candidata deve concluir seus próprios runs.

- Preflight `hml-readonly-preflight.v1` implementado com oito consultas de
  metadados, alvo HML fixo e relatório sanitizado de 20 gates. Plano padrão sem
  cloud; acesso insuficiente é DESCONHECIDO. Não lê valores de secrets.
- Gate de backup compartilhado endurecido antes de deploy/restore: READY,
  snapshot de até 24h não futuro, não expirado e mesmo databaseUid. Removida a
  exceção de deploy sem backup. Dados de backup não comprovam restore.
- 22 testes offline deste incremento aprovados localmente; suíte incluída no CI.
  Gates atuais cloud continuam desconhecidos até coleta autenticada e revisão.
- PR #43 confirmado fechado/absorvido pelo #66. Decisões de contratos preservadas;
  fila e especificação do runtime boot estão no documento 39, sem alegar executor.

Runbooks: `firebase-migration/docs/38-hml-readonly-preflight.md` e
`firebase-migration/docs/39-boot-patcher-runtime-plan.md`. Nenhum deploy, merge
na main, restore, alteração de segredo ou ativação de conector nesta entrega.

Prioridades: (1) comprovar metadados/gates HML por canal autorizado, cloud/IAM;
(2) revisar o gate de recuperação e ensaiar restore somente após autorização,
operações; (3) implementar observação autenticada do boot patcher, plataforma.
CI atual, estado real e aceite comercial continuam separados. Reverter o commit
candidato desfaz este incremento de código; não houve mutação cloud a reverter.

### Observação server-side do boot — 02/10/2026, America/Sao_Paulo

Produto 1.0.0-rc.1; módulo AURORA-ORG-001/API; candidata do PR #98 reconciliada
sobre a main `f8699caa254ed058fea67beff2d275f51602b394`. O incremento original no SHA
`f25efddd29f8822795bb05f95f3fce7e2481b84e` concluiu cinco workflows com sucesso
(incluindo 22 testes de preflight); o merge-forward exige CI novo no SHA final.

- IMPLEMENTED: núcleo read-only na API existente, usando o schema canônico,
  contexto server-side, evidência independente, limites de validade/tamanho,
  revalidação final e projeção pública minimizada. Nenhuma ativação ou mutação.
- TESTED_LOCAL: testes sintéticos de isolamento, versões, revogação, MFA de
  revisão, alterações concorrentes, integridade, privacidade e limites.
  A execução e contagens finais ficam na evidência do PR vinculada ao SHA.
- PENDENTE: adaptador Auth/App Check/checkpoint real, revisão consistente,
  auditoria persistida, empacotamento da fonte canônica e smoke integrado.
  Não houve execução em web/PWA/Mac/mobile nem promoção a HML_VERIFIED.

Release Cockpit: gates operacionais mantidos; módulo/teste não comprova runtime,
instalação, patch aplicado, ingestão, release comercial ou resultado financeiro.
Rollback: reverter este incremento na candidata, sem estado cloud a desfazer.
Detalhes e fila obrigatória no documento 39. Prioridades: (1) adaptar identidade,
checkpoint e auditoria existentes; (2) comprovar os gates HML por canal de leitura
autorizado; (3) executar smoke integrado somente com seus pré-requisitos atendidos.
