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
Não liberar enquanto faltar ensaio real de restore e promoção governada da identidade/keyring de ingestão.

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

- Baseline remota revalidada: `ee4d274bf27e36b293f2043fe2d4d818ea965c3d`.
- Origem do patch preservada: `0a5e13ba4ddf97e11f7ab2aff1f38b565c95a712`.
- Reexecução isolada: Functions 288/288, lint e build; API 39/39;
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

A autorização versionada `.github/requests/aurora-rc11-run.json` permanece
inalterada. O workflow corrigido recusa a versão 5: uma futura execução requer
request v6 separado, vinculado à baseline aprovada e nova revisão do ambiente.
O run `37073345505`, baseado no código anterior, não deve ser aprovado nem
reexecutado para validar este patch. Publicação de branch/PR draft aciona apenas
validações de código; não autoriza merge, deploy, dados reais ou mudança de segredo.

### Pendências para decisão

| Pendência | Status/evidência | Risco | Responsável sugerido | Próxima ação e aceite | Bloqueador real |
| --- | --- | --- | --- | --- | --- |
| Compatibilidade dos schemas | COMPROVADO localmente: testes de contratos e leitura v1/v2/v3 | regressão entre produtores e consumidores | backend | repetir CI completo no SHA final, incluindo Java 21 | CI do candidato ainda não comprovado |
| Contrato operational-status v2 | COMPROVADO na main; v1 preservado | cliente interpretar estado novo como legado | backend | preservar negociação explícita e regressões | aceite integrado pendente |
| Local do organic-patcher | COMPROVADO na main: `firebase-migration/schemas` | duplicação de contrato | plataforma | manter fonte canônica e ativação bloqueada | nenhum para localização; runtime permanece separado |
| Runtime boot patcher | PENDENTE: contrato não é executor web/PWA/desktop/mobile | patch indevido ou cruzamento de tenant | plataforma/segurança | manifesto server-side por orgId/clientSkill; auditoria, rollback e nenhum segredo no frontend | implementação e ensaio integrado não comprovados |
| Smoke sem produção | PARCIAL: testes offline; sem ensaio nativo do iMac nesta etapa | despacho confundido com instalação | QA/plataforma | revalidar PR #95 na main atual, retorno sanitizado do dispositivo e rollback nativo | ausência de canal com resultado verificável do iMac |

Billing/orçamento, Secret Manager/API, presença de `AURORA_NEXUS_ALLOWED_EMAILS`
(sem ler valor), identidade/WIF, usuários/memberships/MFA, App Check, Rules,
backup/restore, ambiente protegido, DNS/HTTPS/SSL e autenticação real exigem
evidências atuais antes de liberação. Dados anteriores são históricos; sem acesso
atual, o estado é DESCONHECIDO, não falha comprovada. Nenhum gate é promovido por
esta nota. AURORA NEXUS permanece sistema-mãe; WMGJ Operação, tenant-piloto.

Rollback desta candidata: descartar/reverter o patch na branch antes de qualquer
implantação; não há estado remoto ou instalação modificados nesta etapa.
