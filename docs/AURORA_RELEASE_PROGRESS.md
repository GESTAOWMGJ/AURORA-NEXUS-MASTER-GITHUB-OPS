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

## RC1.1 — validação do payload completo após PR #110

- Baseline `403e20317e073de6da88d569dc18e66f99447cae`: a main removeu os campos fora de contrato da amostra pelo PR #110. Preservar esse produtor; este incremento adiciona somente teste e evidência, sem mudar request ou contrato.
- Teste executa ambos os builders Apps Script com fontes sintéticas e submete os eventos completos ao validador real do backend. Campos antigos e conteúdo clínico permanecem rejeitados. Não inferir aceitação runtime a partir do teste.
- Deploy Apps Script `37134188577` aprovado nesse SHA. Tentativa 5 de `37093409122`, job `111235471017`, ainda em restore na última consulta; amostra/reconciliação não comprovadas.
- CMEK: saída titular no SHA `6295e9b61c7510905eebfc25cbfcf3c5524ae98e` confirma AURORA_CMEK_HML_APPLIED e backup diário 14d; consulta posterior retornou nenhum backup de aurora-hml-cmek. Estado PENDING_HML_VERIFICATION mantido até backup READY, restore e recuperação da chave.
- Rollback: reverter somente este incremento de teste/documentação. Sem merge/deploy/rerun automático.
