# Produção beta — evidência de preparação em 05/10/2026

Estado: infraestrutura inicial confirmada; aplicativo beta ainda não implantado.

Após autorização explícita do titular para produção nesta data, foi criado um
projeto isolado para o mesmo AURORA NEXUS. Não foi inferida inexistência a partir
de PERMISSION_DENIED nem reutilizado o candidato histórico recusado.

| Verificação ao vivo | Resultado |
| --- | --- |
| Project ID | `wmgj-prod-jfn-20261005` |
| Project number | `616997609173` |
| Lifecycle | `ACTIVE` |
| Billing | habilitado na conta existente utilizada pela WMGJ |
| Firebase | operação addFirebase concluída, `done=true` |
| Hosting site reservado pelo Firebase | `wmgj-prod-jfn-20261005` |
| Aplicativo publicado / login / isolamento | não validados |
| CMEK para este projeto | não confirmado |

As consultas e a criação usaram a sessão GCP existente no computador Windows
conectado. Não foram exportadas credenciais. HML e `wmgj-ops` não foram alterados.
APIs de plataforma foram habilitadas no novo projeto; isto não comprova banco,
funções, conteúdo de Hosting, usuários, backups ou dados implantados.

A ativação Firebase exigiu `x-goog-user-project` apontando ao próprio projeto.
Uma resposta inicial 403 indicou ausência de quota project, não falta de acesso
à conta. A chamada corrigida concluiu com sucesso. Nunca resolver esse diagnóstico
ampliando IAM por hipótese.

## Próximos gates obrigatórios

1. Reconciliar e validar o contrato do PR #160 contra a main corrente.
2. Promover ID/número verificados em mudança explícita, mantendo os demais
   gates bloqueados até configuração de WIF, secrets e ambiente protegido.
3. Criar configuração de deploy de produção separada: o `firebase.json` e o
   workflow de deploy atuais aceitam HML. Não remover essa proteção para publicar.
4. Provisionar acesso nominal, MFA e políticas de isolamento do beta; preparar
   dados sintéticos e executar smoke autenticado, negativa de acesso e rollback.
5. Não liberar dados reais sem recuperação e segurança comprovadas; dados
   clínicos sensíveis continuam bloqueados, inclusive por ausência de CMEK.

A reserva do site não é URL de beta funcional. A autorização de produção não
substitui CI, autenticação, homologação ou aceite. O request de provisionamento
permanece fail-closed enquanto os passos acima não forem concluídos.
