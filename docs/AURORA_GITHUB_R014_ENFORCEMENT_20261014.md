# AURORA R014 — contenção e instalação de proteção independente (14/10/2026)

## Evidência auditada
- PR #254: `head=dd52167322f8bea456b317c6f2cc2d8eb84113c2`; `reviews=[]`; `merged_by=GESTAOWMGJ`; integrado às 08:59:37 BRT.
- PR #255: `head=471ac5baebfce8b945ff21dd6358d33d6422f0d1`; `reviews=[]`; `merged_by=GESTAOWMGJ`; integrado às 09:06:48 BRT.
- `GET /branches/main`: `protected=false`, `protection.enabled=false` no HEAD `2f4966dc0747ae2c8f96c86037db35e60040eaca`.
- `GET /rulesets`: `[]`; `GET /branches/main/protection`: 403 (`Resource not accessible by integration`).
- Comentários automáticos do Codex em #254 e #255 sinalizaram limite de quota. Não eram submissões de review.
- Repositório pertence à conta individual `GESTAOWMGJ`. Nenhum outro humano com acesso de revisão foi comprovado nesta auditoria; não preencher CODEOWNERS com identidade fictícia.

## Correção candidata: não operacional antes de proteção administrativa
O workflow `.github/workflows/aurora-r014-independent-review.yml` executa somente consultas de leitura ao GitHub. Ele não faz deploy, não acessa segredos de produção, não publica nem altera a `main`. A verificação:
1. Falha se o PR não estiver aberto/pronto e direcionado à `main` canônica.
2. Obtém o SHA atual e todas as páginas de revisões; falha se consulta/paginação for incompleta.
3. Exige review `APPROVED` de pessoa GitHub do tipo `User`, ID/login distintos do autor, `commit_id` igual ao HEAD corrente e permissão `write/maintain/admin`.
4. Rejeita `CHANGES_REQUESTED` vigente; `DISMISSED`, bots, autores e reviews de SHAs anteriores não satisfazem o gate.
5. Relê o HEAD imediatamente antes da conclusão. Qualquer falha retorna status negativo (fail closed).
6. É disparado tanto por eventos de PR quanto por submissão, edição e dispensa de review; não possui filtros de `paths` e assim abrange governança documental.

**Advertência:** job de CI isolado não impede merge se a regra server-side estiver ausente, desativada ou sujeita a bypass. Este PR deve permanecer em draft até validação humana. A adoção da política depende obrigatoriamente da configuração GitHub abaixo.

## Etapas administrativas — GitHub Settings / Branches ou Rulesets
1. Configurar desde já uma regra **ativa** na referência exata `refs/heads/main`: exigir pull request, pelo menos **1 aprovação**, `dismiss stale approvals`, `require approval of the most recent reviewable push`, resolução de conversas e restrição de push direto.
2. Aplicar a regra **inclusive a administradores**, sem lista de bypass (incluindo apps/roles). Proibir force push e exclusão. Não permitir auto-merge sem todos os critérios.
3. Convidar um revisor humano diferente da conta `GESTAOWMGJ`, com permissão verificável `write` ou superior, preservando segregação real. Depois, inserir CODEOWNERS para `docs/**`, `firebase-migration/docs/**`, `.github/workflows/**`, `.github/requests/**`, `firebase-migration/policy/**` e outras rotas de governança, e exigir code-owner review.
4. Somente com essa proteção **já ativa**, permitir revisão independente do HEAD deste PR corretivo e a integração futura; nenhuma aprovação histórica pode ser fabricada.
5. Após a integração legítima do workflow, exigir em branch protection/ruleset o check `Independent exact-head review` e checks reais de CI adequados ao escopo; não tornar obrigatório um workflow que não executa em PRs documentais por causa de filtros `paths`.
6. Reconsultar as APIs com credencial efetivamente administrativa, checar `protected=true`, regras ativas, requisitos, bypass vazio e IDs de autores/aprovadores. Testar um PR sem aprovação **sem integrá-lo**; após novo push, confirmar a invalidação da aprovação anterior.

## Estados e limites
- **Estado ao criar esta candidata:** `PENDING_ADMIN_RULESET_AND_INDEPENDENT_REVIEW`. Um documento ou teste aprovado **não equivale** a proteção GitHub aplicada.
- **Histórico:** manter merges #254/#255 intactos; registrar não conformidade no issue #256, sem review retroativo.
- **R029:** permanece com término em `2026-10-15T03:00:00Z`, sem prorrogação e sem execução de ferramentas cobertas após seu vencimento sem novo rito específico.
- **Escopo:** homologação somente; nada nesta correção autoriza publicação, publisher, produção ou tratamento de `CLINICAL_SENSITIVE`.

Incidente: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/issues/256
