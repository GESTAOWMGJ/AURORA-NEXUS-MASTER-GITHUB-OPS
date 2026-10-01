# Configuração de Segurança da API WMGJ

## Objetivo

Proteger comandos mutáveis do Web App Apps Script.

Comandos como `run`, `gmail`, `organizar`, `dashboard`, `conciliar` e equivalentes não devem ser executados sem token configurado em `ScriptProperties`.

## Comandos liberados sem token

Apenas comandos leves:

```json
{ "comando": "status" }
```

```json
{ "comando": "teste_execucao" }
```

## Comandos que exigem token

```text
run
runWMGJ
operacao_total
gmail
gmail_bancario
organizar
dashboard
conciliar
```

## Onde configurar o token

No Google Apps Script:

```text
Project Settings
→ Script Properties
→ Add script property
```

Adicionar:

```text
Name: WMGJ_API_TOKEN
Value: token longo, secreto e aleatório
```

## Regra crítica

Nunca colocar o token dentro de arquivos `.gs`, `.json`, `.yml`, README, comentários ou exemplos reais.

Código versionado não é cofre. É vitrine com histórico permanente, porque aparentemente a internet precisava ser assim.

## Exemplo de chamada segura

```json
{
  "comando": "run",
  "token": "TOKEN_CONFIGURADO_EM_SCRIPT_PROPERTIES"
}
```

## Comportamento esperado sem token

A API deve retornar:

```json
{
  "ok": false,
  "erro": "Comando operacional bloqueado por segurança",
  "codigo": "API_TOKEN_AUSENTE_OU_INVALIDO"
}
```

## Auditoria automática

A função abaixo valida a barreira de segurança:

```text
auditarSegurancaApiWMGJ
```

Ela deve confirmar que:

1. `status` funciona sem token;
2. `run` sem token é bloqueado.

O workflow GitHub Actions executa essa validação após o `clasp push`.

## Rotação do token

Recomenda-se trocar o token quando:

- houver suspeita de vazamento;
- alguém deixar o projeto;
- o Web App for exposto para integração externa;
- o projeto evoluir para app comercial;
- houver migração para outro ambiente.

## Futuro

Na evolução para produto hospitalar ou app comercial, este token deve ser substituído por autenticação mais robusta:

- OAuth;
- contas por perfil;
- expiração de sessão;
- permissões por ação;
- trilha de auditoria por usuário;
- backend intermediário.

O token atual é barreira mínima operacional, não arquitetura final de segurança.
