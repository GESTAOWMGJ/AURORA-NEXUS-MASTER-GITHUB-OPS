#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  echo "ERRO: execute este instalador dentro do repositório automacao-gestao-wmgj." >&2
  exit 2
fi

source_skill="$repo_root/.agents/skills/jfn-ai-ops-weekly"
target_root="$HOME/.agents/skills"
target_skill="$target_root/jfn-ai-ops-weekly"
command_dir="$HOME/bin"
command_path="$command_dir/jfn-ai-weekly-review"

for command in git gh python3; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERRO: comando obrigatório ausente: $command" >&2
    exit 3
  fi
done

if [[ ! -f "$source_skill/SKILL.md" ]]; then
  echo "ERRO: habilidade não encontrada em $source_skill" >&2
  exit 4
fi

printf 'Validando autenticação GitHub...\n'
gh auth status

mkdir -p "$target_root" "$command_dir"

if [[ -e "$target_skill" && ! -L "$target_skill" ]]; then
  backup="$target_skill.backup.$(date +%Y%m%d%H%M%S)"
  mv "$target_skill" "$backup"
  echo "Habilidade anterior preservada em: $backup"
fi

ln -sfn "$source_skill" "$target_skill"
ln -sfn "$repo_root/scripts/jfn_ai_weekly_review.sh" "$command_path"
chmod +x "$repo_root/scripts/jfn_ai_weekly_review.sh" "$repo_root/scripts/weekly_ai_ops_audit.py"

cat <<OUT
Instalação concluída.

Habilidade global:
  $target_skill

Comando semanal:
  $command_path

Inclua ~/bin no PATH, caso ainda não esteja:
  export PATH="$HOME/bin:$PATH"

Depois, reinicie o Codex para recarregar habilidades e use:
  \$jfn-ai-ops-weekly
OUT
