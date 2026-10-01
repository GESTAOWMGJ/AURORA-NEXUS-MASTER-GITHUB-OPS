# Changelog

## v1.2.0-gemini-api-validada - 2026-07-13

### Integração Gemini

- Chave da Gemini API validada por chamada real no Apps Script.
- Resposta direta confirmada: `{"ok":true,"origem":"gemini"}`.
- Modelo padrão do classificador atualizado para `gemini-3.5-flash`, conforme configuração que respondeu no projeto validado.
- `GEMINI_API_KEY` e `GEMINI_MODEL` permanecem exclusivamente em Script Properties.
- Adicionada normalização do nome do modelo para impedir formatos inválidos como `models/...`, aspas e sufixo `:generateContent`.
- Adicionado teste direto `testeDiretoGeminiWMGJ()` sem fallback.
- O teste `testeGeminiClassificadorWMGJ_V1()` agora só aprova quando `origem_classificacao` é `gemini`.
- Resposta da IA passa por `JSON.parse` e `validarDocumentoJsonWMGJ_()` antes de ser aceita.
- Mantido fallback local para preservar continuidade operacional quando a API estiver indisponível.
- Erros e logs são sanitizados para impedir exposição acidental da chave.
- O pipeline V3 não foi alterado.

### Validação operacional

Teste executado no Apps Script em 13/07/2026:

```json
{"ok":true,"origem":"gemini"}
```

Conclusão: autenticação, permissão, modelo e chamada `generateContent` foram confirmados no projeto Apps Script testado.

## v1.0.1-pipeline-estavel - 2026-05-18

### Consolidado

- V3 promovida como versão oficial do pipeline WMGJ.
- Arquivo oficial: `src/01_PIPELINE_CONFIABILIDADE_WMGJ.gs`.
- Repositório oficial único: `GESTAOWMGJ/automacao-gestao-wmgj`.

### Funções oficiais

```text
diagnosticarPastaEntradaWMGJ_V3
limparTestesPipelineWMGJ_V3
criarArquivoTestePipelineWMGJ_V3
testePipelineArquivosReaisWMGJ_V3
prepararPipelineConfiavelWMGJ_V3
processarFilaWMGJ_V3
```

### Compatibilidade

As funções antigas sem `_V3` foram convertidas em wrappers para a V3, reduzindo conflito sem quebrar gatilhos já existentes no Apps Script.

### Correções

- Corrigida deduplicação falsa durante processamento.
- `PENDENTE` permanece apenas na fila.
- Memória-base recebe apenas documentos efetivamente `PROCESSADO`.
- Duplicidade validada por `ID_ORIGEM + HASH`.
- Falha individual de arquivo não derruba o lote inteiro.
- Tratamento de erro para pasta de entrada inválida ou ausente.

### Validação operacional

Teste registrado em 18/05/2026 às 09:50:

```text
Drive -> Fila -> Processamento -> Memória-base -> Log
```

Resultado:

```text
1 arquivo lido
1 arquivo enfileirado
1 arquivo processado
0 erros
0 duplicidades
```

### Revalidação operacional

Revalidação registrada em 18/05/2026 às 10:44:

```text
processarFilaWMGJ_V3
{"ok":true,"processados":1,"erros":0,"duplicados":0}

testePipelineArquivosReaisWMGJ_V3
Drive -> Fila -> Processamento -> Memória-base -> Log
lidos: 1
enfileirados: 1
duplicados no preparo: 0
processados: 1
erros: 0
duplicados no processamento: 0

processarFilaWMGJ_V3 em segunda execução
{"ok":true,"processados":0,"erros":0,"duplicados":0}
```

Conclusão: pipeline V3 confirmado como estável. A segunda execução sem itens pendentes retornou zero processamento e zero erro, comportamento esperado para fila limpa.

### Próxima fase

- Integrar Gemini/OCR em produção controlada.
- Extrair dados estruturados de PDF, imagem, XLS e DOC.
- Alimentar relatórios financeiros automáticos.
- Atualizar painel executivo e conciliação.
