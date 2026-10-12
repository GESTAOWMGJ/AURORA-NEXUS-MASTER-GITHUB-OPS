# Master Studio: plano de endpoints

Atualização factual: **12/10/2026**. Contrato observado em `desktop/ia-master/server.cjs`, `studio.cjs` e `publisher.cjs`, código candidato **1.1.0**; instalação observada **1.0.1** preservada. Studio local e portal oferecem as operações implementadas abaixo. Testes locais não comprovam modelo real, CI do SHA final, HML, atualização instalada ou PR remoto novo.

## Rotas existentes

| Método e rota | Contrato observado |
| --- | --- |
| `GET /health` | Serviço, versão, início e manifesto de processo sanitizado; somente loopback/Host válido, sem segredo ou tenant. |
| `POST /api/pair-ticket` | Exige bearer local; retorna ticket descartável válido por 60 segundos. |
| `POST /api/session` | Consome ticket de uso único; acesso local cria cookie HttpOnly/SameSite=Strict de 8 horas. Portal autorizado recebe token próprio vinculado à origem e à organização, sem cookie/identidade Firebase. |
| `POST /api/logout` | Revoga sessão e cookie. |
| `GET /api/status` | Sessão/bearer válido; modelo, hardware, métricas, política, integrações, conhecimento carregado e capacidades do Publisher; `cloudSync=NOT_VERIFIED`, `selfDeployment=false`. Capacidades não comprovam autorização GitHub/MFA. |
| `POST /api/improve` | `{prompt, classification}` com chaves fechadas; PUBLIC/INTERNAL, limite de 6.000 caracteres, filtros adicionais de segredo. Retorna proposta, ID, recibo de seleção de conhecimento, `PROPOSAL_ONLY`, `applied=false`. Cache vinculado à identidade do corpus. |
| `POST /api/native` | `{snapshot, classification}`; tenant e classificação restritos. Prévia determinística com autenticidade não verificada. |

As POST exigem JSON e `X-Aurora-Local: 1`. Host, endereço remoto, Origin e Sec-Fetch-Site são verificados. A ponte do portal é opt-in, com CORS para origens exatas configuradas, sem curinga; `control.key` não é aceita como bearer de portal. O contexto do Studio lê somente blobs do `HEAD` e arquivos expressamente permitidos no repositório configurado. O serviço continua em loopback, sem endpoint LAN.

## Rotas Studio implementadas, sem execução livre

| Método e rota | Entrada fechada | Resultado / gate |
| --- | --- | --- |
| `GET /api/studio/capabilities` | Nenhuma | Repositório/catálogo, limites e estados. `projectTestRunner=NOT_IMPLEMENTED`; Publisher desligado informa `NOT_CONFIGURED`. Com opt-in válido, `operations.publish=DRAFT_PR_ONLY`, `operations.ci=REMOTE_METADATA_ONLY` e `publisher.state=CONFIGURED_AUTH_NOT_OBSERVED`; não concede acesso nem comprova autenticação remota. |
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
| `POST /api/studio/tasks/:id/publish-draft` | `{expectedVersion, proposalFingerprint}` | Exige tarefa `VERSION_PREPARED`, Publisher opt-in, vínculo/arquivos/commit/base e autorização gh revalidados. Publica somente branch própria e PR draft no repo fixo; registra intenção e confirma por readback. Não faz merge, deploy ou instalação. |
| `POST /api/studio/tasks/:id/reconcile-publication` | `{expectedVersion, proposalFingerprint}` | Consulta identidade remota e reconcilia resultado incerto; persiste journal local. Não cria branch nem PR. Retomada de criação incerta exige duas observações de ausência separadas por pelo menos 60 segundos e uma nova ação explícita. |
| `POST /api/studio/tasks/:id/read-ci` | `{expectedVersion, proposalFingerprint}` | Consulta check-runs/runs de PR pelo SHA preparado, confirma head/base/PR e persiste metadados sanitizados. Sempre `ciVerified=false`, `actualCheckout=NOT_OBSERVED`, `requiredCoverage=NOT_OBSERVED`; não dispara workflow ou promove versão. |

