# AURORA HML — gate de revisão independente (14/10/2026)

## Decisão operacional
Após o PR #254, a seleção canônica de revisão é `GITHUB_PULL_REQUEST_REVIEW`. O PR #254 está integrado, mas a API retornou `reviews: []`; a análise técnica em conversa não constitui review GitHub nem corrige retroativamente essa ausência.

## Gate obrigatório para a próxima alteração de governança
1. Criar PR para a `main` a partir de branch isolada e executar CI no head exato.
2. Requerer `APPROVED` por usuário GitHub do tipo `User`, diferente do autor, no `commit_id` igual ao head corrente do PR, com acesso de revisor admissível.
3. Revalidar após qualquer push; `CHANGES_REQUESTED` vigente, `DISMISSED`, Bot, autor, head diferente, consulta indisponível ou paginação incompleta não satisfazem o gate.
4. Antes de merge, verificar checks obrigatórios e política de proteção/ruleset da `main` configurada no próprio GitHub, com bloqueio a bypass indevido. Sem garantia efetiva do GitHub, não declarar proteção administrativa implantada.
5. O merge exige validação expressa dos gates; este documento não autoriza merge automático. Depois, a publicação exige novamente PR/head exatos, CI push, ambiente HML protegido, deploy/smokes, Ed25519, predecessor vivo e CAS.
6. Se o head mudar ou outra alteração entrar na `main`, repetir a reconciliação para a próxima candidata. A solicitação de 13/10 contém `expectedSourceSha` e predecessor históricos; não copiá-los cegamente.
7. R029 não tem extensão automática. O prazo original (`2026-10-15T03:00:00.000Z`) foi renovado por deliberação humana direta em 14/10, registrada na política `AURORA-HML-OWNER-RENEWAL-20261014`: revisão até 15/10/2026 e expiração em 16/10/2026 00:00 America/Sao_Paulo (`2026-10-16T03:00:00.000Z`), com os mesmos 11 riscos (7 altos, 4 moderados, zero crítico) e escopo HML. Não equivale a nova revisão independente nem dispensa os gates técnicos e a aprovação real do run protegido.
8. Escopo: exclusivamente HML `wmgj-hml-jfn-20260927`, ambiente `firebase-homologation`. Produção e `CLINICAL_SENSITIVE` permanecem excluídos.

## Evidência de aceite
Registrar URL do PR, autor, reviewer ID/login, estado, commit exato, data, checks, decisão de merge e recibo do publisher. Sem evidência, estado `PENDING_INDEPENDENT_REVIEW` e nenhuma alegação de publicação.

Este PR documental deve cumprir o mesmo gate antes de sua própria integração.
