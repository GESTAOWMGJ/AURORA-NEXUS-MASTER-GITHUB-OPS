# WMGJ — Controle central e confiabilidade do pipeline

## Objetivo

Este documento define o padrão operacional para transformar o pipeline WMGJ em uma execução auditável, deduplicada e resistente a falhas.

A regra é simples, porque humanos insistem em transformar pasta de Drive em buraco negro corporativo:

```text
Entrada → Fila → Processamento → Memória-base → Dashboard/Relatório
```

## Componentes oficiais

- Repositório operacional único: `GESTAOWMGJ/automacao-gestao-wmgj`
- Núcleo oficial: `src/00_CORE_WMGJ.gs`
- Módulo de confiabilidade: `src/01_PIPELINE_CONFIABILIDADE_WMGJ.gs`
- Planilha mestre: `15LgI2U2dtM7vnrxFsiQMPTvBapBDg5ftgGttx7Pw0Cw`
- Pasta raiz: `1womnmIbaNQ8qkNlnkS2Ni71LVwtdrNj5`
- Pasta de entrada: `1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-`

## Abas obrigatórias

### `10_LOG_AUTOMACAO`

Log append-only. Registra início, fim, erros e testes.

### `13_CONTROLE_PIPELINE`

Painel técnico do estado do sistema.

### `14_MEMORIA_BASE_DOCUMENTOS`

Memória permanente de documentos processados.

Campos:

```text
DATA_REGISTRO | ORIGEM | ID_ORIGEM | NOME_ARQUIVO | MIME_TYPE | HASH | COMPETENCIA | CATEGORIA | STATUS | RESUMO_AI
```

### `15_FILA_PROCESSAMENTO`

Fila operacional.

Campos:

```text
DATA_ENTRADA | ORIGEM | ID_ORIGEM | NOME | TIPO | STATUS | TENTATIVAS | PROXIMA_ACAO | ULTIMO_ERRO | OBSERVACAO
```

## Estados permitidos da fila

```text
PENDENTE
PROCESSANDO
PROCESSADO
ERRO_REPROCESSAR
DUPLICADO
REVISAR_HUMANO
```

## Deduplicação

A deduplicação é feita por:

```text
ID_ORIGEM + HASH
```

O hash usa:

```text
fileId + nome + tamanho + última atualização
```

Esse hash não substitui hash binário integral de conteúdo, mas é suficiente para estabilizar a operação em Apps Script sem transformar o projeto em um ritual de sofrimento.

## Execução recomendada

### 1. Preparar abas e enfileirar entrada

Executar no Apps Script:

```javascript
prepararPipelineConfiavelWMGJ()
```

### 2. Processar fila em lote pequeno

Executar:

```javascript
processarFilaWMGJ(5)
```

### 3. Teste controlado

Executar:

```javascript
testarControleConfiabilidadeWMGJ()
```

## Política de IA

A IA nunca deve escrever diretamente na base financeira sem validação.

Fluxo correto:

```text
Gemini → JSON bruto → limpeza → JSON.parse → validação de categoria/confianca → memória-base → escrita operacional validada
```

Campos mínimos aceitos:

```text
categoria
confianca
```

Categorias aceitas:

```text
financeiro
produtividade
contrato
glosa
relatorio
cadastro
outro
```

Confiança mínima padrão:

```text
0.60
```

Abaixo disso, o item vai para:

```text
REVISAR_HUMANO
```

## Regra de produção financeira

Enquanto houver falhas de lançamento e conciliação em aberto:

```text
IA pode classificar e registrar memória.
IA não deve consolidar financeiro definitivo sem validação humana ou regra contábil fechada.
```

## Ordem segura de estabilização

```text
1. Rodar teste_execucao no webhook
2. Confirmar TESTE_OK em 10_LOG_AUTOMACAO
3. Rodar prepararPipelineConfiavelWMGJ
4. Conferir 15_FILA_PROCESSAMENTO
5. Rodar processarFilaWMGJ(5)
6. Conferir 14_MEMORIA_BASE_DOCUMENTOS
7. Validar duplicidade
8. Só depois liberar escrita financeira automática
```

## Critério mínimo para considerar o pipeline confiável

```text
Webhook responde JSON válido
Log grava TESTE_OK
Fila recebe arquivos reais
Memória registra ID_ORIGEM + HASH
Duplicados são bloqueados
Falha em um arquivo não derruba lote inteiro
IA inválida manda para revisão humana
Dashboard roda sem zerar indicadores por cabeçalho divergente
```

## Changelog

### 1.0.1

- Adicionado módulo `src/01_PIPELINE_CONFIABILIDADE_WMGJ.gs`
- Criada padronização de fila e memória-base
- Implementada deduplicação por ID_ORIGEM + HASH
- Implementado fallback local quando Gemini não estiver disponível
- Implementada validação de JSON antes da escrita operacional
- Documentado fluxo de estabilização do pipeline
