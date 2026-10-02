#!/bin/bash
set -euo pipefail

# Safe by default: planning never writes, contacts HML, or restarts an agent.
MODE="--dry-run"
CONFIRM_HOST=""
if [ "$#" -gt 0 ]; then MODE="$1"; shift; fi
if [ "$#" -eq 2 ] && [ "$1" = "--confirm-host" ]; then
  CONFIRM_HOST="$2"
  shift 2
fi
if [ "$#" -ne 0 ]; then echo "ERRO_ARGUMENTOS" >&2; exit 2; fi
case "$MODE" in
  --dry-run|--apply) ;;
  --help)
    echo 'Uso: bash INSTALL_AURORA_TRIGGERCMD_BASE.sh [--dry-run | --apply --confirm-host HOST]'
    exit 0 ;;
  *) echo "ERRO_MODO_INVALIDO" >&2; exit 2 ;;
esac

HOME_DIR="$HOME"
NODE="$HOME_DIR/Applications/node16/bin/node"
NODE_BIN="$HOME_DIR/Applications/node16/bin"
RUNTIME="$HOME_DIR/Applications/TRIGGERcmd-runtime/node_modules"
AGENT_SRC="$HOME_DIR/Applications/TRIGGERcmd-headless/src"
DATA="$HOME_DIR/.TRIGGERcmdData"
SUPPORT="$HOME_DIR/Library/Application Support/AuroraNexus-iMac"
MIRROR="$SUPPORT/repo"
LOG_DIR="$HOME_DIR/Library/Logs"
PLIST_DIR="$HOME_DIR/Library/LaunchAgents"
PLIST="$PLIST_DIR/com.jfn.triggercmd.imac.plist"
LABEL="com.jfn.triggercmd.imac"

if [ "$MODE" = "--dry-run" ]; then
  echo "AURORA_IMAC_PLAN_ONLY"
  echo "planned=validate,stage,backup,install,launchagent,verify"
  echo "writes=NO network=NO restart=NO mirror_sync=NO app_update=NO"
  echo "Prerequisitos e compatibilidade nativa ainda exigem validacao no iMac autorizado."
  exit 0
fi

