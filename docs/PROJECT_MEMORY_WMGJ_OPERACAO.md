# Memória operacional — WMGJ Operação

## Estado consolidado em 18/05/2026

Este documento registra o progresso técnico validado para continuidade do projeto WMGJ Operação.

## Repositório oficial

```text
GESTAOWMGJ/automacao-gestao-wmgj
```

Todos os avanços de robô, webhook, Apps Script, Gemini, OCR, Sheets, relatórios e painel executivo devem passar primeiro por este repositório.

Repositórios antigos ficam como legado, arquivados ou não operacionais.

## Versão estável atual

```text
v1.0.1-pipeline-estavel
```

Arquivo principal:

```text
src/01_PIPELINE_CONFIABILIDADE_WMGJ.gs
```

## Camada de extração real validada

```text
v1.1.2-extracao-documental-compat-total
```

Arquivo principal:

```text
src/04_EXTRACAO_DOCUMENTAL_WMGJ.gs
```

Objetivo da camada:

```text
Manter V3 estável intocada e adicionar extração real com Gemini/OCR, com compatibilidade contra helpers privados ausentes no Apps Script.
```

## Pipeline validado

Fluxo operacional confirmado:

```text
Drive -> Fila -> Processamento -> Memória-base -> Log
```

Fluxo expandido da extração real:

```text
Drive -> Fila -> Extração/OCR -> Gemini/Fallback -> Validação JSON -> Memória-base -> Log
```

Pasta de entrada validada:

```text
99_ARQUIVO_BRUTO_A_CLASSIFICAR
ID: 1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-
```

Planilha mestre localizada no Drive:

```text
WMGJ_BASE_MESTRE_OPERACIONAL_FINANCEIRA
ID: 15LgI2U2dtM7vnrxFsiQMPTvBapBDg5ftgGttx7Pw0Cw
```

Abas centrais:

```text
10_LOG_AUTOMACAO
13_CONTROLE_PIPELINE
14_MEMORIA_BASE_DOCUMENTOS
15_FILA_PROCESSAMENTO
16_EXTRACOES_DOCUMENTAIS
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

As funções antigas sem `_V3` foram mantidas como wrappers para preservar compatibilidade com gatilhos antigos, mas a lógica operacional real está na V3.

## Funções da extração real

```text
rodarDiagnosticoExtracaoRealWMGJ
rodarExtracaoRealWMGJ_5
executarExtracaoRealWMGJ_V1
processarFilaComExtracaoRealWMGJ_V1
diagnosticarExtracaoRealWMGJ_V1
```

## Validação operacional

### Primeira validação V3

Data: 18/05/2026 às 09:50

Resultado:

```text
1 arquivo lido
1 arquivo enfileirado
1 arquivo processado
0 erros
0 duplicidades
```

### Revalidação V3

Data: 18/05/2026 às 10:44

Resultado principal:

```text
processarFilaWMGJ_V3
{"ok":true,"processados":1,"erros":0,"duplicados":0}
```

Teste completo:

```text
testePipelineArquivosReaisWMGJ_V3
lidos: 1
enfileirados: 1
duplicados no preparo: 0
processados: 1
erros: 0
duplicados no processamento: 0
```

Segunda execução segura:

```text
processarFilaWMGJ_V3
{"ok":true,"processados":0,"erros":0,"duplicados":0}
```

Interpretação: após processar o item pendente, a segunda execução não encontrou novas pendências e não gerou erro ou duplicidade. Esse é o comportamento correto.

## Diagnóstico Gemini/OCR

### 18/05/2026 às 11:12

Resultado informado pelo Apps Script:

```text
Pasta de entrada: OK
99_ARQUIVO_BRUTO_A_CLASSIFICAR
ID: 1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-

Gemini: OK
configurado: true
modelo: gemini-1.5-flash

Extração documental: camada carregada
versao: v1.1.0-extracao-documental

Drive API avançado / OCR real: PENDENTE
driveApiAvancadoDisponivel: false
```

### 18/05/2026 às 11:20

Resultado informado pelo Apps Script:

```text
Pasta de entrada: OK
99_ARQUIVO_BRUTO_A_CLASSIFICAR
ID: 1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-

Gemini: OK
configurado: true
modelo: gemini-1.5-flash

Extração documental: OK
versao: v1.1.0-extracao-documental

Drive API avançado / OCR real: OK
driveApiAvancadoDisponivel: true
```

Conclusão: Gemini está configurado, pasta de entrada está acessível, camada de extração documental está carregada e OCR real via Drive API avançada está habilitado.

## Validação da extração real

### 18/05/2026 às 11:42

Resultado informado pelo Apps Script:

```text
processarFilaComExtracaoRealWMGJ_V1
{"ok":true,"versao":"v1.1.2-extracao-documental-compat-total","etapa":"processarFilaComExtracaoRealWMGJ_V1","avaliados":1,"processados":1,"erros":0,"duplicados":0,"revisar":0}
```

Execução consolidada:

```text
executarExtracaoRealWMGJ_V1
preparo:
lidos: 2
enfileirados: 0
duplicados: 2