## Publisher opt-in e recibos remotos

O adaptador aceita somente configuração persistida vinculada à organização em `studio-configuration.json`: `publisher.enabled=true`, `authorizedOrgId`, caminho absoluto `ghExecutable`, `ghSha256` e `gitSha256`. Não há fallback de Publisher por variável de ambiente. O repositório é **`GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS`**, conta **`GESTAOWMGJ`**, base **`main`** e branch **`aurora-studio/<taskId>`**. O modelo/POST não escolhe executável, comando, repo, branch alternativa ou credencial.

O aplicativo não lê token: gh usa sua configuração existente. Antes de cada operação, hashes dos executáveis são revalidados; a autorização remota exige conta, repo, default branch, ausência de arquivamento e permissão push. Isso não comprova MFA GitHub ou transfere o MFA do portal para o processo local. Configurações Git locais que injetem destino, credencial/proxy/includes são recusadas. Push usa URL HTTPS fixa e lease de branch ausente. Criar PR usa `--draft --no-maintainer-edit --body-file -`, com corpo fixo do adaptador enviado por stdin: IDs, hashes, estado das verificações e paths permitidos. Prompt, summary e resposta do modelo não compõem esse corpo; não há arquivo temporário mutável de body.

O schema `aurora.master.publisher.v1` vincula `taskVersion`, organização, repo, base, commit/tree, fingerprint e hashes dos arquivos. `publicationVersion` conta o journal próprio; resposta/histórico da tarefa expõem o recibo sem falsificar incremento da versão de engenharia. Resultado incerto fica registrado e exige reconciliação antes de repetir escrita. Conflitos não são corrigidos com force push nem rebase automático.

`pullRequest` confirma o draft com a base preparada; `observedPullRequest`, opcional/null, registra `{number,url,draft:true,headSha,baseSha}` observado mesmo quando `main` avançou durante a criação. Seu `baseSha` pode diferir da base preparada, que permanece imutável no vínculo. Reconciliação somente observacional preserva esse draft e `BASE_CHANGED`, bloqueando nova publicação/promoção. `read-ci` aceita o draft confirmado ou observado para consultar metadados; mudança de base continua sem liberação. A UI local/portal mostra URL e diferença entre bases, sem repetir push/criação para descobrir o resultado.

Consulta de CI distingue `BASE_CHANGED`, listagem incompleta, ausência, pendência, falha, resultado não success e `REMOTE_CHECKS_PASSED`. Um resultado success da API não observa checkout real nem cobertura obrigatória, portanto continua **`ciVerified=false`**. A leitura não dispara CI, merge, deploy ou instalação; repetição de metadados semanticamente iguais não acrescenta eventos ao journal.

## Objetos e invariantes atuais

Proposta: `{summary, files:[{path,beforeSha256,edits:[{before,after}]}]}`. Cada literal existe uma única vez na fonte integral e está presente na view recebida; sobreposição ou criação do alvo de outra edição é recusada. Limites: 20 edições por arquivo, 4.000 bytes por literal e 8.000 bytes somados por proposta. Arquivo novo usa uma única edição com `before` vazio. Proposta manual pode usar `content` integral em vez de `edits`, nunca ambos. Não há operação de exclusão de arquivo.

Auditoria do servidor usa horário, organização, ação, versão e hashes/metadados sanitizados. Histórico da tarefa usa estado anterior/novo, versão, evidência, `previousEventHash` e `eventHash`. Os registros privados de contexto/tarefa contêm pedido/código para retomada; o ledger de auditoria não contém prompt bruto, patch, ticket ou credencial. A autoridade permanente da sessão é referência factual com escopo; não fabrica identidade pessoal, recibo de MFA, review GitHub ou novo grant.