fail() { echo "$1" >&2; exit 3; }
[ "$(uname -s)" = "Darwin" ] || fail "ERRO_MACOS_OBRIGATORIO"
[ -n "$CONFIRM_HOST" ] && [ "$CONFIRM_HOST" = "$(hostname)" ] || fail "ERRO_CONFIRMACAO_HOST"
case "$(/usr/sbin/sysctl -n hw.model)" in iMac*) ;; *) fail "ERRO_IMAC_OBRIGATORIO" ;; esac
case "$HOME_DIR" in /*) ;; *) fail "ERRO_HOME_INVALIDO" ;; esac
[ "$HOME_DIR" != / ] && [ -d "$HOME_DIR" ] || fail "ERRO_HOME_INVALIDO"
umask 077

# Refuse symlinked ancestors and targets before any write.
check_path() {
  local candidate="$1"
  while [ "$candidate" != / ]; do
    [ ! -L "$candidate" ] || fail "ERRO_SYMLINK_NO_DESTINO"
    candidate="$(dirname "$candidate")"
  done
}
for candidate in "$DATA" "$SUPPORT" "$LOG_DIR" "$PLIST_DIR"; do
  check_path "$candidate"
  [ ! -e "$candidate" ] || [ -d "$candidate" ] || fail "ERRO_DIRETORIO_INVALIDO"
done

FILES=(jfn_status_mac.sh aurora_nexus_status.sh aurora_nexus_sincronizar.sh restart_triggercmd_headless.sh commands.json)
TARGETS=()
for name in "${FILES[@]}"; do TARGETS+=("$DATA/$name"); done
TARGETS+=("$PLIST")
for candidate in "${TARGETS[@]}" "$LOG_DIR/TRIGGERcmd-iMac.log" "$LOG_DIR/TRIGGERcmd-iMac-error.log"; do
  check_path "$candidate"
  [ ! -e "$candidate" ] || [ -f "$candidate" ] || fail "ERRO_ARQUIVO_INVALIDO"
done

for required in "$NODE" "$AGENT_SRC/agent.js" "$DATA/token.tkn" "$DATA/computerid.cfg"; do
  if [ ! -e "$required" ]; then
    echo "ERRO_REQUISITO_AUSENTE=$required" >&2
    exit 3
  fi
done

[ -x "$NODE" ] || fail "ERRO_NODE_NAO_EXECUTAVEL"

if [ ! -s "$DATA/computerid.cfg" ]; then
  echo "ERRO_COMPUTER_ID_VAZIO" >&2
  exit 4
fi

# Do not kill a process that is not owned by this LaunchAgent.
WAS_LOADED=0
if /bin/launchctl list "$LABEL" >/dev/null 2>&1; then WAS_LOADED=1; fi
if [ "$WAS_LOADED" -eq 1 ]; then
  [ -f "$PLIST" ] || fail "ERRO_PLIST_ORIGINAL_AUSENTE"
elif pgrep -f "$AGENT_SRC/agent.js --console" >/dev/null 2>&1; then
  fail "ERRO_AGENTE_NAO_GERENCIADO_REQUER_REVISAO"
fi

mkdir -p "$DATA" "$SUPPORT" "$LOG_DIR" "$PLIST_DIR"
LOCK="$SUPPORT/.bootstrap.lock"
mkdir "$LOCK" 2>/dev/null || fail "ERRO_BOOTSTRAP_EM_EXECUCAO_OU_LOCK_PENDENTE"
STAGE=""
BACKUP=""
MUTATED=0
SERVICE_TOUCHED=0
cleanup() {
  local result="$?" index=0 target
  trap - EXIT
  if [ "$result" -ne 0 ] && [ "$MUTATED" -eq 1 ]; then
    set +e
    local restore_ok=1
    if [ "$SERVICE_TOUCHED" -eq 1 ]; then /bin/launchctl unload "$PLIST" >/dev/null 2>&1; fi
    for target in "${TARGETS[@]}"; do
      if [ ! -f "$BACKUP/$index.published" ]; then
        index=$((index + 1))
        continue
      elif [ -f "$BACKUP/$index.original" ]; then
        if cp -p "$BACKUP/$index.original" "$STAGE/rollback.$index"; then
          mv -f "$STAGE/rollback.$index" "$target" || restore_ok=0
        else
          restore_ok=0
        fi
      elif [ -f "$BACKUP/$index.absent" ] && [ -e "$target" ]; then
        mv "$target" "$BACKUP/$index.failed" || restore_ok=0
      fi
      index=$((index + 1))
    done
    if [ "$SERVICE_TOUCHED" -eq 1 ] && [ "$WAS_LOADED" -eq 1 ]; then
      /bin/launchctl load "$PLIST" >/dev/null 2>&1 || restore_ok=0
    fi
    echo "ROLLBACK_FILES_OK=$restore_ok NATIVE_REVALIDATION_REQUIRED=YES" >&2
  fi
  rmdir "$LOCK" 2>/dev/null || true
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
STAGE="$(mktemp -d "$SUPPORT/stage.XXXXXX")"

cat > "$STAGE/jfn_status_mac.sh" <<'EOF'
#!/bin/bash
HOST="$(hostname)"
OS="$(sw_vers -productVersion)"
ARCH="$(uname -m)"
DISK="$(df -h / | awk 'NR==2 {print $5}')"
if pgrep -f 'TRIGGERcmd-headless/src/agent.js --console' >/dev/null 2>&1; then
  AGENT="PROCESS_PRESENT"
else
  AGENT="PROCESS_ABSENT"
fi
MSG="JFN_MAC host=$HOST macOS=$OS arch=$ARCH disco=$DISK triggercmd=$AGENT"
echo "$MSG"
if [ -n "${TCMD_COMPUTER_ID:-}" ]; then
  sh "$HOME/.TRIGGERcmdData/sendresult.sh" "$MSG" >/dev/null 2>&1 || true
fi
EOF

cat > "$STAGE/aurora_nexus_status.sh" <<'EOF'
#!/bin/bash
URL="https://wmgj-hml-jfn-20260927.web.app/"
REPO="$HOME/Library/Application Support/AuroraNexus-iMac/repo"
HTTP="$(curl --tlsv1.2 --proto '=https' -sS -o /dev/null -w '%{http_code}' --max-time 12 "$URL" 2>/dev/null)" || HTTP="000"
if [ -d "$REPO/.git" ]; then
  SHA="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo INDEFINIDO)"
else
  SHA="NAO_SINCRONIZADO"
fi
if [ -d "/Applications/AURORA NEXUS.app" ] || [ -d "$HOME/Applications/AURORA NEXUS.app" ] || [ -d "$HOME/Library/Application Support/AuroraNexus" ]; then
  APP="PRESENTE"
else
  APP="NAO_LOCALIZADO"
fi
MSG="AURORA_STATUS hml_http=$HTTP mirror_sha=$SHA app_local=$APP login=NAO_TESTADO execucao_app=NAO_TESTADA"
echo "$MSG"
if [ -n "${TCMD_COMPUTER_ID:-}" ]; then
  sh "$HOME/.TRIGGERcmdData/sendresult.sh" "$MSG" >/dev/null 2>&1 || true
fi
EOF

cat > "$STAGE/aurora_nexus_sincronizar.sh" <<'EOF'
#!/bin/bash
set -euo pipefail
BASE="$HOME/Library/Application Support/AuroraNexus-iMac"
REPO="$BASE/repo"
REMOTE="https://github.com/GESTAOWMGJ/automacao-gestao-wmgj.git"
fail() { echo "$1" >&2; exit 3; }
candidate="$REPO"
while [ "$candidate" != / ]; do
  [ ! -L "$candidate" ] || fail "ERRO_MIRROR_SYMLINK"
  candidate="$(dirname "$candidate")"
done
mkdir -p "$BASE"
LOCK="$BASE/.mirror.lock"
mkdir "$LOCK" 2>/dev/null || fail "ERRO_MIRROR_LOCK"
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -e "$REPO" ]; then
  [ -d "$REPO/.git" ] && [ ! -L "$REPO/.git" ] || fail "ERRO_MIRROR_NAO_REPOSITORIO"
  [ "$(git -C "$REPO" rev-parse --show-toplevel)" = "$REPO" ] || fail "ERRO_MIRROR_RAIZ"
  [ "$(git -C "$REPO" remote get-url origin)" = "$REMOTE" ] || fail "ERRO_MIRROR_ORIGIN"
  [ "$(git -C "$REPO" symbolic-ref --short HEAD)" = main ] || fail "ERRO_MIRROR_BRANCH"
  [ -z "$(git -C "$REPO" status --porcelain --untracked-files=all --ignored)" ] || fail "ERRO_MIRROR_ALTERACOES_LOCAIS"
  git -C "$REPO" -c core.hooksPath=/dev/null fetch origin refs/heads/main:refs/remotes/origin/main
  git -C "$REPO" merge-base --is-ancestor HEAD refs/remotes/origin/main || fail "ERRO_MIRROR_DIVERGENTE_OU_HISTORICO_RASO"
  # Check again after the fetch. Never discard files or local commits.
  [ -z "$(git -C "$REPO" status --porcelain --untracked-files=all --ignored)" ] || fail "ERRO_MIRROR_ALTERACOES_LOCAIS"
  git -C "$REPO" -c core.hooksPath=/dev/null merge --ff-only refs/remotes/origin/main
else
  git -c core.hooksPath=/dev/null clone --single-branch --branch main "$REMOTE" "$REPO"
fi
SHA="$(git -C "$REPO" rev-parse --short HEAD)"
MSG="AURORA_MIRROR_SINCRONIZADO main=$SHA app_update=NAO deploy=NAO_EXECUTADO firebase_write=NAO"
echo "$MSG"
if [ -n "${TCMD_COMPUTER_ID:-}" ]; then
  sh "$HOME/.TRIGGERcmdData/sendresult.sh" "$MSG" >/dev/null 2>&1 || true
fi
EOF

cat > "$STAGE/restart_triggercmd_headless.sh" <<'EOF'
#!/bin/bash
PLIST="$HOME/Library/LaunchAgents/com.jfn.triggercmd.imac.plist"
(
  sleep 1
  /bin/launchctl unload "$PLIST" >/dev/null 2>&1 || true
  /bin/launchctl load "$PLIST"
) >/dev/null 2>&1 &
echo "TRIGGERCMD_RESTART_SCHEDULED"
EOF

if [ -f "$DATA/commands.json" ]; then
  cp -p "$DATA/commands.json" "$STAGE/commands.input"
  cp -p "$DATA/commands.json" "$STAGE/commands.json"
else
  printf '[]\n' > "$STAGE/commands.json"
fi

"$NODE" - "$STAGE/commands.json" <<'NODE'
const fs = require("fs");
try {
const p = process.argv[2];
const raw = fs.readFileSync(p, "utf8");
const existing = JSON.parse(raw);
if (!Array.isArray(existing)) throw new Error("commands.json precisa ser array");
const incoming = [
  {
    trigger: "JFN Status Mac",
    command: "\"$HOME/.TRIGGERcmdData/jfn_status_mac.sh\"",
    ground: "foreground",
    voice: "j f n status mac",
    voiceReply: "Verificação solicitada; confira o retorno do Mac",
    allowParams: false,
    mcpToolDescription: "Retorna status operacional do iMac JFN.",
    icon: ""
  },
  {
    trigger: "AURORA NEXUS Status",
    command: "\"$HOME/.TRIGGERcmdData/aurora_nexus_status.sh\"",
    ground: "foreground",
    voice: "aurora nexus status",
    voiceReply: "Verificação solicitada; confira o retorno do Aurora Nexus",
    allowParams: false,
    mcpToolDescription: "Verifica disponibilidade HML e estado local do AURORA NEXUS no iMac.",
    icon: ""
  },
  {
    trigger: "AURORA NEXUS Sincronizar",
    command: "\"$HOME/.TRIGGERcmdData/aurora_nexus_sincronizar.sh\"",
    ground: "foreground",
    voice: "aurora nexus sincronizar",
    voiceReply: "Sincronização do espelho solicitada; aguarde o resultado",
    allowParams: false,
    mcpToolDescription: "Sincroniza somente a cópia local da main do AURORA NEXUS, sem deploy e sem escrita no Firebase.",
    icon: ""
  },
  {
    trigger: "JFN Reiniciar Agente",
    command: "\"$HOME/.TRIGGERcmdData/restart_triggercmd_headless.sh\"",
    ground: "foreground",
    voice: "j f n reiniciar agente",
    voiceReply: "Reinício solicitado; confira o retorno do agente",
    allowParams: false,
    mcpToolDescription: "Reinicia o agente headless TRIGGERcmd do iMac via LaunchAgent.",
    icon: ""
  }
];
const names = new Set(incoming.map(x => x.trigger));
const merged = existing.filter(x => !x || !names.has(x.trigger)).concat(incoming);
const tmp = p + ".aurora.new";
fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n");
JSON.parse(fs.readFileSync(tmp, "utf8"));
fs.renameSync(tmp, p);
console.log("COMMANDS_OK=" + merged.length);
} catch (_) {
  console.error("ERRO_COMMANDS_JSON_INVALIDO_OU_ESCRITA");
  process.exit(3);
}
NODE

chmod 600 "$STAGE/commands.json"

# Escape values interpolated in XML; unusual account paths must remain data.
xml_escape() {
  local value="$1"
  value="${value//&/\&amp;}"
  value="${value//</\&lt;}"
  value="${value//>/\&gt;}"
  value="${value//\"/\&quot;}"
  value="${value//\'/\&apos;}"
  printf '%s' "$value"
}
NODE_XML="$(xml_escape "$NODE")"
AGENT_XML="$(xml_escape "$AGENT_SRC/agent.js")"
RUNTIME_XML="$(xml_escape "$RUNTIME")"
PATH_XML="$(xml_escape "$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin")"
LOG_XML="$(xml_escape "$LOG_DIR")"

cat > "$STAGE/agent.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.jfn.triggercmd.imac</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_XML</string>
    <string>$AGENT_XML</string>
    <string>--console</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_PATH</key>
    <string>$RUNTIME_XML</string>
    <key>PATH</key>
    <string>$PATH_XML</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_XML/TRIGGERcmd-iMac.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_XML/TRIGGERcmd-iMac-error.log</string>
</dict>
</plist>
EOF

chmod 600 "$STAGE/agent.plist"
for name in "${FILES[@]}"; do
  if [ "$name" != commands.json ]; then
    chmod 700 "$STAGE/$name"
    /bin/bash -n "$STAGE/$name"
  fi
done
/usr/bin/plutil -lint "$STAGE/agent.plist"

# Do not replace a commands file edited while the candidate was generated.
if [ -f "$STAGE/commands.input" ]; then
  cmp -s "$STAGE/commands.input" "$DATA/commands.json" || fail "ERRO_COMMANDS_ALTERADO_DURANTE_PREPARO"
else
  [ ! -e "$DATA/commands.json" ] || fail "ERRO_COMMANDS_ALTERADO_DURANTE_PREPARO"
fi

# Back up every overwritten target, not credentials or unrelated files.
BACKUP="$(mktemp -d "$SUPPORT/backup.XXXXXX")"
index=0
for target in "${TARGETS[@]}"; do
  if [ -f "$target" ]; then
    cp -p "$target" "$BACKUP/$index.original"
    cmp -s "$target" "$BACKUP/$index.original" || fail "ERRO_BACKUP"
  else
    : > "$BACKUP/$index.absent"
  fi
  index=$((index + 1))
done
printf '%s\n' "$WAS_LOADED" > "$BACKUP/was-loaded"
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$BACKUP/prepared-at"
echo "BACKUP=$BACKUP"

MUTATED=1
if [ "$WAS_LOADED" -eq 1 ]; then
  SERVICE_TOUCHED=1
  /bin/launchctl unload "$PLIST"
fi
# Revalidate the snapshot after stopping the managed writer. On conflict, only
# restore service state; untouched files must not be replaced by the backup.
index=0
for target in "${TARGETS[@]}"; do
  check_path "$target"
  if [ -f "$BACKUP/$index.original" ]; then
    cmp -s "$BACKUP/$index.original" "$target" || fail "ERRO_DESTINO_ALTERADO"
  else
    [ ! -e "$target" ] || fail "ERRO_DESTINO_ALTERADO"
  fi
  index=$((index + 1))
done
index=0
for name in "${FILES[@]}"; do
  : > "$BACKUP/$index.published"
  cp -p "$STAGE/$name" "$STAGE/install.$index"
  mv -f "$STAGE/install.$index" "$DATA/$name"
  index=$((index + 1))
done
: > "$BACKUP/5.published"
cp -p "$STAGE/agent.plist" "$STAGE/install.5"
mv -f "$STAGE/install.5" "$PLIST"
SERVICE_TOUCHED=1
/bin/launchctl load "$PLIST"
sleep 4

if ! pgrep -f "$AGENT_SRC/agent.js --console" >/dev/null 2>&1; then
  echo "ERRO_AGENT_NAO_SUBIU" >&2
  echo "Consulte o log local com sanitizacao; nenhum trecho sera impresso automaticamente." >&2
  exit 5
fi

echo "AURORA_IMAC_FILES_INSTALLED AGENT_PROCESS_PRESENT"
echo "REMOTE_CONNECTIVITY=UNKNOWN APP_INSTALLATION=NOT_PERFORMED HML_AUTH=NOT_TESTED"
echo "PLIST=$PLIST"
echo "COMMANDS=$DATA/commands.json"
echo "MIRROR=$MIRROR"
