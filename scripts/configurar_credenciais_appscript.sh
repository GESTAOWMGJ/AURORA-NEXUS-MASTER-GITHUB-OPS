#!/usr/bin/env bash
set -euo pipefail

REPO="GESTAOWMGJ/automacao-gestao-wmgj"

printf "\nWMGJ - Configurador seguro de credenciais Apps Script\n"
printf "Repositório: %s\n\n" "$REPO"

command -v gh >/dev/null 2>&1 || {
  echo "ERRO: GitHub CLI 'gh' não encontrado. Instale em: https://cli.github.com/"
  exit 1
}

command -v clasp >/dev/null 2>&1 || {
  echo "ERRO: clasp não encontrado. Instale com: npm install -g @google/clasp"
  exit 1
}

if [ ! -f "$HOME/.clasprc.json" ]; then
  echo "Arquivo ~/.clasprc.json não encontrado. Executando clasp login..."
  clasp login
fi

if [ ! -f "$HOME/.clasprc.json" ]; then
  echo "ERRO: ~/.clasprc.json ainda não existe após clasp login."
  exit 1
fi

read -r -p "Cole o APPS_SCRIPT_ID do projeto Apps Script: " APPS_SCRIPT_ID

if [ -z "${APPS_SCRIPT_ID}" ]; then
  echo "ERRO: APPS_SCRIPT_ID vazio."
  exit 1
fi

echo "Validando autenticação GitHub..."
gh auth status >/dev/null || gh auth login

echo "Gravando secret APPS_SCRIPT_ID no GitHub..."
printf "%s" "$APPS_SCRIPT_ID" | gh secret set APPS_SCRIPT_ID --repo "$REPO"

echo "Gravando secret CLASPRC_JSON no GitHub..."
gh secret set CLASPRC_JSON --repo "$REPO" < "$HOME/.clasprc.json"

echo "Listando secrets configurados..."
gh secret list --repo "$REPO"

echo "\nCredenciais configuradas. O próximo push na main acionará o deploy automático do Apps Script."
