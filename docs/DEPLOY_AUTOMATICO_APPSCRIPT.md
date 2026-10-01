# Deploy automático Apps Script WMGJ

## Status

O repositório está configurado para enviar automaticamente os arquivos `.gs` de `src/` para o projeto Google Apps Script usando GitHub Actions + clasp.

## Workflow

Arquivo:

```text
.github/workflows/deploy-appscript.yml
```

Dispara automaticamente quando houver push na branch `main` alterando:

```text
src/**/*.gs
appsscript.json
.github/workflows/deploy-appscript.yml
```

Também pode ser executado manualmente por `workflow_dispatch` no GitHub Actions.

## Arquivos enviados ao Apps Script

O workflow monta uma pasta temporária `build-appscript` contendo:

```text
appsscript.json
src/*.gs
.clasp.json
```

Depois executa:

```bash
clasp push --force
```

## Secrets obrigatórios no GitHub

Para funcionar sem intervenção manual no editor Apps Script, o repositório precisa ter estes secrets configurados:

```text
APPS_SCRIPT_ID
CLASPRC_JSON
```

### APPS_SCRIPT_ID

ID do projeto Apps Script.

Normalmente aparece na URL do editor Apps Script ou no `.clasp.json` de um projeto já vinculado.

### CLASPRC_JSON

Conteúdo completo do arquivo `~/.clasprc.json` gerado pelo login do clasp.

Este segredo contém tokens de autenticação Google. Não deve ser commitado no repositório.

## Resultado esperado

Após cada alteração no GitHub:

```text
GitHub push
↓
GitHub Actions
↓
clasp push --force
↓
Apps Script atualizado
```

## Observação operacional

O código já está pronto para deploy automático. Se o workflow falhar, a causa esperada é ausência ou erro nos secrets `APPS_SCRIPT_ID` e `CLASPRC_JSON`, não falta de estrutura de automação.
