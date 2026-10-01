# CHECKPOINT ATUAL — WMGJ OPERAÇÃO

**Data de consolidação:** 13/07/2026  
**Status:** checkpoint operacional persistente  
**Repositório oficial:** `GESTAOWMGJ/automacao-gestao-wmgj`  
**Branch operacional:** `main`  
**Conta GitHub ativa:** `GESTAOWMGJ`  

## 1. Finalidade

Este documento é a referência corrente para retomada da operação WMGJ. Ele registra o estado técnico, financeiro, operacional e de governança conhecido nesta data.

A memória do chat não deve ser tratada como banco permanente. As fontes persistentes são:

1. GitHub oficial para código, documentação e histórico de versões.
2. Planilha mestre para dados operacionais, financeiros, filas, memória documental, logs e controles.
3. Google Drive e Gmail para documentos-fonte e evidências.
4. Google Apps Script para execução, propriedades seguras, gatilhos e integrações.

## 2. Fontes oficiais

### Repositório

```text
GESTAOWMGJ/automacao-gestao-wmgj
```

### Planilha mestre

```text
WMGJ_BASE_MESTRE_OPERACIONAL_FINANCEIRA
ID: 15LgI2U2dtM7vnrxFsiQMPTvBapBDg5ftgGttx7Pw0Cw
```

### Pasta de entrada operacional

```text
99_ARQUIVO_BRUTO_A_CLASSIFICAR
ID: 1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-
```

### Apps Script atualmente validado em tela

```text
Projeto: Cópia de WMGJ - AUTOMAÇÃO
Script ID: 1_fQPqaq0EjaugyIF6jyuENDhJ2c2oTFm1kC-wdjmfaDqyRzy_uqwtiSW
```

## 3. Estado técnico consolidado

### Pipeline operacional

Base estável validada:

```text
Drive → Fila → Processamento → Memória-base → Log
```

Fluxo documental expandido:

```text
Gmail/Drive
→ 15_FILA_PROCESSAMENTO
→ Extração/OCR
→ Gemini ou fallback controlado
→ Validação JSON
→ 14_MEMORIA_BASE_DOCUMENTOS
→ Bases financeiras e operacionais
→ Dashboard
→ Relatório preliminar/final
→ Log e pendências
```

Regras confirmadas:

- item `PENDENTE` permanece somente na fila;
- memória-base recebe documento efetivamente processado;
- deduplicação por `ID_ORIGEM + HASH`;
- uma falha individual não deve derrubar o lote;
- reexecução deve ser idempotente;
- toda escrita financeira automática depende de validação anterior.

### Gemini

Situação validada no Apps Script aberto:

```text
GEMINI_API_KEY: válida
Modelo: gemini-3.5-flash
Teste direto: aprovado
Retorno: {"ok":true,"origem":"gemini"}
Teste completo do classificador: aprovado
origem_classificacao: gemini
```

Código oficial no repositório:

```text
src/05_GEMINI_CLASSIFICADOR_WMGJ.gs
Versão: v1.2.0-gemini-api-validada
Modelo padrão: gemini-3.5-flash
```

Controles obrigatórios:

- chave somente em Script Properties;
- nunca gravar chave em GitHub, planilha ou log;
- normalizar nome do modelo;
- validar JSON antes de aceitar classificação;
- registrar `origem_classificacao = gemini` somente quando a IA realmente responder e passar na validação;
- usar `fallback_local` quando a API estiver indisponível;
- registrar erro sanitizado sem expor credenciais.

### Deploy GitHub → Apps Script

Estado atual:

```text
Código no GitHub main: atualizado
Workflow: presente e estruturalmente corrigido
Destino Apps Script: configurado para o Script ID validado
Arquivo 99_DEPLOY_SYNC_WMGJ.gs: presente no GitHub
Arquivo 99_DEPLOY_SYNC_WMGJ no Apps Script: não confirmado
Execução recente do GitHub Actions: não localizada
Deploy da v1.2.0 no Apps Script: não confirmado
```

Conclusão:

> Não considerar o repositório e o Apps Script alinhados até existir execução real do workflow, `clasp push --force` concluído e confirmação no editor do Apps Script.

Bloqueios possíveis:

- GitHub Actions desabilitado;
- workflow desabilitado;
- secret `CLASPRC_JSON` ausente, inválido ou expirado;
- autenticação clasp sem acesso ao projeto de destino.

Critério de aceite do alinhamento:

1. GitHub Actions registrar uma execução.
2. Etapa `Push to Apps Script` concluir.
3. Verificação pós-deploy localizar `v1.2.0-gemini-api-validada`.
4. Editor Apps Script exibir `99_DEPLOY_SYNC_WMGJ`.
5. Função `diagnosticarSincronizacaoRepositorioWMGJ()` retornar `ok: true`.
6. `diagnosticarGeminiWMGJ_V1()` retornar a versão `v1.2.0-gemini-api-validada`.

## 4. Base de dados operacional

Abas de controle centrais:

```text
10_LOG_AUTOMACAO
11_PENDENCIAS_SANEAMENTO
13_CONTROLE_PIPELINE
14_MEMORIA_BASE_DOCUMENTOS
15_FILA_PROCESSAMENTO
15_STATUS_AUTOMACAO
16_EXTRACOES_DOCUMENTAIS
17_EXTRACOES_FORMATADAS
18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS
19_RESUMO_FINANCEIRO_MENSAL
20_RELATORIOS_EXECUTIVOS_GERADOS
21_GMAIL_INDEXACAO_FATURAMENTO
22_NOTAS_FISCAIS_EXTRAIDAS
23_CONTROLE_CICLOS_AUTOMATICOS
24_AUTOMACAO_GATILHOS
25_TRAVA_WATCHDOG
39_MODUS_OPERANDI_RELATORIOS
40_FECHAMENTO_MENSAL_COMPLETO
42_CHECKPOINT_OPERACIONAL
```

