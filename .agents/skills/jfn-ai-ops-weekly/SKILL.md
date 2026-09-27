---
name: jfn-ai-ops-weekly
description: Use na revisão semanal de sexta-feira ou sempre que houver pedido para reduzir custos, tokens ou créditos, revisar falhas de algoritmo, sanear pendências de GitHub/Codex e melhorar gradualmente a operação JFN/WMGJ sem alterar produção automaticamente.
---

# JFN AI Ops Weekly

## Objetivo

Executar uma revisão semanal curta, auditável e orientada por evidências para:

1. reduzir consumo desnecessário de contexto, tokens e créditos;
2. detectar cedo falhas de sintaxe, duplicidades de função, segredos e riscos de algoritmo;
3. transformar apenas as três maiores prioridades em trabalho verificável;
4. preservar o pipeline operacional estável e impedir mudanças diretas em produção.

## Escopo padrão

- Repositório oficial: `GESTAOWMGJ/automacao-gestao-wmgj`.
- Branch estável: `main`.
- Pipeline crítico: `src/01_PIPELINE_CONFIABILIDADE_WMGJ.gs` e funções V3.
- Janela de revisão: últimos 7 dias.
- Horário operacional: sexta-feira, 16h–17h30, `America/Sao_Paulo`.

Quando usada em outro repositório, mantenha as mesmas regras e ajuste apenas comandos de teste já documentados nesse projeto.

## Regras inegociáveis

- Faça primeiro as verificações determinísticas. Não use modelo de IA para inventário, contagem, busca de duplicidade ou validação de sintaxe.
- Não envie código, dados clínicos, dados financeiros, credenciais ou conteúdo operacional sensível a serviços externos.
- Nunca exponha um segredo encontrado. Registre somente tipo, arquivo, linha e valor redigido. Oriente revogação/rotação antes da remoção.
- Nunca faça commit direto em `main`, merge, deploy, alteração de gatilho produtivo, rotação de credencial ou migração de dados automaticamente.
- Toda mudança deve ocorrer em branch `ops/weekly-ai-review-AAAA-MM-DD`, com pull request em **draft** e revisão humana.
- Não classifique hábitos ou causas de custo sem telemetria real. Na ausência de dados, declare a limitação e use apenas recomendações gerais.
- Limite a execução a três prioridades por semana. Pendências adicionais permanecem registradas para triagem futura.

## Início da sessão

1. Use `/new revisao-ia-AAAA-MM-DD` para separar esta rotina de outros assuntos.
2. Execute `/status` e registre modelo, uso de contexto e limites exibidos.
3. Confirme ambiente e autenticação:

```bash
gh auth status
git status --short --branch
git remote -v
git fetch origin --prune
```

4. Se houver alterações locais não relacionadas, não as descarte nem as misture. Interrompa a escrita e relate o bloqueio.
5. Atualize somente por avanço direto:

```bash
git switch main
git pull --ff-only
```

## Auditoria sem consumo de IA

Execute na raiz do repositório:

```bash
python3 scripts/weekly_ai_ops_audit.py \
  --repo . \
  --output /tmp/jfn-ai-ops-semanal.md \
  --days 7
```

Leia primeiro:

1. achados críticos e altos;
2. funções Apps Script duplicadas;
3. erros de sintaxe JSON, Shell, JavaScript ou Apps Script;
4. segredos possivelmente versionados;
5. arquivos com maior churn;
6. arquivos de instrução muito grandes e contexto persistente excessivo;
7. testes existentes e lacunas relacionadas às mudanças da semana.

Não carregue o repositório inteiro na conversa. Use `/mention` ou leitura por intervalos somente nos arquivos ligados às três prioridades.

## Priorização

Aplique esta ordem:

- **P0 — segurança e integridade:** segredo, exposição de dados, risco de perda/corrupção.
- **P1 — algoritmo e continuidade:** sintaxe inválida, função duplicada, teste quebrado, regressão ou gatilho conflitante.
- **P2 — custo e eficiência:** contexto excessivo, chamadas repetidas, loops desnecessários, workflow caro ou redundante.
- **P3 — manutenção:** documentação, nomes, organização e dívida sem impacto imediato.

Selecione no máximo três itens, preferindo categorias diferentes. Para cada item, defina evidência, risco, correção mínima e teste de aceitação.

## Política de sessão e modelo

- Busca, formatação, inventário e alterações mecânicas: use `/model` para selecionar o modelo mais leve disponível que preserve a qualidade necessária.
- Arquitetura, segurança, depuração crítica ou decisão clínica potencial: eleve a capacidade apenas durante esse trecho.
- Sessão longa com trabalho relevante restante: use `/compact` uma vez e continue.
- Trabalho quase concluído: finalize sem compactar.
- Assunto novo ou objetivo incompatível: use `/new`; não acumule temas independentes.
- Use `/plan` antes de mudanças de múltiplos arquivos e `/review` antes de concluir o PR.

## Fluxo GitHub

```bash
branch="ops/weekly-ai-review-$(date +%F)"
git switch -c "$branch"
```

Para cada prioridade:

1. faça a menor alteração segura;
2. execute o teste específico;
3. repita `weekly_ai_ops_audit.py`;
4. inspecione `/diff` e `git diff --check`;
5. crie commit pequeno, com justificativa e evidência.

Ao final:

```bash
git push -u origin "$branch"
gh pr create --draft \
  --title "ops: revisão semanal de IA $(date +%F)" \
  --body-file /tmp/jfn-ai-ops-semanal.md
```

Não habilite auto-merge.

## Critério de conclusão

A revisão termina somente quando houver:

- relatório semanal curto;
- até três prioridades justificadas por evidência;
- testes executados e resultados registrados;
- PR em draft ou justificativa explícita para não alterar código;
- pendências remanescentes registradas sem expansão de escopo;
- `/status` final comparado ao inicial, sem estimativas inventadas.

## Formato de saída

```text
REVISÃO SEMANAL JFN AI OPS — DD/MM/AAAA
REPOSITÓRIO / BRANCH:
USO REAL INICIAL / FINAL:
ACHADOS P0/P1/P2/P3:
TRÊS PRIORIDADES:
TESTES EXECUTADOS:
PR DRAFT:
ECONOMIA OU EFEITO OBSERVADO:
PENDÊNCIAS PARA A PRÓXIMA SEXTA:
```