Mutações de tarefa usam lock e `expectedVersion`; o servidor calcula e revalida os fingerprints. Criação de contexto/tarefa gera um ID novo por POST, sem chave de idempotência implementada. Operações são síncronas com limites; não existe API de jobs. Reenvio depois de timeout deve primeiro consultar tarefa/histórico e reconciliar a versão. Staging/preparo interrompidos preservam bloqueio, evitando repetir mutação cegamente.

`STATIC_CHECKS_PASSED` conserva `projectTests=NOT_EXECUTED_RUNNER_NOT_IMPLEMENTED`, `ci=NOT_CONFIGURED` e `deploy=NOT_PERFORMED`. O recibo de preparo declara `pushed=false` e `deployed=false`; o Publisher registra o envio posterior separadamente, sem reescrever esse recibo. Na UI local/portal, preparo depende de diff/fingerprint confirmado e revisão da versão; envio exige ação explícita com vínculo sanitizado. Isso não fabrica review GitHub, MFA local ou aprovação de deployment. Registro `registrationOnly=true` não concede permissão ao adaptador.

Configuração, manifesto, registros/workspace e arquivos usados pelos adaptadores server/Studio/Publisher/updater adotam `safe-read.cjs`. O helper abre descritor readonly, compara snapshots BigInt de tipo/identidade/metadados com o pathname pós-open, limita leitura em chunks ao tamanho inicial mais um byte e fecha o descritor em todos os caminhos. A última observação do pathname e fstat detecta substituição/modificação nos casos testados; não elimina todas as races em ancestrais/reparse points Windows. O adaptador de corpus legado permanece byte a byte preservado, com seu contrato de leitura próprio.

## Capacidades futuras

Catálogo de múltiplos projetos, runner de build/testes gerais, jobs, dispatch/validação do checkout real da CI, merge, deploy/HML, instalação e recuperação geral de release pela API Studio permanecem **NOT_IMPLEMENTED/NOT_CONFIGURED**. Publicação de draft, reconciliação de publicação e consulta observacional de CI já têm as rotas descritas. As antigas rotas planejadas `/projects`, `/proposals`, `/jobs`, `/releases` e `/tasks/:id/audit` não são contratos disponíveis no servidor 1.1.0.

O workflow de tráfego HML com CAS/rollback e aprovação real do titular está documentado em [docs/38](../firebase-migration/docs/38-hml-owner-release-governance.md). Esses controles existem fora da API Studio e não comprovam CI, HML, pin ou instalação desta candidata. O helper experimental permanece em `work/failsafe-spec/authgate-failsafe.py`, fora do repositório/pacote.

## Verificação necessária antes de declarar operacional

Os testes locais verificam autenticação/Host/Origin, ticket, tenant, classificação, paths, schema/limites, hashes/CAS, estados, truncamento, checks estáticos e contratos de publicação com transporte mock. Foram comprovados em execuções separadas **15 testes safe-read + 19 updater**, **18 UI local + 2 integração Studio/Publisher**. Não são recibos de PR remoto, modelo real, CI final, HML ou instalação.

`knowledge-registry.cjs` proveniente da instalação 1.0.1 está preservado byte a byte e testado com fixtures sintéticas. O servidor usa `stateDir/knowledge/knowledge_registry.v1.json`, conserva status/recibos e o Studio persiste `task.knowledge` com hashes, IDs e orçamento. A seleção Studio tem **600 bytes UTF-8**, incluindo cabeçalho e somente registros completos; `NO_RECORD_FITS`/`CONTEXT_LIMIT` não são absorção integral nem autorização para ampliar o orçamento. Corpus real, treinamento e funcionamento instalado da candidata não foram comprovados nesta engenharia.

Arquitetura e etapas: [AURORA_MASTER_STUDIO_ARCHITECTURE_20261008.md](AURORA_MASTER_STUDIO_ARCHITECTURE_20261008.md).
