# Master Studio: plano de endpoints

Atualização factual: **12/10/2026**. Contrato de código observado em `desktop/ia-master/server.cjs` e `studio.cjs`, componente **1.1.0**. As rotas implementadas abaixo são separadas das capacidades futuras. Testes locais não comprovam CI do SHA final, HML, instalação ou publicação desta candidata.

## Rotas existentes

| Método e rota | Contrato observado |
| --- | --- |
| `GET /health` | Serviço, versão, início e manifesto de processo sanitizado; somente loopback/Host válido, sem segredo ou tenant. |
| `POST /api/pair-ticket` | Exige bearer local; retorna ticket descartável válido por 60 segundos. |
| `POST /api/session` | Consome ticket de uso único; acesso local cria cookie HttpOnly/SameSite=Strict de 8 horas. Portal autorizado recebe token próprio vinculado à origem e à organização, sem cookie/identidade Firebase. |
| `POST /api/logout` | Revoga sessão e cookie. |
| `GET /api/status` | Sessão/bearer válido; modelo, hardware, métricas, política, integrações; `cloudSync=NOT_VERIFIED`, `selfDeployment=false`. |
| `POST /api/improve` | `{prompt, classification}` com chaves fechadas; PUBLIC/INTERNAL, limite de 6.000 caracteres, filtros adicionais de segredo. Retorna `proposal`, `proposalId`, `PROPOSAL_ONLY`, `applied=false`. |
| `POST /api/native` | `{snapshot, classification}`; tenant e classificação restritos. Prévia determinística com autenticidade não verificada. |

As POST exigem JSON e `X-Aurora-Local: 1`. Host, endereço remoto, Origin e Sec-Fetch-Site são verificados. A ponte do portal é opt-in, com CORS para origens exatas configuradas, sem curinga; `control.key` não é aceita como bearer de portal. O contexto do Studio lê somente blobs do `HEAD` e arquivos expressamente permitidos no repositório configurado. O serviço continua em loopback, sem endpoint LAN.

## Rotas Studio implementadas, sem execução livre

| Método e rota | Entrada fechada | Resultado / gate |
| --- | --- | --- |
| `GET /api/studio/capabilities` | Nenhuma | Repositório/catálogo, limites e estados das operações. `projectTestRunner=NOT_IMPLEMENTED`, `ci=NOT_CONFIGURED`, `publish=NOT_IMPLEMENTED`; não concede acesso. |
| `GET /api/studio/tasks` | Nenhuma | Até 100 tarefas persistidas, com ID, versão, estado, resumo e datas. |
| `POST /api/studio/context` | `{paths, classification, focus?}` | Fonte integral do `HEAD` configurado, SHA/base e hashes; `focus` usa `{path,startLine,endLine}`. Até 10 arquivos, 30.000 bytes por arquivo, 50.000 bytes no conjunto; PUBLIC/INTERNAL, paths/segredos/symlinks restringidos. |
| `POST /api/studio/tasks` | `{contextId, prompt, classification}` | Nova tarefa vinculada ao contexto, projeto e organização, estado `CONTEXT_BOUND`. Pedido entre 8 e 6.000 caracteres. |
| `GET /api/studio/tasks/:id` | ID hexadecimal de 32 caracteres | Registro privado da tarefa, proposta/histórico e versão; token/cookie não pertencem ao registro. |
| `POST /api/studio/tasks/:id/propose` | `{expectedVersion}` | Inferência local, views de até 4.096 bytes UTF-8 incluindo pedido/esquema, JSON de edições literais validado e fingerprint; `PROPOSED`. Saída truncada/indisponibilidade bloqueiam. |
| `POST /api/studio/tasks/:id/proposal` | `{expectedVersion, proposal}` | Proposta manual estruturada; `edits` ou conteúdo integral, com os mesmos paths/preconditions/limites. |
| `GET /api/studio/tasks/:id/diff` | ID observado | Diff e validação determinística dos hashes/base; conteúdo é texto. Não executa testes. |
| `POST /api/studio/tasks/:id/validate` | `{expectedVersion}` | Schema, literal único, limites, hashes e drift; `VALIDATED`. |
| `POST /api/studio/tasks/:id/stage` | `{expectedVersion}` | `STAGING` antes da mutação; worktree detached com blobs brutos, sem checkout/hook/filtro, preservando checkout ativo; `PATCH_STAGED` ou `STAGING_BLOCKED`. |
| `POST /api/studio/tasks/:id/verify` | `{expectedVersion, recipeId:"SYNTAX_AND_DIFF_V1"}` | `node --check` em JS/CJS/MJS, parse de JSON, integridade textual para os demais tipos e `git diff --cached --check`; `STATIC_CHECKS_PASSED` ou `CHECK_FAILED`. |
| `POST /api/studio/tasks/:id/prepare` | `{expectedVersion}` | Revalida fingerprint, workspace e índice; `commit-tree` + `update-ref` exclusivo criam branch/commit **local**, `PREPARED_LOCAL_ONLY`/`VERSION_PREPARED`, ou `PREPARATION_BLOCKED`. |

