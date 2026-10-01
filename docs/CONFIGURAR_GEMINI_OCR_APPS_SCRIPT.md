# Configurar Gemini e OCR real no Apps Script — WMGJ

## Objetivo

Configurar a chave do Gemini em Script Properties e habilitar OCR/conversão real via Drive API avançada, sem gravar segredo no GitHub.

## 1. Configurar Gemini com segurança

No Apps Script, crie temporariamente uma função local:

```javascript
function configurarGeminiWMGJ() {
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', 'COLE_SUA_CHAVE_AQUI');
  PropertiesService.getScriptProperties().setProperty('GEMINI_MODEL', 'gemini-1.5-flash');
}
```

Depois:

1. Substitua `COLE_SUA_CHAVE_AQUI` pela chave real.
2. Salve o projeto.
3. Selecione `configurarGeminiWMGJ` no seletor de funções.
4. Clique em Executar.
5. Autorize as permissões.
6. Execute `diagnosticarGeminiWMGJ_V1`.
7. Apague a função temporária ou remova a chave do código.

A chave deve ficar apenas em Script Properties.

## 2. Alternativa mais segura

Configurar pelo painel do Apps Script:

1. Apps Script > Configurações do projeto.
2. Propriedades do script.
3. Adicionar propriedade:
   - Nome: `GEMINI_API_KEY`
   - Valor: chave real
4. Adicionar propriedade:
   - Nome: `GEMINI_MODEL`
   - Valor: `gemini-1.5-flash`
5. Salvar.

## 3. Habilitar OCR real

A extração de PDF/imagem/Office depende da Drive API avançada.

No Apps Script:

1. Abra o projeto.
2. Clique em Serviços.
3. Adicione `Drive API`.
4. Se houver escolha de versão, use `v2` para esta implementação.
5. Salve.

Motivo: a função atual usa `Drive.Files.copy(..., {ocr: true, ocrLanguage: 'pt'})`, que é o padrão compatível com OCR/conversão da Drive API v2.

No Google Cloud do projeto:

1. Abra o projeto Cloud vinculado ao Apps Script.
2. APIs e serviços > Biblioteca.
3. Pesquise `Google Drive API`.
4. Ative a API.

## 4. Testes

Rode nesta ordem:

```javascript
diagnosticarGeminiWMGJ_V1()
diagnosticarExtracaoRealWMGJ_V1()
testeGeminiClassificadorWMGJ_V1()
```

Depois coloque um PDF ou imagem em:

```text
99_ARQUIVO_BRUTO_A_CLASSIFICAR
```

E execute:

```javascript
executarExtracaoRealWMGJ_V1(5)
```

## Resultado esperado

- `diagnosticarGeminiWMGJ_V1`: `configurado: true`
- `diagnosticarExtracaoRealWMGJ_V1`: `driveApiAvancadoDisponivel: true`
- Aba `16_EXTRACOES_DOCUMENTAIS` recebe extração.
- Aba `14_MEMORIA_BASE_DOCUMENTOS` recebe documento processado ou revisão humana.

## Segurança

Nunca commitar a chave Gemini. Nunca deixar chave real escrita em arquivo `.gs`. Use Script Properties.