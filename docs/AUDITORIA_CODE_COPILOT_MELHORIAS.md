# Auditoria Code Copilot - Melhorias Operacionais WMGJ

Implementação adicionada em `src/16_AUDITORIA_CODE_COPILOT_WMGJ.gs`.

## Escopo aplicado

- Criação/garantia das abas `07_ESCALA`, `03_PRODUTIVIDADE_MEDICO` e `08_EXTRATOS_BRADESCO`.
- Processamento de escala CSV via `processarEscalaWMGJ(conteudoCsv, competencia, nomeArquivo)`.
- Agregação mensal por médico, unidade e especialidade.
- Comparação entre produtividade individual e total da unidade.
- Conferência mensal de completude para escala, NFS-e e extrato Bradesco.
- Conciliação de NFS-e com extrato por data e valor.
- Atualização do campo `EM_ABERTO` em `05_FINANCEIRO_MENSAL` quando houver correspondência.
- Registro de pendências em `11_PENDENCIAS_SANEAMENTO`.
- Notificação operacional por GmailApp.
- Validações auxiliares para competência, data, valores e CNPJ.
- Gatilho mensal instalável no dia 5 às 08h via `instalarGatilhosAuditoriaCodeCopilotWMGJ()`.

## Funções principais

- `executarMelhoriasAuditoriaCodeCopilotWMGJ(competencia)`
- `garantirEstruturaAuditoriaCodeCopilotWMGJ()`
- `processarEscalaWMGJ(conteudoCsv, competencia, nomeArquivo)`
- `calcularProdutividadeIndividualWMGJ(competencia)`
- `verificarCompletudeMensalWMGJ(competencia)`
- `conciliarFinanceiroAuditoriaWMGJ(competencia)`
- `instalarGatilhosAuditoriaCodeCopilotWMGJ()`

## Observação operacional

O módulo foi criado isolado para preservar a base estável do pipeline. A integração direta ao `runWMGJ()` pode ser feita chamando:

```javascript
if (typeof executarMelhoriasAuditoriaCodeCopilotWMGJ === 'function') {
  resultados.push(executarMelhoriasAuditoriaCodeCopilotWMGJ());
}
```

A decisão de manter isolado evita alterar o fluxo produtivo sem validação final em Apps Script, porque aparentemente a humanidade ainda insiste em produção sem ambiente de homologação decente.
