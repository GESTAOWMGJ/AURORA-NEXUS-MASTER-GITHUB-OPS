# Aurora Nexus — Full Firebase em shadow mode

**Estado-alvo desta fase:** front-end, back-end e motor de projeções prontos para homologação, sem substituir nem escrever no sistema-fonte da WMGJ.

## Componentes

| Camada | Implementação | Limite de segurança |
|---|---|---|
| Front-end | Hosting reescreve para shell privado gerado pela Function | Nenhum dashboard é entregue sem sessão, allowlist e vínculo ativo em `organizations/wmgj/members/{uid}` |
| Back-end | APIs `bootstrap`, `actions` e `refresh` em Cloud Functions v2 | CSRF, RBAC, escopo organizacional, revisão esperada e idempotência |
| Motor | Projeção sanitizada a cada 15 minutos | Somente leitura das coleções canônicas; não altera Drive, Sheets, Gmail ou registros financeiros |
| Auditoria | Eventos server-only para atualização de projeção e comandos humanos | Identidade, papel, hash do comando e horário do servidor |
| Implantação | Workflow manual em ambiente GitHub protegido | Projeto precisa coincidir com a variável homologada e confirmação literal |

## Fluxo de migração sem ruptura

1. A operação atual permanece soberana.
2. O Apps Script executa diagnóstico e `DRY_RUN` com amostra pequena.
3. A ingestão HMAC v2 replica eventos em Firestore de homologação.
4. O motor produz `dashboardSnapshots/current`, sempre marcado como `sanitized=true`, `INTERNAL` e `SHADOW`.
5. Usuários individuais autorizados validam totais, pendências, SLA e evidências.
6. Divergências viram itens de revisão; nenhuma correção volta automaticamente à fonte.
7. O cutover de leitura só pode ser avaliado após dois fechamentos paralelos sem divergência material.

O motor falha fechado se qualquer coleção exceder o limite de leitura da projeção. Nesse caso, a projeção anterior é preservada e o volume deve ser tratado com agregação paginada antes de ampliar o piloto; totais parciais nunca são publicados como completos.

## Gates antes do primeiro deploy

- Project ID oficial de homologação e billing/orçamento aprovados.
- Workload Identity Federation e service account de deploy com menor privilégio.
- Secret `AURORA_NEXUS_ALLOWED_EMAILS` configurado no Secret Manager.
- Usuários criados no Firebase Auth e memberships individuais ativas no Firestore.
- Firestore Native, região, retenção, backup/restore e delete protection comprovados.
- CI verde para Functions, regras, FastAPI, contratos e evals.
- Ambiente GitHub `firebase-homologation` com aprovadores obrigatórios.

## Implantação controlada

O workflow `Deploy Aurora Firebase Homologation` sempre valida o commit. Ele só implanta quando:

- `project_id` coincide exatamente com `FIREBASE_HML_PROJECT_ID`;
- a entrada é `DEPLOY_HOMOLOGATION`;
- o ambiente protegido aprova;
- a autenticação OIDC/WIF é concluída sem chave persistente.

O escopo implantado é limitado a Functions, Hosting, Firestore Rules e índices. Dados reais, DNS, segredos, criação de usuários e migração operacional não são feitos pelo workflow.

## Rollback

- O sistema-fonte continua intacto; desligar a ponte ou retornar `WMGJ_FIRESTORE_DRY_RUN=true` interrompe novas réplicas.
- A interface pode voltar ao release anterior do Hosting/Functions sem restaurar dados-fonte.
- Projeções são derivadas e recriáveis. Eventos e evidências não devem ser apagados.
- Qualquer falha de escopo, autenticação, integridade ou conciliação mantém o Firebase em `SHADOW`.
