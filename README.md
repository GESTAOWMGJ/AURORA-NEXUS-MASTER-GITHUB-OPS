# automacao-gestao-wmgj

WMGJ - Automation and Operational Management System.

## Status operacional

Versão estável atual: `v1.0.1-pipeline-estavel`

Repositório oficial único:

```text
GESTAOWMGJ/automacao-gestao-wmgj
```

A partir desta versão, qualquer melhoria do robô, webhook, Gemini, Sheets, relatórios ou painel deve entrar primeiro neste repositório.

## Pipeline oficial

Arquivo principal:

```text
src/01_PIPELINE_CONFIABILIDADE_WMGJ.gs
```

Funções oficiais V3:

```text
diagnosticarPastaEntradaWMGJ_V3
limparTestesPipelineWMGJ_V3
criarArquivoTestePipelineWMGJ_V3
testePipelineArquivosReaisWMGJ_V3
prepararPipelineConfiavelWMGJ_V3
processarFilaWMGJ_V3
```

As funções antigas sem `_V3` foram mantidas apenas como wrappers de compatibilidade para evitar quebra de gatilhos antigos. A lógica operacional real está na V3.

## Validação registrada

Pipeline WMGJ validado em 18/05/2026 às 09:50.

Fluxo confirmado:

```text
Drive -> Fila -> Processamento -> Memória-base -> Log
```

Resultado validado:

```text
1 arquivo lido
1 arquivo enfileirado
1 arquivo processado
0 erros
0 duplicidades
```

Conclusão técnica: a arquitetura operacional está estável na V3. O gargalo anterior era conflito de funções antigas no Apps Script e deduplicação falsa durante o processamento.

## Ordem de execução recomendada no Apps Script

```text
1. limparTestesPipelineWMGJ_V3
2. criarArquivoTestePipelineWMGJ_V3
3. testePipelineArquivosReaisWMGJ_V3
4. processarFilaWMGJ_V3
```

## Próxima etapa

Depois da V3 estável, ligar progressivamente:

```text
Gemini/OCR -> relatórios financeiros automáticos -> painel executivo -> conciliação avançada
```

Nada de alimentar zoológico de função duplicada. A civilização já sofre o bastante.
