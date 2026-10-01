# Status Operacional WMGJ

## Versão operacional atual

**v1.0.1-pipeline-estavel**

A versão operacional confiável do projeto é a **V3**.

## Fluxo validado

```text
Drive → Fila → Processamento → Memória-base → Log
```

## Pasta de entrada validada

```text
99_ARQUIVO_BRUTO_A_CLASSIFICAR
ID: 1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-
```

## Funções oficiais V3

```text
diagnosticarPastaEntradaWMGJ_V3
limparTestesPipelineWMGJ_V3
criarArquivoTestePipelineWMGJ_V3
testePipelineArquivosReaisWMGJ_V3
prepararPipelineConfiavelWMGJ_V3
processarFilaWMGJ_V3
```

## Resultado da validação V3

```text
1 arquivo lido
1 arquivo enfileirado
1 arquivo processado
0 erros
0 duplicidades
```

A reexecução retornou fila limpa, confirmando deduplicação correta e ausência de pendências após o processamento.

## Regra operacional ativa

```text
Arquivo bruto → Fila → Extração → Classificação → Validação JSON → Memória-base → Relatórios/Painel
```

## Diretriz técnica

A V3 deve permanecer intocada como base estável. Qualquer evolução com Gemini, OCR, Document AI ou classificação inteligente deve ser implementada como camada separada, sem alterar o motor validado.

## Próxima fase autorizada

Criar camada isolada de extração documental e classificação estruturada:

1. Extração de texto de documentos.
2. Classificação com Gemini.
3. Validação de JSON.
4. Escrita controlada na memória-base.
5. Geração posterior de relatórios financeiros e operacionais.

## Status

```text
OPERACIONAL_ESTAVEL_V3
AUTOMACAO_AI_OCR_EM_PREPARACAO
```
