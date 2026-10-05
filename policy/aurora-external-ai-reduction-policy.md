# AURORA NEXUS — Política de Redução Progressiva de IA Externa

## Objetivo

Reduzir dependência de IA externa até o ponto em que o motor nativo Firebase + Google Cloud resolva padrões recorrentes com regras, avaliação determinística e fallback controlado.

## Princípios

1. Motor interno primeiro.
2. Nada de IA externa por padrão.
3. Toda saída precisa de trilha auditable.
4. Toda exceção exige motivo explícito.
5. Toda migração para interno precisa de KPI.

## Fases

### Fase 0 — Observação

- IA externa permitida apenas em modo explícito.
- Registre `external_ai_used`, motivo, custo e resultado.
- Não usar IA externa para dados já canonizados no Firebase.

### Fase 1 — Espelhamento seguro

- IA externa só para comparar com o motor interno.
- Saída externa não pode agir sem validação humana.
- Regra nativa deve ser criada quando a mesma decisão reaparecer 3 vezes.

### Fase 2 — Substituição parcial

- Preferir regra nativa, modelo local ou serviço interno.
- Externa vira fallback de exceção.
- Toda chamada externa precisa de `policy_reason` e `approval_gate`.

### Fase 3 — Restrição severa

- IA externa só para lacunas sem cobertura interna.
- Bloqueio automático se houver snapshot Firebase suficiente.

### Fase 4 — Quase total autonomia

- Externa só para pesquisa não operacional ou comparação opcional.
- Dependência externa deve ficar abaixo do KPI-alvo.

## Critérios de saída para o fallback externo

Permitir fallback apenas quando:

- o snapshot canônico não tiver cobertura suficiente;
- a regra interna não existir;
- a execução estiver em dry-run;
- o gate de segurança autorizar explicitamente;
- o custo/risco da chamada externa estiver aceito.

## Proibição

- Nunca enviar segredos, dados brutos de cliente, conteúdo clínico identificável ou payload não minimizado.
- Nunca usar IA externa para decisões financeiras, auditoria, permissões, rollback ou deploy.
- Nunca transformar fallback externo em caminho padrão silencioso.

## KPIs de redução

- `external_ai_dependency_rate`
- `autonomous_pr_success_rate`
- `regression_rate`
- `mttr`

## Revisão

- Revisão mensal.
- Atualizar a política quando um padrão migrar para regra nativa.
- Todo fallback revertido deve virar backlog de substituição.
