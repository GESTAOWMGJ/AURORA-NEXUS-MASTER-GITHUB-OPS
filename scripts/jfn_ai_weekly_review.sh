#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
report="${TMPDIR:-/tmp}/jfn-ai-ops-$(date +%F).md"

for command in git gh python3; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERRO: comando obrigatório ausente: $command" >&2
    exit 3
  fi
done

cd "$repo_root"

gh auth status

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERRO: há mudanças locais. Preserve-as em branch/commit antes da revisão semanal." >&2
  git status --short --branch
  exit 4
fi

git fetch origin --prune
git switch main
git pull --ff-only

python3 scripts/weekly_ai_ops_audit.py \
  --repo . \
  --output "$report" \
  --days 7

printf '\nRelatório local: %s\n\n' "$report"
printf 'Issues semanais recentes:\n'
gh issue list --state all --limit 10 --search 'Revisão semanal IA in:title'

cat <<'NEXT'

Próximo passo no Codex:
  1. abra o Codex nesta pasta;
  2. execute /new revisao-ia-AAAA-MM-DD;
  3. selecione $jfn-ai-ops-weekly;
  4. informe o caminho do relatório mostrado acima;
  5. limite o trabalho a três prioridades e finalize em PR draft.
NEXT
