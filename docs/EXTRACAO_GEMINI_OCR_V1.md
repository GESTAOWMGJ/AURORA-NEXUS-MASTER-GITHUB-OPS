# WMGJ — Extração real com Gemini/OCR mantendo V3 estável

## Objetivo

Ligar leitura real de documentos ao pipeline WMGJ sem alterar a base estável V3.

A V3 continua sendo a camada confiável:

```text
Drive → Fila → Processamento → Memória-base → Log
```

A nova camada entra depois da fila:

```text
Drive → Fila V3 → Extração real → Gemini/Fallback → Validação JSON → Memória-base
```

## Arquivos adicionados

```text
src/04_EXTRACAO_DOCUMENTAL_WMGJ.gs
src/05_GEMINI_CLASSIFICADOR_WMGJ.gs
```

## Funções principais

### Diagnóstico

```javascript
diagnosticarExtracaoRealWMGJ_V1()
diagnosticarGeminiWMGJ_V1()
```

### Execução real

```javascript
executarExtracaoRealWMGJ()
executarExtracaoRealWMGJ_V1(limite)
processarFilaComExtracaoRealWMGJ_V1(limite)
```

### Teste Gemini

```javascript
testeGeminiClassificadorWMGJ_V1()
```

## Configuração Gemini

No Apps Script, executar uma vez:

```javascript
function configurarGeminiWMGJ() {
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', 'SUA_CHAVE_AQUI');
  PropertiesService.getScriptProperties().setProperty('GEMINI_MODEL', 'gemini-1.5-flash');
}
```

A chave não deve ser commitada no GitHub.

## Configuração OCR / conversão

Para PDFs, imagens e arquivos Office, a camada usa conversão temporária via Drive API.

No Apps Script:

1. Abra Serviços.
2. Adicione o serviço avançado **Drive API**.
3. Confirme que a Drive API também está habilitada no Google Cloud do projeto.

Sem isso, o sistema não quebra. Ele registra fallback por metadados, porque aparentemente resiliência ainda precisa ser ensinada a sistemas feitos por humanos.

## Abas usadas

```text
15_FILA_PROCESSAMENTO
14_MEMORIA_BASE_DOCUMENTOS
16_EXTRACOES_DOCUMENTAIS
10_LOG_AUTOMACAO
```

## Ordem de teste

1. Manter V3 validada.
2. Subir os dois arquivos novos ao Apps Script.
3. Executar:

```javascript
diagnosticarExtracaoRealWMGJ_V1()
```

4. Se Gemini estiver sem chave, configurar `GEMINI_API_KEY`.
5. Se Drive API avançado estiver falso, habilitar Drive API.
6. Criar ou colocar arquivo real em `99_ARQUIVO_BRUTO_A_CLASSIFICAR`.
7. Executar:

```javascript
executarExtracaoRealWMGJ_V1(5)
```

## Resultado esperado

Na aba `16_EXTRACOES_DOCUMENTAIS`:

```text
DATA_EXTRACAO | VERSAO | ID_ORIGEM | NOME_ARQUIVO | MIME_TYPE | HASH | METODO_EXTRACAO | TAMANHO_TEXTO | STATUS | OBSERVACAO | AMOSTRA_TEXTO
```

Na aba `14_MEMORIA_BASE_DOCUMENTOS`:

```text
PROCESSADO | categoria | competencia | resumo JSON
```

Na fila:

```text
PROCESSADO
```

ou, em caso de baixa confiança:

```text
REVISAR_HUMANO
```

## Regra de segurança

A escrita financeira automática ainda não deve ser acionada direto pela extração.

Primeiro estabilizar:

```text
Extração → JSON válido → Memória-base
```

Depois liberar:

```text
Memória-base → Financeiro/Produtividade/Relatórios
```

## Estado da versão

```text
v1.1.0-extracao-documental
```

Commits técnicos:

```text
9ab7ff6805ee30f81a2cae13ebbb9c7a7f41f7fe
f6cc7e1de07469b3be4baa48ca0ffadcf38f5150
```
