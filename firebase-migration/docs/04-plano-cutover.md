# Plano de migração e cutover

## Fase 0 — congelar o contrato, não a operação

- Registrar inventário, versões e fontes de verdade.
- Manter WMGJ em funcionamento.
- Bloquear exclusões e alterações estruturais não versionadas durante o backfill.

## Fase 1 — homologação

- Criar projeto Firebase separado de produção.
- Escolher região próxima e compatível com a governança institucional.
- Criar organização `wmgj` e membros iniciais pelo Admin SDK.
- Implantar regras, índices e funções.
- Rodar Emulator Suite e testes de isolamento.

## Fase 2 — dry run

- `WMGJ_FIRESTORE_DRY_RUN=true`.
- Gerar eventos sem enviá-los.
- Conferir chaves naturais, competências, tipos e campos descartados.
- Aprovar mapa de dados clínicos/sensíveis antes de qualquer inclusão.

## Fase 3 — backfill incremental

- Ativar somente em homologação.
- Migrar por aba e lote pequeno.
- Usar checkpoint por linha e chave idempotente.
- Não alterar linhas de origem.
- Colocar divergências em fila de revisão.

## Fase 4 — dual write

- Exigir coluna ou versionador monotônico durável por registro; `sourceVersion=1` vale apenas para a fotografia inicial congelada.
- Apps Script continua gravando a planilha.
- Ponte espelha fatos aceitos para Firestore de forma não bloqueante.
- Firestore não devolve escrita à planilha nesta fase.
- Dashboard de reconciliação compara as duas bases.

## Fase 5 — validação

Obrigatório conferir:

- contagem por aba/coleção;
- soma de receitas, despesas, impostos e glosas;
- competência assistencial, fiscal, caixa e contábil;
- notas fiscais ativas e substituídas;
- documentos e hashes;
- itens bloqueados e em revisão humana;
- conciliações e saldo final;
- logs, tentativas e erros.

## Fase 6 — cutover de leitura

- Aplicativo passa a ler Firestore para os módulos aprovados.
- Planilha permanece disponível para contingência.
- Cutover progressivo por domínio, não “big bang”.

## Fase 7 — consolidação

- Dois fechamentos completos sem divergência material.
- Exportação de backup.
- Revisão de custo e índices.
- Só então decidir se a planilha deixa de ser fonte operacional primária.
