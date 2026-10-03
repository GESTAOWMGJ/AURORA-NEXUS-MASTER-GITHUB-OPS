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

## RC1.1 — correção do contrato da amostra 03/10/2026

- Baseline main: `5dcaddc88b27b54a7f24f9042b05e9799205fb1a`. Run `37093409122`, tentativa 4, job `111230961385`: restore/limpeza e probe HMAC aprovados; envio da amostra rejeitado com HTTP 400 por campo fora do contrato não clínico. Reconciliação e inteligência não executadas.
- Produtor emitia invoiceNumber, transactionKind e metadata.rc11Sample, ausentes no contrato positivo do backend. Substituições: invoiceNumberHash (SHA-256), kind e pipelineVersion. Não ampliar allowlist, não liberar conteúdo clínico nem alterar o request HML.
- Teste executa ambos os builders com fontes sintéticas e valida os payloads completos no validador real; extensões antigas e conteúdo clínico continuam rejeitados.
- Gate operacional permanece pendente de deploy canônico aprovado e nova prova HML. Possível escrita parcial anterior exige leitura de auditoria/idempotência, não afirmação de lote vazio. Rollback: reverter somente este patch em revisão; fontes não alteradas.
