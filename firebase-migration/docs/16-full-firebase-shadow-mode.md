# Aurora Nexus — Full Firebase em shadow mode

**Estado-alvo desta fase:** front-end, back-end e motor de projeções prontos para homologação, sem substituir nem escrever no sistema-fonte da WMGJ.

## Componentes

| Camada | Implementação | Limite de segurança |
|---|---|---|
| Front-end | Hosting reescreve para shell privado gerado pela Function | Nenhum dashboard é entregue sem sessão, allowlist e vínculo ativo em `organizations/wmgj/members/{uid}` |
| Back-end | APIs `bootstrap`, `actions` e `refresh` em Cloud Functions v2 | CSRF HMAC ligado à sessão/rota, RBAC, escopo organizacional, revisão esperada e idempotência |
| Motor | Projeção sanitizada por competência, agendada a cada 15 minutos | Desligado por padrão; somente leitura das coleções canônicas; não altera Drive, Sheets, Gmail ou registros financeiros |
| Auditoria | Snapshot histórico, ponteiro atual e evento server-only na mesma transação | Identidade, papel, hash da fonte e horário do servidor |
| Implantação | Workflow manual em ambiente GitHub protegido | Projeto precisa coincidir com a variável homologada e confirmação literal |

## Fluxo de migração sem ruptura

1. A operação atual permanece soberana.
2. O Apps Script executa diagnóstico e `DRY_RUN` com amostra pequena.
3. A ingestão HMAC v2 replica eventos em Firestore de homologação.
4. Após habilitação explícita de `projectionEnabled=true`, `projectionMode=SHADOW` e `projectionCompetence=YYYY-MM`, o motor produz o snapshot canônico da competência, `dashboardSnapshots/current` e histórico imutável, sempre com `sanitized=true` e `INTERNAL`.
5. Usuários individuais autorizados validam totais, pendências, SLA e evidências.
6. Divergências viram itens de revisão; nenhuma correção volta automaticamente à fonte.
7. O cutover de leitura só pode ser avaliado após dois fechamentos paralelos sem divergência material.

O motor falha fechado se qualquer coleção exceder o limite de leitura, se faltar competência, se não houver fonte ou se existir valor financeiro sem centavos canônicos válidos. Nesse caso, a projeção anterior é preservada; totais parciais ou ambíguos nunca substituem o último snapshot aprovado. Ausência continua `null`/“Sem fonte”, distinta de zero conhecido.

## Gates antes do primeiro deploy

- Project ID oficial de homologação e billing/orçamento aprovados.
- Workload Identity Federation e service account de deploy com menor privilégio.
- Secrets `AURORA_NEXUS_ALLOWED_EMAILS` e `AURORA_NEXUS_CSRF_HMAC_KEY` configurados no Secret Manager.
- Usuários criados no Firebase Auth e memberships individuais ativas no Firestore.
- Firestore Native, região, retenção, backup/restore e delete protection comprovados.
- CI verde para Functions, regras, FastAPI, contratos e evals.
- Ambiente GitHub `firebase-homologation` com aprovadores obrigatórios.
- Organização `wmgj` ativa, motor inicialmente desabilitado e competência piloto definida somente após reconciliação da amostra.

## Implantação controlada

O workflow `Deploy Aurora Firebase Homologation` sempre valida o commit. Ele só implanta quando:

- `project_id` coincide exatamente com `FIREBASE_HML_PROJECT_ID`;
- a entrada é `DEPLOY_HOMOLOGATION`;
- o ambiente protegido aprova;
- a autenticação OIDC/WIF é concluída sem chave persistente.

O escopo implantado é limitado a Functions, Hosting, Firestore Rules e índices. O preflight exige os três secrets técnicos, região e delete protection, e o smoke público confirma que apenas a tela de login está exposta. Dados reais, DNS, valores de segredos, criação de usuários e migração operacional não são feitos pelo workflow.

## Contrato de operação

- `06_NFS_E` fornece `totalCents`; `08_EXTRATOS_BRADESCO` fornece `amountCents`/`liquidatedAmountCents` por adaptadores explícitos.
- O texto exibido na Sheet permanece preservado e o campo canônico em centavos é derivado sem escrever na fonte.
- Registros financeiros entram na soma somente em `VALIDATED`/`CLOSED`, na competência escolhida e fora de dados de teste.
- Viewer/operator não recebem valores financeiros; resolução exige evidência, papel autorizado e MFA para risco alto/crítico.
- O pacote de política registra Aurora Nexus `2.3.0`, o mapa M01–M10 e hashes de origem/exportação em `policy/manifest.json`.

## Rollback

- O sistema-fonte continua intacto; desligar a ponte ou retornar `WMGJ_FIRESTORE_DRY_RUN=true` interrompe novas réplicas.
- A interface pode voltar ao release anterior do Hosting/Functions sem restaurar dados-fonte.
- Projeções são derivadas e recriáveis. Eventos e evidências não devem ser apagados.
- Qualquer falha de escopo, autenticação, integridade ou conciliação mantém o Firebase em `SHADOW`.
