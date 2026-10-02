#!/bin/bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERRO: este bootstrap exige macOS." >&2
  exit 2
fi

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
HML_URL="https://wmgj-hml-jfn-20260927.web.app/"
REPO_URL="https://github.com/GESTAOWMGJ/automacao-gestao-wmgj.git"

for required in "$NODE" "$AGENT_SRC/agent.js" "$DATA/token.tkn" "$DATA/computerid.cfg"; do
  if [ ! -e "$required" ]; then
    echo "ERRO_REQUISITO_AUSENTE=$required" >&2
    exit 3
  fi
done

if [ ! -s "$DATA/computerid.cfg" ]; then
  echo "ERRO_COMPUTER_ID_VAZIO" >&2
  exit 4
fi

mkdir -p "$DATA" "$SUPPORT" "$LOG_DIR" "$PLIST_DIR"

cat > "$DATA/jfn_status_mac.sh" <<'EOF'
#!/bin/bash
HOST="$(hostname)"
OS="$(sw_vers -productVersion)"
ARCH="$(uname -m)"
DISK="$(df -h / | awk 'NR==2 {print $5}')"
if pgrep -f 'TRIGGERcmd-headless/src/agent.js --console' >/dev/null 2>&1; then
  AGENT="ONLINE"
else
  AGENT="OFFLINE"
fi
MSG="JFN_MAC host=$HOST macOS=$OS arch=$ARCH disco=$DISK triggercmd=$AGENT"
echo "$MSG"
if [ -n "${TCMD_COMPUTER_ID:-}" ]; then
  sh "$HOME/.TRIGGERcmdData/sendresult.sh" "$MSG" >/dev/null 2>&1 || true
fi
EOF

cat > "$DATA/aurora_nexus_status.sh" <<'EOF'
#!/bin/bash
URL="https://wmgj-hml-jfn-20260927.web.app/"
REPO="$HOME/Library/Application Support/AuroraNexus-iMac/repo"
HTTP="$(curl -L -sS -o /dev/null -w '%{http_code}' --max-time 12 "$URL" 2>/dev/null || echo 000)"
if [ -d "$REPO/.git" ]; then
  SHA="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo INDEFINIDO)"
else
  SHA="NAO_SINCRONIZADO"
fi
if [ -d "/Applications/AURORA NEXUS.app" ] || [ -d "$HOME/Applications/AURORA NEXUS.app" ] || [ -d "$HOME/Library/Application Support/AuroraNexus" ]; then
  APP="PRESENTE"
else
  APP="NAO_INSTALADO"
fi
MSG="AURORA_STATUS hml_http=$HTTP mirror_sha=$SHA app_local=$APP"
echo "$MSG"
if [ -n "${TCMD_COMPUTER_ID:-}" ]; then
  sh "$HOME/.TRIGGERcmdData/sendresult.sh" "$MSG" >/dev/null 2>&1 || true
fi
EOF

cat > "$DATA/aurora_nexus_sincronizar.sh" <<'EOF'
#!/bin/bash
set -e
BASE="$HOME/Library/Application Support/AuroraNexus-iMac"
REPO="$BASE/repo"
REMOTE="https://github.com/GESTAOWMGJ/automacao-gestao-wmgj.git"
mkdir -p "$BASE"
if [ -d "$REPO/.git" ]; then
  git -C "$REPO" fetch --depth 1 origin main
  git -C "$REPO" reset --hard origin/main
else
  rm -rf "$REPO"
  git clone --depth 1 --branch main "$REMOTE" "$REPO"
fi
SHA="$(git -C "$REPO" rev-parse --short HEAD)"
MSG="AURORA_SINCRONIZADO main=$SHA deploy=NAO_EXECUTADO firebase_write=NAO"
echo "$MSG"
if [ -n "${TCMD_COMPUTER_ID:-}" ]; then
  sh "$HOME/.TRIGGERcmdData/sendresult.sh" "$MSG" >/dev/null 2>&1 || true
fi
EOF

cat > "$DATA/restart_triggercmd_headless.sh" <<EOF
#!/bin/bash
PLIST="$PLIST"
(
  sleep 1
  /bin/launchctl unload "\$PLIST" >/dev/null 2>&1 || true
  /bin/launchctl load "\$PLIST"
) >/dev/null 2>&1 &
echo "TRIGGERCMD_RESTART_SCHEDULED"
EOF

