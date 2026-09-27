#!/usr/bin/env python3
"""Deterministic, offline weekly audit for the JFN/WMGJ AI operation.

The script intentionally performs no LLM or external API calls. It scans tracked
repository files, validates common syntaxes, detects duplicate Apps Script
functions and high-confidence secret patterns, and writes a compact Markdown
report suitable for a GitHub issue or Actions job summary.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence
from zoneinfo import ZoneInfo

TEXT_EXTENSIONS = {
    ".c", ".cc", ".cfg", ".conf", ".cpp", ".css", ".csv", ".env", ".example",
    ".gjs", ".go", ".gs", ".h", ".hpp", ".html", ".ini", ".java", ".js",
    ".json", ".jsx", ".md", ".mjs", ".py", ".rb", ".rs", ".sh", ".sql",
    ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
}
TEXT_NAMES = {"AGENTS.md", "Dockerfile", "Makefile", "Procfile"}
IGNORED_DIRS = {
    ".git", ".idea", ".next", ".pytest_cache", ".venv", ".vscode", "__pycache__",
    "build", "coverage", "dist", "node_modules", "vendor",
}
MAX_SCAN_BYTES = 2_000_000
LARGE_FILE_LINES = 900
LARGE_FILE_BYTES = 150_000
MAX_FINDINGS_IN_REPORT = 40
MAX_CHANGE_ROWS = 20

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
SEVERITY_LABEL = {
    "critical": "CRÍTICO",
    "high": "ALTO",
    "medium": "MÉDIO",
    "low": "BAIXO",
    "info": "INFO",
}

SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("OpenAI API key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,255}\b")),
    ("GitHub fine-grained token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,255}\b")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
)

FUNCTION_PATTERN = re.compile(
    r"(?m)^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\("
)
TODO_PATTERN = re.compile(r"\b(?:TODO|FIXME|HACK|XXX)\b", re.IGNORECASE)
USES_PATTERN = re.compile(r"(?m)^\s*-?\s*uses:\s*([^\s#]+)")


@dataclass(frozen=True)
class Finding:
    severity: str
    category: str
    message: str
    path: str = ""
    line: int | None = None

    def location(self) -> str:
        if not self.path:
            return "—"
        return f"`{self.path}:{self.line}`" if self.line else f"`{self.path}`"


@dataclass
class FileRecord:
    path: Path
    relative: str
    text: str
    byte_size: int
    line_count: int


def run_command(
    args: Sequence[str],
    *,
    cwd: Path,
    timeout: int = 30,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(args),
        cwd=str(cwd),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )


def is_ignored(relative: Path) -> bool:
    return any(part in IGNORED_DIRS for part in relative.parts)


def is_text_candidate(path: Path) -> bool:
    return path.name in TEXT_NAMES or path.suffix.lower() in TEXT_EXTENSIONS


def tracked_paths(repo: Path) -> tuple[list[Path], bool]:
    git = shutil.which("git")
    if git and (repo / ".git").exists():
        result = subprocess.run(
            [git, "ls-files", "-z"],
            cwd=str(repo),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode == 0:
            paths: list[Path] = []
            for raw in result.stdout.split(b"\0"):
                if not raw:
                    continue
                relative = Path(os.fsdecode(raw))
                if not is_ignored(relative):
                    paths.append(repo / relative)
            return paths, True

    paths = [
        path
        for path in repo.rglob("*")
        if path.is_file() and not is_ignored(path.relative_to(repo))
    ]
    return paths, False


def read_records(repo: Path) -> tuple[list[FileRecord], list[Finding], bool]:
    paths, tracked_only = tracked_paths(repo)
    records: list[FileRecord] = []
    findings: list[Finding] = []

    for path in sorted(paths):
        if not path.exists() or path.is_symlink() or not is_text_candidate(path):
            continue
        relative = path.relative_to(repo).as_posix()
        try:
            byte_size = path.stat().st_size
        except OSError as exc:
            findings.append(Finding("low", "leitura", f"Não foi possível obter tamanho: {exc}", relative))
            continue
        if byte_size > MAX_SCAN_BYTES:
            findings.append(
                Finding(
                    "medium",
                    "contexto",
                    f"Arquivo textual não escaneado por exceder {MAX_SCAN_BYTES:,} bytes.",
                    relative,
                )
            )
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            findings.append(Finding("low", "codificação", "Arquivo não está em UTF-8.", relative))
            continue
        except OSError as exc:
            findings.append(Finding("low", "leitura", f"Falha de leitura: {exc}", relative))
            continue

        line_count = text.count("\n") + (1 if text else 0)
        records.append(FileRecord(path, relative, text, byte_size, line_count))

        if line_count >= LARGE_FILE_LINES or byte_size >= LARGE_FILE_BYTES:
            findings.append(
                Finding(
                    "medium",
                    "contexto",
                    f"Arquivo grande: {line_count:,} linhas e {byte_size:,} bytes; ler por trechos para evitar contexto desnecessário.",
                    relative,
                )
            )

    return records, findings, tracked_only


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def redact_secret(value: str) -> str:
    if len(value) <= 12:
        return "[redigido]"
    return f"{value[:4]}…{value[-4:]}"


def scan_secrets(records: Iterable[FileRecord]) -> list[Finding]:
    findings: list[Finding] = []
    for record in records:
        for label, pattern in SECRET_PATTERNS:
            for match in pattern.finditer(record.text):
                findings.append(
                    Finding(
                        "critical",
                        "segredo",
                        f"Possível {label} versionado ({redact_secret(match.group(0))}). Revogar/rotacionar antes de apenas apagar do histórico.",
                        record.relative,
                        line_number(record.text, match.start()),
                    )
                )
    return findings


def scan_duplicate_functions(records: Iterable[FileRecord]) -> list[Finding]:
    definitions: defaultdict[str, list[tuple[str, int]]] = defaultdict(list)
    for record in records:
        if record.path.suffix.lower() not in {".gs", ".js", ".mjs"}:
            continue
        for match in FUNCTION_PATTERN.finditer(record.text):
            definitions[match.group(1)].append((record.relative, line_number(record.text, match.start())))

    findings: list[Finding] = []
    for name, locations in sorted(definitions.items()):
        unique_locations = {(path, line) for path, line in locations}
        if len(unique_locations) <= 1:
            continue
        rendered = ", ".join(f"{path}:{line}" for path, line in sorted(unique_locations)[:6])
        extra = len(unique_locations) - 6
        if extra > 0:
            rendered += f" e mais {extra}"
        findings.append(
            Finding(
                "high",
                "algoritmo",
                f"Função `{name}` possui {len(unique_locations)} definições: {rendered}. Em Apps Script, a última definição pode sobrescrever as demais.",
            )
        )
    return findings


def scan_exact_duplicates(records: Iterable[FileRecord]) -> list[Finding]:
    by_hash: defaultdict[str, list[FileRecord]] = defaultdict(list)
    for record in records:
        if record.byte_size < 300 or not record.text.strip():
            continue
        digest = hashlib.sha256(record.text.encode("utf-8")).hexdigest()
        by_hash[digest].append(record)

    findings: list[Finding] = []
    for group in by_hash.values():
        if len(group) <= 1:
            continue
        paths = sorted(record.relative for record in group)
        findings.append(
            Finding(
                "medium",
                "duplicidade",
                f"Conteúdo idêntico em {len(paths)} arquivos: " + ", ".join(f"`{path}`" for path in paths[:8]),
            )
        )
    return findings


def validate_json(records: Iterable[FileRecord]) -> list[Finding]:
    findings: list[Finding] = []
    for record in records:
        if record.path.suffix.lower() != ".json":
            continue
        try:
            json.loads(record.text)
        except json.JSONDecodeError as exc:
            findings.append(
                Finding("high", "sintaxe", f"JSON inválido: {exc.msg}", record.relative, exc.lineno)
            )
    return findings


def validate_shell(records: Iterable[FileRecord], repo: Path) -> list[Finding]:
    bash = shutil.which("bash")
    if not bash:
        return [Finding("low", "ferramenta", "`bash` indisponível; scripts shell não foram validados.")]
    findings: list[Finding] = []
    for record in records:
        if record.path.suffix.lower() != ".sh":
            continue
        result = run_command([bash, "-n", str(record.path)], cwd=repo)
        if result.returncode != 0:
            message = (result.stderr or result.stdout).strip().splitlines()
            findings.append(
                Finding(
                    "high",
                    "sintaxe",
                    "Shell inválido: " + (message[-1] if message else f"código {result.returncode}"),
                    record.relative,
                )
            )
    return findings


def validate_javascript(records: Iterable[FileRecord], repo: Path) -> list[Finding]:
    node = shutil.which("node")
    targets = [r for r in records if r.path.suffix.lower() in {".gs", ".js", ".mjs"}]
    if not targets:
        return []
    if not node:
        return [Finding("low", "ferramenta", "`node` indisponível; JavaScript/Apps Script não foi validado.")]

    findings: list[Finding] = []
    for record in targets:
        temp_path: Path | None = None
        target = record.path
        try:
            if record.path.suffix.lower() == ".gs":
                handle = tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False)
                with handle:
                    handle.write(record.text)
                temp_path = Path(handle.name)
                target = temp_path
            result = run_command([node, "--check", str(target)], cwd=repo)
            if result.returncode != 0:
                lines = (result.stderr or result.stdout).strip().splitlines()
                detail = next((line.strip() for line in reversed(lines) if line.strip()), f"código {result.returncode}")
                findings.append(Finding("high", "sintaxe", f"JavaScript/Apps Script inválido: {detail}", record.relative))
        finally:
            if temp_path:
                temp_path.unlink(missing_ok=True)
    return findings


def scan_workflows(records: Iterable[FileRecord]) -> list[Finding]:
    findings: list[Finding] = []
    for record in records:
        if not record.relative.startswith(".github/workflows/") or record.path.suffix.lower() not in {".yml", ".yaml"}:
            continue
        if re.search(r"(?m)^\s*permissions:\s*write-all\s*$", record.text):
            findings.append(Finding("high", "segurança CI", "Workflow concede `write-all`; aplicar menor privilégio.", record.relative))
        if re.search(r"(?m)^\s*pull_request_target\s*:", record.text):
            findings.append(
                Finding(
                    "high",
                    "segurança CI",
                    "Workflow usa `pull_request_target`; revisar checkout e execução de código não confiável.",
                    record.relative,
                )
            )
        for match in USES_PATTERN.finditer(record.text):
            ref = match.group(1)
            if ref.endswith("@main") or ref.endswith("@master"):
                findings.append(
                    Finding(
                        "medium",
                        "segurança CI",
                        f"Action usa referência móvel `{ref}`; preferir versão estável ou SHA revisado.",
                        record.relative,
                        line_number(record.text, match.start()),
                    )
                )
    return findings


def scan_agent_context(records: Iterable[FileRecord]) -> tuple[list[Finding], dict[str, int]]:
    findings: list[Finding] = []
    context_sizes: dict[str, int] = {}
    for record in records:
        is_agent_file = (
            record.path.name in {"AGENTS.md", "SKILL.md"}
            or "/.agents/" in f"/{record.relative}"
            or record.relative.startswith(".agents/")
            or record.relative.startswith(".codex/")
        )
        if not is_agent_file:
            continue
        estimated = math.ceil(len(record.text) / 4)
        context_sizes[record.relative] = estimated
        if record.path.name == "AGENTS.md" and record.byte_size > 32_768:
            findings.append(
                Finding(
                    "high",
                    "tokens",
                    f"`AGENTS.md` tem {record.byte_size:,} bytes e pode ultrapassar o limite padrão de instruções; reduzir ou segmentar.",
                    record.relative,
                )
            )
        elif estimated > 4_000:
            findings.append(
                Finding(
                    "medium",
                    "tokens",
                    f"Arquivo de instrução equivale aproximadamente a {estimated:,} tokens quando carregado; modularizar referências.",
                    record.relative,
                )
            )
    return findings, context_sizes


def git_history(repo: Path, days: int) -> tuple[list[dict[str, object]], list[str], bool, str | None]:
    git = shutil.which("git")
    if not git or not (repo / ".git").exists():
        return [], [], False, "Histórico Git indisponível; varredura limitada aos arquivos presentes."

    shallow = (repo / ".git" / "shallow").exists()
    since = f"{days} days ago"
    log_result = run_command(
        [git, "log", f"--since={since}", "--date=short", "--pretty=format:%H%x09%ad%x09%an%x09%s"],
        cwd=repo,
    )
    commits = [line for line in log_result.stdout.splitlines() if line.strip()] if log_result.returncode == 0 else []

    stats_result = run_command(
        [git, "log", f"--since={since}", "--pretty=format:", "--numstat", "--", "."],
        cwd=repo,
    )
    changes: defaultdict[str, list[int]] = defaultdict(lambda: [0, 0])
    if stats_result.returncode == 0:
        for line in stats_result.stdout.splitlines():
            parts = line.split("\t", 2)
            if len(parts) != 3 or parts[0] == "-" or parts[1] == "-":
                continue
            try:
                additions, deletions = int(parts[0]), int(parts[1])
            except ValueError:
                continue
            changes[parts[2]][0] += additions
            changes[parts[2]][1] += deletions

    rows = [
        {"path": path, "additions": values[0], "deletions": values[1], "churn": sum(values)}
        for path, values in changes.items()
    ]
    rows.sort(key=lambda row: (int(row["churn"]), str(row["path"])), reverse=True)

    warning = None
    if shallow:
        warning = "Checkout Git é raso; mudanças anteriores ao histórico disponível podem não aparecer."
    elif log_result.returncode != 0 or stats_result.returncode != 0:
        warning = "Falha parcial ao ler o histórico Git."
    return rows, commits, shallow, warning


def count_tests(records: Iterable[FileRecord]) -> tuple[int, int]:
    test_files = 0
    test_functions = 0
    for record in records:
        lowered = record.relative.lower()
        if any(token in lowered for token in ("test", "teste", "spec")):
            test_files += 1
        if record.path.suffix.lower() in {".gs", ".js", ".mjs", ".py", ".ts", ".tsx"}:
            test_functions += len(re.findall(r"(?m)^\s*(?:async\s+)?function\s+(?:test|teste)[\w$]*\s*\(", record.text, re.IGNORECASE))
            test_functions += len(re.findall(r"(?m)^\s*def\s+test_[A-Za-z0-9_]+\s*\(", record.text))
    return test_files, test_functions


def top_priorities(findings: list[Finding]) -> list[Finding]:
    ordered = sorted(findings, key=lambda f: (SEVERITY_ORDER.get(f.severity, 99), f.category, f.path, f.line or 0))
    selected: list[Finding] = []
    seen_categories: set[str] = set()
    for finding in ordered:
        if finding.severity == "info":
            continue
        if finding.category in seen_categories and len(selected) < 2:
            continue
        selected.append(finding)
        seen_categories.add(finding.category)
        if len(selected) == 3:
            break
    return selected


def markdown_escape(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def render_report(
    *,
    repo: Path,
    days: int,
    records: list[FileRecord],
    findings: list[Finding],
    tracked_only: bool,
    context_sizes: dict[str, int],
    changes: list[dict[str, object]],
    commits: list[str],
    history_warning: str | None,
    test_files: int,
    test_functions: int,
) -> str:
    now_utc = dt.datetime.now(dt.timezone.utc)
    now_local = now_utc.astimezone(ZoneInfo("America/Sao_Paulo"))
    total_bytes = sum(record.byte_size for record in records)
    total_lines = sum(record.line_count for record in records)
    total_chars = sum(len(record.text) for record in records)
    context_equivalent = math.ceil(total_chars / 4)
    severity_counts = Counter(finding.severity for finding in findings)
    todo_count = sum(len(TODO_PATTERN.findall(record.text)) for record in records)
    priorities = top_priorities(findings)

    lines: list[str] = [
        "# Revisão semanal JFN AI Ops",
        "",
        f"**Gerado:** {now_local:%d/%m/%Y %H:%M} (America/Sao_Paulo)  ",
        f"**Escopo:** `{repo.resolve()}`  ",
        f"**Período Git:** últimos {days} dias  ",
        "**Método:** auditoria determinística e local; nenhuma chamada de IA ou API externa.",
        "",
        "## Painel executivo",
        "",
        "| Indicador | Resultado |",
        "|---|---:|",
        f"| Arquivos textuais escaneados | {len(records):,} |",
        f"| Linhas escaneadas | {total_lines:,} |",
        f"| Volume textual | {total_bytes / 1024:.1f} KiB |",
        f"| Equivalente aproximado se todo o texto fosse carregado | {context_equivalent:,} tokens |",
        f"| Commits no período | {len(commits):,} |",
        f"| Arquivos com alteração no período | {len(changes):,} |",
        f"| Arquivos de teste identificados | {test_files:,} |",
        f"| Funções de teste identificadas | {test_functions:,} |",
        f"| Marcadores TODO/FIXME/HACK/XXX | {todo_count:,} |",
        f"| Achados críticos | {severity_counts.get('critical', 0):,} |",
        f"| Achados altos | {severity_counts.get('high', 0):,} |",
        f"| Achados médios | {severity_counts.get('medium', 0):,} |",
        "",
        "> A estimativa de tokens acima mede apenas o tamanho potencial do texto do repositório. Não representa consumo real do Codex. O consumo real deve ser conferido com `/status` e no painel de uso.",
        "",
    ]

    if not tracked_only:
        lines.extend(["> Aviso: o diretório não tinha metadados Git utilizáveis; arquivos não rastreados também podem ter sido lidos.", ""])
    if history_warning:
        lines.extend([f"> Aviso de histórico: {history_warning}", ""])

    lines.extend(["## Três prioridades máximas", ""])
    if priorities:
        for index, finding in enumerate(priorities, start=1):
            lines.append(
                f"{index}. **{SEVERITY_LABEL.get(finding.severity, finding.severity.upper())} — {finding.category}:** "
                f"{finding.message} {finding.location()}"
            )
    else:
        lines.append("1. Nenhum achado técnico prioritário nesta varredura; manter revisão humana das mudanças e do uso real.")
    lines.append("")

    lines.extend(["## Mudanças com maior churn", ""])
    if changes:
        lines.extend(["| Arquivo | + | − | Total |", "|---|---:|---:|---:|"])
        for row in changes[:MAX_CHANGE_ROWS]:
            lines.append(
                f"| `{markdown_escape(str(row['path']))}` | {row['additions']} | {row['deletions']} | {row['churn']} |"
            )
    else:
        lines.append("Nenhuma mudança detectada no período ou histórico indisponível.")
    lines.append("")

    lines.extend(["## Achados técnicos", ""])
    ordered_findings = sorted(
        findings,
        key=lambda f: (SEVERITY_ORDER.get(f.severity, 99), f.category, f.path, f.line or 0, f.message),
    )
    if ordered_findings:
        lines.extend(["| Severidade | Categoria | Local | Achado |", "|---|---|---|---|"])
        for finding in ordered_findings[:MAX_FINDINGS_IN_REPORT]:
            lines.append(
                f"| {SEVERITY_LABEL.get(finding.severity, finding.severity)} | {markdown_escape(finding.category)} | "
                f"{finding.location()} | {markdown_escape(finding.message)} |"
            )
        omitted = len(ordered_findings) - MAX_FINDINGS_IN_REPORT
        if omitted > 0:
            lines.append(f"\n_Mais {omitted} achados foram omitidos para manter o relatório curto._")
    else:
        lines.append("Nenhum achado nos controles implementados.")
    lines.append("")

    lines.extend(["## Contexto persistente da IA", ""])
    if context_sizes:
        lines.extend(["| Arquivo | Estimativa ao carregar |", "|---|---:|"])
        for path, tokens in sorted(context_sizes.items(), key=lambda item: item[1], reverse=True):
            lines.append(f"| `{path}` | ~{tokens:,} tokens |")
    else:
        lines.append("Nenhum `AGENTS.md`, `SKILL.md` ou configuração equivalente foi identificado.")
    lines.append("")

    lines.extend(
        [
            "## Dados de custo e uso",
            "",
            "Esta auditoria não recebeu telemetria de sessões do Codex. Portanto, **não classifica hábitos nem atribui causas ao consumo real**. Na revisão de sexta-feira:",
            "",
            "1. registrar `/status` no início e no fim;",
            "2. comparar apenas dados reais do painel/CLI;",
            "3. separar tarefas mecânicas de tarefas de raciocínio;",
            "4. limitar a semana a até três mudanças de maior impacto.",
            "",
            "## Checklist de sexta-feira",
            "",
            "- [ ] Conferir autenticação: `gh auth status`.",
            "- [ ] Atualizar sem reescrever histórico: `git pull --ff-only`.",
            "- [ ] Ler este relatório e os diffs dos últimos 7 dias.",
            "- [ ] Validar qualquer achado crítico antes de alterar código.",
            "- [ ] Criar branch `ops/weekly-ai-review-AAAA-MM-DD`.",
            "- [ ] Executar testes e repetir esta auditoria após cada correção.",
            "- [ ] Abrir PR em **draft**; não fazer merge ou deploy automático.",
            "- [ ] Registrar `/status` final e a economia/efeito observado, sem estimativas inventadas.",
            "",
            "## Regras de eficiência de sessão",
            "",
            "- Assunto novo ou objetivo incompatível: iniciar sessão nova.",
            "- Sessão longa com trabalho relevante restante: usar `/compact` uma única vez e continuar.",
            "- Trabalho quase concluído: finalizar sem compactar.",
            "- Busca, formatação e inventário: selecionar modelo mais leve disponível pelo `/model`.",
            "- Depuração de falha crítica, arquitetura ou segurança: usar modelo de maior capacidade somente no trecho necessário.",
        ]
    )
    return "\n".join(lines).rstrip() + "\n"


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Auditoria semanal determinística de IA e código.")
    parser.add_argument("--repo", type=Path, default=Path.cwd(), help="Raiz do repositório.")
    parser.add_argument("--output", type=Path, default=Path("reports/weekly-ai-ops.md"), help="Relatório Markdown.")
    parser.add_argument("--days", type=int, default=7, help="Janela do histórico Git.")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Retorna código 2 se houver achado crítico ou alto; o relatório sempre é escrito.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    repo = args.repo.expanduser().resolve()
    if not repo.is_dir():
        print(f"Erro: repositório inexistente: {repo}", file=sys.stderr)
        return 3
    if args.days < 1 or args.days > 365:
        print("Erro: --days deve estar entre 1 e 365.", file=sys.stderr)
        return 3

    records, findings, tracked_only = read_records(repo)
    findings.extend(scan_secrets(records))
    findings.extend(scan_duplicate_functions(records))
    findings.extend(scan_exact_duplicates(records))
    findings.extend(validate_json(records))
    findings.extend(validate_shell(records, repo))
    findings.extend(validate_javascript(records, repo))
    findings.extend(scan_workflows(records))
    context_findings, context_sizes = scan_agent_context(records)
    findings.extend(context_findings)

    changes, commits, _shallow, history_warning = git_history(repo, args.days)
    test_files, test_functions = count_tests(records)

    report = render_report(
        repo=repo,
        days=args.days,
        records=records,
        findings=findings,
        tracked_only=tracked_only,
        context_sizes=context_sizes,
        changes=changes,
        commits=commits,
        history_warning=history_warning,
        test_files=test_files,
        test_functions=test_functions,
    )

    output = args.output if args.output.is_absolute() else repo / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(report, encoding="utf-8")
    print(report, end="")

    if args.strict and any(f.severity in {"critical", "high"} for f in findings):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