## Objetos e invariantes atuais

Proposta: `{summary, files:[{path,beforeSha256,edits:[{before,after}]}]}`. Cada literal existe uma única vez na fonte integral e está presente na view recebida; sobreposição ou criação do alvo de outra edição é recusada. Limites: 20 edições por arquivo, 4.000 bytes por literal e 8.000 bytes somados por proposta. Arquivo novo usa uma única edição com `before` vazio. Proposta manual pode usar `content` integral em vez de `edits`, nunca ambos. Não há operação de exclusão de arquivo.

Auditoria do servidor usa horário, organização, ação, versão e hashes/metadados sanitizados. Histórico da tarefa usa estado anterior/novo, versão, evidência, `previousEventHash` e `eventHash`. Os registros privados de contexto/tarefa contêm pedido/código para retomada; o ledger de auditoria não contém prompt bruto, patch, ticket ou credencial. A autoridade permanente da sessão é referência factual com escopo; não fabrica identidade pessoal, recibo de MFA, review GitHub ou novo grant.

Mutações de tarefa usam lock e `expectedVersion`; o servidor calcula e revalida os fingerprints. Criação de contexto/tarefa gera um ID novo por POST, sem chave de idempotência implementada. Operações são síncronas com limites; não existe API de jobs. Reenvio depois de timeout deve primeiro consultar tarefa/histórico e reconciliar a versão. Staging/preparo interrompidos preservam bloqueio, evitando repetir mutação cegamente.

`STATIC_CHECKS_PASSED` conserva `projectTests=NOT_EXECUTED_RUNNER_NOT_IMPLEMENTED`, `ci=NOT_CONFIGURED` e `deploy=NOT_PERFORMED`. O preparo declara `pushed=false` e `deployed=false`. Na UI, preparo também depende de diff/fingerprint confirmado e checkbox de revisão; isso não fabrica review GitHub ou aprovação de deployment. Registro `registrationOnly=true` não concede permissão ao adaptador.

## Capacidades futuras

Catálogo de múltiplos projetos, runner de build/testes gerais, jobs, publicação de branch/PR, CI, deploy/HML, instalação e recuperação de release pela API Studio permanecem **NOT_IMPLEMENTED/NOT_CONFIGURED**. As antigas rotas planejadas `/projects`, `/proposals`, `/jobs`, `/releases` e `/tasks/:id/audit` não são contratos disponíveis no servidor 1.1.0.

A main `1a2e483` implementa o workflow de tráfego HML com CAS/rollback e o modo de aprovação real do titular, documentados em [docs/38](../firebase-migration/docs/38-hml-owner-release-governance.md). Esses controles existem fora da API Studio e não comprovam CI, HML, pin ou instalação desta candidata. O helper experimental permanece em `work/failsafe-spec/authgate-failsafe.py`, fora do repositório/pacote.

## Verificação necessária antes de declarar operacional

Os testes locais verificam o contrato de autenticação/Host/Origin, ticket, tenant, classificação, paths, schema/limites, hashes/CAS, estados, truncamento e checks estáticos. Modelo real, instalação, disponibilidade/hardware, CI no SHA final, HML, pin, publicação e recuperação do projeto precisam de evidência própria. A compatibilidade da `knowledge-registry` proveniente da versão instalada 1.0.1 está em reconciliação/teste nesta candidata, sem corpus real ou treinamento declarado.

Arquitetura e etapas: [AURORA_MASTER_STUDIO_ARCHITECTURE_20261008.md](AURORA_MASTER_STUDIO_ARCHITECTURE_20261008.md).