chmod 700   "$DATA/jfn_status_mac.sh"   "$DATA/aurora_nexus_status.sh"   "$DATA/aurora_nexus_sincronizar.sh"   "$DATA/restart_triggercmd_headless.sh"

if [ -f "$DATA/commands.json" ]; then
  cp -p "$DATA/commands.json" "$DATA/commands.json.bak-aurora-$(date '+%Y%m%d-%H%M%S')"
else
  printf '[]\n' > "$DATA/commands.json"
fi

"$NODE" <<'NODE'
const fs = require("fs");
const p = process.env.HOME + "/.TRIGGERcmdData/commands.json";
const raw = fs.readFileSync(p, "utf8");
const existing = JSON.parse(raw);
if (!Array.isArray(existing)) throw new Error("commands.json precisa ser array");
const incoming = [
  {
    trigger: "JFN Status Mac",
    command: "\"$HOME/.TRIGGERcmdData/jfn_status_mac.sh\"",
    ground: "foreground",
    voice: "j f n status mac",
    voiceReply: "Status do Mac concluído",
    allowParams: false,
    mcpToolDescription: "Retorna status operacional do iMac JFN.",
    icon: ""
  },
  {
    trigger: "AURORA NEXUS Status",
    command: "\"$HOME/.TRIGGERcmdData/aurora_nexus_status.sh\"",
    ground: "foreground",
    voice: "aurora nexus status",
    voiceReply: "Status do Aurora Nexus concluído",
    allowParams: false,
    mcpToolDescription: "Verifica disponibilidade HML e estado local do AURORA NEXUS no iMac.",
    icon: ""
  },
  {
    trigger: "AURORA NEXUS Sincronizar",
    command: "\"$HOME/.TRIGGERcmdData/aurora_nexus_sincronizar.sh\"",
    ground: "foreground",
    voice: "aurora nexus sincronizar",
    voiceReply: "Sincronização do Aurora Nexus concluída",
    allowParams: false,
    mcpToolDescription: "Sincroniza somente a cópia local da main do AURORA NEXUS, sem deploy e sem escrita no Firebase.",
    icon: ""
  },
  {
    trigger: "JFN Reiniciar Agente",
    command: "\"$HOME/.TRIGGERcmdData/restart_triggercmd_headless.sh\"",
    ground: "foreground",
    voice: "j f n reiniciar agente",
    voiceReply: "Reinício do agente agendado",
    allowParams: false,
    mcpToolDescription: "Reinicia o agente headless TRIGGERcmd do iMac via LaunchAgent.",
    icon: ""
  }
];
const names = new Set(incoming.map(x => x.trigger));
const merged = existing.filter(x => x && !names.has(x.trigger)).concat(incoming);
const tmp = p + ".aurora.new";
fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n");
JSON.parse(fs.readFileSync(tmp, "utf8"));
fs.renameSync(tmp, p);
console.log("COMMANDS_OK=" + merged.length);
NODE

chmod 600 "$DATA/commands.json"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.jfn.triggercmd.imac</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$AGENT_SRC/agent.js</string>
    <string>--console</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_PATH</key>
    <string>$RUNTIME</string>
    <key>PATH</key>
    <string>$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/TRIGGERcmd-iMac.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/TRIGGERcmd-iMac-error.log</string>
</dict>
</plist>
EOF

chmod 600 "$PLIST"
/usr/bin/plutil -lint "$PLIST"

# Remove only stale zero-byte transactional leftovers.
if [ -f "$DATA/commands.json.backup.newagt" ] && [ ! -s "$DATA/commands.json.backup.newagt" ]; then
  rm -f "$DATA/commands.json.backup.newagt"
fi

/bin/launchctl unload "$PLIST" >/dev/null 2>&1 || true
/bin/launchctl load "$PLIST"
sleep 4

if ! pgrep -f "$AGENT_SRC/agent.js --console" >/dev/null 2>&1; then
  echo "ERRO_AGENT_NAO_SUBIU" >&2
  tail -40 "$LOG_DIR/TRIGGERcmd-iMac-error.log" 2>/dev/null || true
  exit 5
fi

"$DATA/jfn_status_mac.sh"
"$DATA/aurora_nexus_status.sh"

echo "AURORA_IMAC_BASE_OK"
echo "PLIST=$PLIST"
echo "COMMANDS=$DATA/commands.json"
echo "MIRROR=$MIRROR"
