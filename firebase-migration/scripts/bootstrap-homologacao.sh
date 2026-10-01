#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"
FUNCTIONS_DIR="$ROOT_DIR/functions"
TESTS_DIR="$ROOT_DIR/tests"
PROJECT_ID="${WMGJ_FIREBASE_TEST_PROJECT_ID:-wmgj-firestore-rules-test}"
NPM_CACHE_DIR="${WMGJ_NPM_CACHE_DIR:-${TMPDIR:-/tmp}/wmgj-npm-cache}"
XDG_CACHE_DIR="${WMGJ_XDG_CACHE_DIR:-${TMPDIR:-/tmp}/wmgj-xdg-cache}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Dependência ausente: $1" >&2
    exit 1
  fi
}

require_command node
require_command npm
require_command java

JAVA_VERSION="$(java -version 2>&1 | awk -F'"' '/version/ { print $2; exit }')"
JAVA_MAJOR="${JAVA_VERSION%%.*}"
if [[ ! "$JAVA_MAJOR" =~ ^[0-9]+$ ]] || (( JAVA_MAJOR < 21 )); then
  echo "Java 21+ é obrigatório para o Firebase Emulator Suite; encontrado: ${JAVA_VERSION:-desconhecido}" >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/firebase.json" ]]; then
  echo "Configuração Firebase não encontrada: $ROOT_DIR/firebase.json" >&2
  exit 1
fi

if [[ ! -f "$TESTS_DIR/package-lock.json" ]]; then
  echo "Lockfile dos testes ausente: $TESTS_DIR/package-lock.json" >&2
  exit 1
fi

export CI=true
export npm_config_audit=false
export npm_config_fund=false
export XDG_CACHE_HOME="$XDG_CACHE_DIR"
mkdir -p "$NPM_CACHE_DIR" "$XDG_CACHE_HOME"

echo "Instalando dependências reprodutíveis dos testes..."
npm --prefix "$TESTS_DIR" ci --ignore-scripts --cache "$NPM_CACHE_DIR"

if [[ ! -f "$FUNCTIONS_DIR/package-lock.json" ]]; then
  echo "Lockfile das Functions ausente: $FUNCTIONS_DIR/package-lock.json" >&2
  exit 1
fi

echo "Instalando dependências reprodutíveis das Functions..."
npm --prefix "$FUNCTIONS_DIR" ci --ignore-scripts --cache "$NPM_CACHE_DIR"

FIREBASE_BIN="$TESTS_DIR/node_modules/.bin/firebase"
if [[ ! -x "$FIREBASE_BIN" ]]; then
  echo "Firebase CLI local não encontrada após npm ci: $FIREBASE_BIN" >&2
  exit 1
fi

echo "Compilando Functions em modo de validação..."
npm --prefix "$FUNCTIONS_DIR" run build

echo "Executando testes unitários de Functions e Apps Script..."
npm --prefix "$FUNCTIONS_DIR" test

echo "Executando Security Rules somente no Emulator Suite..."
TEST_COMMAND="npm --prefix \"$TESTS_DIR\" test"
"$FIREBASE_BIN" emulators:exec \
  --config "$ROOT_DIR/firebase.json" \
  --project "$PROJECT_ID" \
  --only firestore \
  "$TEST_COMMAND"

echo "Homologação local concluída sem login, segredo, deploy ou escrita em produção."