Regra de banco:

- documento-fonte não é apagado por padrão;
- item processado deve manter trilha de origem;
- toda classificação deve registrar método, versão, status e evidência;
- reprocessamento deve ser bloqueado por identidade e hash, salvo reprocessamento autorizado;
- dados financeiros não devem ser sobrescritos por resumo textual ou inferência;
- correções devem preservar histórico e registrar motivo.

## 5. Posição financeira e operacional de referência

Última posição consolidada conhecida em 13/07/2026:

```text
Saldo Bradesco conciliado até 23/06/2026: R$ 63.166,78
Maio/2026: fechado operacionalmente
Resultado operacional de maio: R$ 12.015,00
Junho/2026: 453 atendimentos confirmados
Receita econômica teórica de junho: R$ 40.770,00
NFS-e de junho: não localizada na última consolidação
Recebimento de junho: não confirmado
Escala/períodos definitivos de junho: pendentes
Resultado líquido real de junho: ainda não calculável
Saldo remanescente Dr. Mario: R$ 2.500,00 a compensar em obrigação futura validada
```

Interpretação obrigatória:

- caixa bancário não equivale a lucro distribuível;
- produção econômica não equivale a receita realizada;
- faturamento não equivale a recebimento;
- resultado preliminar não equivale a resultado contábil final;
- distribuição permanece bloqueada quando houver pendência crítica fiscal, contábil, societária, documental ou de conciliação.

## 6. Modus operandi resumido

### Entrada

Fontes:

- Gmail;
- Drive;
- upload manual;
- webhook autorizado.

Documentos:

- produtividade;
- escala médica;
- NFS-e/XML/PDF;
- extratos Bradesco;
- comprovantes;
- contratos;
- documentos cadastrais de médicos;
- tributos;
- glosas;
- documentos contábeis.

### Processamento

1. Capturar somente itens novos.
2. Registrar origem, messageId/fileId e anexo.
3. Salvar documento-fonte no Drive.
4. Calcular hash.
5. Verificar duplicidade.
6. Inserir na fila como `PENDENTE`.
7. Alterar para `PROCESSANDO` durante execução.
8. Extrair texto/OCR.
9. Classificar com Gemini.
10. Validar JSON e confiança.
11. Registrar em memória-base somente após validação.
12. Atualizar bases específicas.
13. Atualizar dashboard e relatórios.
14. Registrar log e pendências.
15. Finalizar como `PROCESSADO`, `REVISAR_HUMANO`, `ERRO` ou `DUPLICADO`.

### Relatórios

Todo relatório deve separar:

1. competência assistencial;
2. competência fiscal;
3. regime de caixa;
4. produção;
5. NFS-e;
6. recebimento;
7. escala e períodos;
8. repasses médicos;
9. tributos e despesas;
10. pendências e riscos;
11. status preliminar/final;
12. status distributivo/não distributivo.

Relatório final somente quando houver:

- NFS-e validada;
- recebimento conciliado;
- escala/períodos confirmados;
- repasses conciliados;
- tributos classificados;
- despesas classificadas;
- pendências críticas resolvidas;
- validação contábil/societária quando aplicável.

## 7. Governança de código

Regras obrigatórias:

- `src/` é a fonte publicada no Apps Script;
- um único núcleo oficial;
- evitar funções globais duplicadas;
- funções públicas operacionais ficam no núcleo estável;
- testes ficam isolados e identificados;
- não substituir a V3 estável por código experimental;
- toda alteração relevante passa por commit auditável;
- deploy só é considerado concluído com evidência de execução.

## 8. Segurança

- Nunca registrar API keys, tokens OAuth, `CLASPRC_JSON` ou senhas em código, planilha ou logs.
- Nunca compartilhar a `GEMINI_API_KEY` em conversa.
- Usar Script Properties e GitHub Secrets.
- Sanitizar erros antes de registrar.
- Não executar pagamento, emissão fiscal, assinatura ou distribuição societária sem a trava humana definida.

## 9. Pendências prioritárias

### Prioridade 1 — CI/CD

- habilitar/verificar GitHub Actions;
- confirmar `CLASPRC_JSON`;
- executar workflow;
- validar `clasp push --force`;
- confirmar `99_DEPLOY_SYNC_WMGJ` no Apps Script;
- confirmar versão Gemini v1.2.0 no runtime.

### Prioridade 2 — Junho/2026

- localizar/validar NFS-e;
- confirmar recebimento;
- validar escala e períodos;
- confirmar ausência ou produção de Barbara;
- calcular custo médico definitivo;
- apurar resultado real.

### Prioridade 3 — Regularizações

- concluir fevereiro e março com escala, períodos e pagamentos deduplicados;
- validar conta contábil do saldo de R$ 2.500,00 do Dr. Mario;
- concluir revisão jurídica e contábil das minutas societárias/contratuais.

## 10. Comando de retomada

```text
Retomar WMGJ pelo CHECKPOINT_ATUAL_WMGJ_OPERACAO e executar a próxima pendência prioritária sem alterar a V3 estável.
```

## 11. Regra final

> Não confundir código versionado com código implantado, nem caixa com lucro, nem produção com receita realizada. Toda conclusão precisa de evidência na fonte oficial correspondente.
