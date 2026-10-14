# Integração financeira estruturada — M01/M02/M03/M08/M10

Baseline: `2bc6e6a3ef8df2e9d6df8e42ef239933132c85c8` (main inspecionada).
Produto: AURORA NEXUS; incremento do bridge existente, não novo executor.
Estado: IMPLEMENTED; runtime/ingestão real/publicação PENDING.

## Desafio e diagnóstico comprovado

Cabeçalhos operacionais divergem do mapa legado: `RECEITA_BRUTA_NFS`,
`RECEBIDO_CONCILIADO` e `VALOR_SERVICO` não tinham os aliases necessários.
As abas 18/19 não participavam do mapa. Importação documental pelo portal
não materializa automaticamente invoices/bankTransactions/financialEntries.
A seção de prazos usa vencimentos de contas a pagar e depende do fechamento;
ela não representa o próximo crédito bancário e não pode usar emissão como vencimento.

## Contrato de campos

| Fonte | Destino existente | Campos e semântica |
| --- | --- | --- |
| 05_FINANCEIRO_MENSAL | financialEntries, CONTROL_ONLY | competência assistencial; RECEITA_BRUTA_NFS → grossRevenueCents; RECEBIDO_CONCILIADO → receivedAmountCents **declarado pela fonte**; EM_ABERTO → outstandingAmountCents; STATUS_CONCILIACAO preservado; não é outra transação ou novo fechamento |
| 06_NFS_E | invoices | CHAVE_ACESSO mantém identidade; NUMERO_NF → invoiceNumber; VALOR_SERVICO → totalCents; VALOR_LIQUIDO → netAmountCents; ISS_APURADO → taxAmountCents; ID_DRIVE/LINK_DRIVE → originDocumentRef; notas substituídas ficam HISTORY_ONLY |
| 18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS | sourceDocuments, CONTROL_ONLY | DATA/COMPETENCIA_CAIXA/CLASSIFICACAO/NF_RELACIONADA preservados; CREDITO/DEBITO → creditCents/debitCents; PENDING_HUMAN_REVIEW; nunca duplica o ledger bancário |
| 19_RESUMO_FINANCEIRO_MENSAL | sourceDocuments, CONTROL_ONLY | TOTAL_CREDITOS/TOTAL_DEBITOS/RESULTADO_LIQUIDO/VALOR_INDEFINIDO em centavos; contagens e revisão permanecem na fonte; resumo não vira lançamento |
| 08_EXTRATOS_BRADESCO | bankTransactions (adaptador preservado) | data/documento bancário identificam o movimento; classificação/competência e recibo precisam de validação própria; nenhuma ampliação de status conciliado por substring |
| Contrato/regra vigente | evidência privada da organização | competência da prestação, cláusula, versão/hash e condições; emissão, crédito e SLA não são vencimento |

Cada entidade conserva `source.parentId/sourceId/fileName`, hash do conteúdo
materializado e `record.sourceRowHash` (também espelhado em metadata) do texto original. `fieldOrigins`
identifica as colunas monetárias. Branco vira null explícito, inclusive para
revogar um valor anterior durante merge; zero conhecido permanece zero.
Valor fiscal emitido não comprova saldo em aberto. `receivableCents=null`
não admite fallback para o bruto; o saldo declarado fica separado para revisão.
Não atribuir data calculada até comprovar regra aplicável, competência e condições.
Uma regra de dia do mês que não existe (por exemplo, dia 30 em fevereiro)
exige resolução documentada, nunca rolagem automática de calendário.

## Idempotência e preservação

A identidade de NFS-e continua sua chave de acesso. Registros sem identidade
forte preservam a posição na fonte congelada; não reordenar fontes durante backfill.
Na aba 18, documento compartilhado não é chave única do lançamento.
A aba 19 usa competência validada como identidade, pois seu produtor reordena
as linhas. Ausência posterior de uma competência não autoriza apagamento: o
resumo histórico CONTROL_ONLY permanece sujeito à conferência da fonte atual.
O extrator alternativo TIPO/VALOR preserva o valor e deriva crédito/débito apenas
para direção explícita; conflitos monetários interrompem a linha.
Correção de adaptador altera hash materializado e chave idempotente versionada,
mantendo entidade e revisão imutável existentes. Repetição idêntica conserva chave.
Não aumentar artificialmente sourceVersion nem apagar recibos históricos.
Resposta sem confirmação não avança checkpoint, mesmo com linhas posteriores aceitas.
Nenhuma escrita em monthlyClosings, distributionDecisions ou fonte da planilha.

## Investigação documental privada

Foram examinados cabeçalhos e amostras da base autorizada, índice de contratos,
resumo contratual e instrumento contratual original localizado no Drive.
Há regra de prazo vinculada ao mês da prestação e condições documentais/de
recebimento; não promover a regra privada à capacidade genérica nem a garantia
de recebimento. Localizadores e conteúdo contratual permanecem no tenant/origem.
Assinatura, aditivos atuais, cumprimento das condições e vínculo por título
precisam de comprovação na reconciliação. Nenhum pagamento foi inferido.

## Gates restantes e rollback

1. CI da candidata e revisão do diff; publicar pelo fluxo existente autorizado.
2. Conferir contrato de destino, identidade autenticada e configuração protegida
   do bridge; exportação web documental não substitui esse canal.
3. Dry-run limitado às abas mapeadas; verificar amostra e cobertura, especialmente
   aba 18 extensa/mista. Não disparar ingestão global sem demonstrar capacidade
   e escopo; limites de leitura canônica permanecem fail-closed.
4. Replay com recibos remotos e readback do mesmo tenant, entidade, versão e hash;
   repetir para comprovar zero entidades adicionais; conferir fechamentos antes/depois.
5. Conferir tela autenticada após publicação. Observação anterior da interface
   não comprova adoção deste patch.

Rollback de código pelo fluxo existente. Preservar fontes, chaves e versões;
reversão de dados exige evento auditado explícito. Não executar um produtor antigo
sobre dados novos para simular rollback. Nenhum gate foi desabilitado.