processamento:
avaliados: 1
processados: 1
erros: 0
duplicados: 0
revisar: 0
```

Interpretação:

```text
A extração real rodou sem erro fatal.
A fila processou 1 item pendente.
Não houve erro, duplicidade falsa nem revisão humana.
Os 2 arquivos da pasta de entrada já estavam reconhecidos no preparo, por isso não foram reenfileirados.
```

### 18/05/2026 às 11:45

Resultado informado pelo Apps Script / Cloud Logs:

```text
executarExtracaoRealWMGJ_V1
preparo:
lidos: 2
enfileirados: 0
duplicados: 2

processamento:
avaliados: 0
processados: 0
erros: 0
duplicados: 0
revisar: 0
```

Interpretação:

```text
Reexecução idempotente validada.
A pasta tinha 2 arquivos já reconhecidos.
Não havia item PENDENTE ou ERRO_REPROCESSAR na fila.
A execução não criou duplicidade, não gerou erro e não reprocessou indevidamente.
```

## Gargalo resolvido

Problema anterior:

```text
Deduplicação falsa durante processamento.
```

Causa:

```text
Funções antigas no Apps Script misturavam fila operacional com memória-base, fazendo o sistema tratar arquivo PENDENTE como DUPLICADO.
```

Correção:

```text
PENDENTE fica apenas em 15_FILA_PROCESSAMENTO.
14_MEMORIA_BASE_DOCUMENTOS recebe apenas documento efetivamente PROCESSADO.
Deduplicação usa ID_ORIGEM + HASH somente contra memória processada.
```

## Segundo gargalo resolvido

Problema anterior:

```text
ReferenceError por helpers privados ausentes no Apps Script.
```

Exemplo:

```text
garantirAbasControlePipelineWMGJ_V3_ is not defined
```

Correção:

```text
src/04_EXTRACAO_DOCUMENTAL_WMGJ.gs foi atualizado para v1.1.2-extracao-documental-compat-total, com helpers locais de compatibilidade.
```

## Status técnico atual

```text
Drive OK
Fila OK
Processamento OK
Memória-base OK
Log OK
Deduplicação OK
Reexecução segura OK
Idempotência OK
Pipeline V3 estável
Gemini configurado OK
Drive API avançada OK
OCR real habilitado OK
Extração real v1.1.2 executada OK
Processamento real de 1 item OK
Reexecução sem pendência OK
Erros: 0
Duplicados no processamento: 0
Revisão humana: 0
```

## Próxima etapa técnica

Próximo bloco de evolução:

```text
Auditar conteúdo gravado nas abas 16_EXTRACOES_DOCUMENTAIS e 14_MEMORIA_BASE_DOCUMENTOS, depois gerar relatório executivo mensal automático.
```

A ordem correta é:

```text
1. Conferir 16_EXTRACOES_DOCUMENTAIS.
2. Confirmar METODO_EXTRACAO, TAMANHO_TEXTO, STATUS e AMOSTRA_TEXTO.
3. Conferir 14_MEMORIA_BASE_DOCUMENTOS.
4. Confirmar competência, categoria, status PROCESSADO e resumo JSON.
5. Consolidar dados financeiros, atendimentos, contas a receber e status executivo.
6. Gerar PDF didático para sócios.
7. Só depois versionar como nova release estável.
```

## Regra de arquitetura

Nada deve gravar diretamente na memória-base antes da validação.

Fluxo obrigatório:

```text
Arquivo bruto -> Fila -> Extração -> Classificação -> Validação JSON -> Memória-base -> Relatórios/Painel
```

## Próximos arquivos sugeridos

```text
src/06_RELATORIO_EXECUTIVO_WMGJ.gs
schemas/documento_extraido.schema.json
schemas/classificacao_documental.schema.json
tests/payloads/documento_texto_teste.json
tests/payloads/documento_pdf_teste.json
```

## Critério de aceite da próxima fase

A próxima fase só deve ser considerada estável quando:

```text
1 PDF processado com texto extraído
1 imagem processada com OCR ou fallback controlado
1 documento texto processado
JSON validado com categoria, competência, valor e resumo
0 falhas derrubando lote inteiro
0 duplicidades falsas
log completo em 10_LOG_AUTOMACAO
relatório executivo gerado a partir da memória-base
```

## Observação operacional

A V3 é a base de produção. Qualquer melhoria deve ser adicionada como camada, não como substituição improvisada. O sistema finalmente parou de acusar o próprio arquivo de duplicado; não vamos premiar esse avanço jogando código experimental dentro do motor estável.