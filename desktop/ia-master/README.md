# IA Master local — 1.1.0

Incremento AURORA-IA-MASTER-001 no mesmo AURORA NEXUS. Reutiliza o núcleo TypeScript e o componente Windows existente. O Studio prepara mudanças de engenharia com modelo local ou proposta manual, sem depender de ChatGPT.

O fluxo implementado é `contexto autorizado → tarefa persistida → proposta → diff → validação → worktree isolada → checks fixos → branch/commit LOCAL`, com **envio opt-in para PR draft, reconciliação e consulta de metadados CI** como etapas separadas. Está disponível na interface local e no portal pareado, sem ChatGPT. O checkout ativo e o cliente instalado são preservados. Preparo não executa push; o Publisher explícito faz somente o envio de engenharia descrito abaixo. Deploy, instalação, testes gerais locais e comandos escolhidos pelo modelo não são operações do Studio.

O código candidato declara **1.1.0**; a instalação/runtime observados permanecem **1.0.1**, preservados. Testes sintéticos e disponibilidade do código não comprovam atualização instalada, modelo real, CI do SHA final, PR remoto novo ou sincronização.

## Contexto, propostas e limites reais

- O operador configura um repositório Git e uma allowlist de arquivos relativos. O contexto usa blobs completos do `HEAD`, com SHA-256 por arquivo. Alterações ainda não commitadas não entram no contexto; mudança do `HEAD` bloqueia validação, staging e preparo de tarefas antigas.
- `/api/studio/capabilities` informa `repository.fileCatalog`, com tamanho e estado `EDITABLE`, `CONTENT_LIMIT`, `SENSITIVE_CONTENT` ou `UNAVAILABLE`, além de `limits`. Máximo: 10 arquivos, 30.000 bytes por arquivo e 50.000 bytes por contexto/proposta. Arquivo acima do limite é recusado integralmente. Nunca se corta um patch literal.
- O modelo recebe views explícitas de linhas completas, limitadas a 4.096 bytes UTF-8 por solicitação, incluindo objetivo e esquema. Por padrão, recebe prefixos proporcionais ao orçamento. `context.focus`, opcional, aceita `[{"path":"src/modulo.ts","startLine":20,"endLine":60}]` para escolher outro trecho. Linha que não cabe ou objetivo que esgota o orçamento bloqueia inferência. `task.modelContext` registra intervalos, hashes e se o contexto enviado era completo. O snapshot persistido e o conteúdo final continuam integrais.
- A inferência estruturada reserva 2.048 tokens de saída e 256 tokens para o template dentro de `num_ctx=8192`; o sistema e o pedido têm limite por bytes UTF-8. O método é um recorte declarado de até 600 bytes, não leitura integral nem treinamento. `done_reason=length` é recusado mesmo quando a resposta contém JSON válido.
- O modelo propõe `files:[{path,beforeSha256,edits:[{before,after}]}]`. Cada literal `before` deve existir uma única vez na fonte integral e na view recebida. Edições sobrepostas, alvos inexistentes/repetidos ou substituições que criem o alvo de outra edição são recusados. O backend aplica as posições originais em ordem inversa, preserva todo o conteúdo não editado e calcula o hash final.
- Máximo: 20 edições por arquivo, 4.000 bytes por literal e 8.000 bytes somados de literais por proposta. Para arquivo novo, uma única edição com `before` vazio. Proposta manual aceita `edits` ou `content` completo, nunca ambos.

`auroraFrontend.ts` possui cerca de 60 kB na baseline e não cabe inteiro. A estratégia é editar módulos menores autorizados, como os componentes de experiência e estilo, ou selecionar views de linhas desses módulos. Extrair componentes do frontend monolítico exige um patch próprio revisado; o Studio não o anuncia como já realizado.

Tarefas, contextos, versões e histórico com hashes persistem na pasta privada do componente. Locks e `expectedVersion` impedem mutações concorrentes da mesma tarefa. Essa memória de engenharia local não é um novo banco operacional nem substitui o checkpoint orgânico canônico no Firebase. Auditoria registra hashes/metadados; não registra prompts, respostas, patches, tickets ou credenciais. Os registros privados de tarefa/contexto contêm código e pedido para retomar a revisão.

## Configuração explícita e ponte do portal

Após a instalação autorizada de uma release limpa e verificada, salvar a configuração local revisada em `%LOCALAPPDATA%\AuroraNexus\integration\state\ia-master\studio-configuration.json`:

```json
{
  "schemaVersion": "aurora.master.local-config.v1",
  "orgId": "organizacao-autorizada",
  "repository": {
    "root": "C:\\caminho\\checkout-revisado",
    "gitExecutable": "C:\\Program Files\\Git\\cmd\\git.exe",
    "projectId": "aurora-canonical",
    "allowedPaths": ["firebase-migration/functions/src/auroraIaMasterView.ts"]
  },
  "portalOrigins": ["https://auroranexus.com.br"],
  "publisher": {
    "enabled": false,
    "authorizedOrgId": "organizacao-autorizada"
  }
}
```

Usar caminhos absolutos efetivamente revisados; o exemplo não autoriza qualquer checkout. A configuração persistida é vinculada à organização instalada e tem esquema fechado. Arquivo inválido desabilita repositório, ponte e Publisher. Sem esse arquivo, as variáveis `AURORA_STUDIO_CONFIG` e `AURORA_MASTER_PORTAL_ORIGINS` são aceitas para diagnóstico; valores herdados do terminal não se tornam configuração de startup. **Publisher não tem fallback por variável de ambiente.** Reiniciar o componente pelo ciclo autorizado para carregar mudanças.

A ponte permanece desligada por padrão. Só aceita as origens exatas explicitamente habilitadas `https://auroranexus.com.br` e `https://wmgj-hml-jfn-20260927.web.app`, sem curingas. A sessão do portal fica vinculada à origem e à organização, usa token próprio de 8 horas e não usa cookies cloud nem encaminha identidade Firebase. O portal revalida a organização devolvida pelo servidor.

`node manage.cjs pair-portal` copia somente um ticket aleatório de uso único, válido por 60 segundos, para colar na conexão local do portal. `control.key` nunca é copiada nem aceita de uma origem de portal. O ticket não aparece em logs. Logout/expiração revogam a sessão. A página HTTPS pode exigir permissão do navegador para rede local; preflight autorizado não comprova liberação do navegador ou da política institucional. O servidor permanece em `127.0.0.1:38765`, sem LAN ou endpoint público.

## Interface local e portal

A página local `http://127.0.0.1:38765/`, aberta por `node manage.cjs pair`, reutiliza a sessão cookie existente. `studio-local.js` oferece catálogo de arquivos, pedido, proposta local ou manual JSON, diff/revisão, cópia isolada, checks estáticos, versão local, envio para revisão e histórico. Código completo e recibos permanecem disponíveis para conferência. O pacote contém CSS e fontes locais; não depende de ChatGPT para esse fluxo.

O portal oferece o mesmo ciclo de engenharia após pareamento explícito. A view Master exige administrador com MFA e escopo de toda a organização no portal; a sessão loopback usa seu próprio vínculo de origem/organização. Isso não fornece MFA ao serviço local ou ao GitHub. Os controles habilitam somente capacidades confirmadas, descartam respostas tardias após saída e suspendem mutações quando o resultado precisa de releitura.

## Publisher draft e consulta de CI

O Publisher é **desligado por padrão**. Opt-in usa a configuração persistida acima, acrescentando `publisher.enabled=true`, `authorizedOrgId` correspondente à instalação, caminho absoluto de `ghExecutable` e hashes SHA-256 reais/revisados `ghSha256` e `gitSha256`. O Git continua sendo o executável do repositório configurado. Placeholders, caminho divergente, binário alterado ou organização incompatível invalidam a capacidade; a UI não concede esse acesso.

Destino fechado: conta `GESTAOWMGJ`, repositório `GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS`, base `main`, branch `aurora-studio/<taskId>`. A credencial é a já existente no gh CLI; o aplicativo não lê token, não herda `GH_TOKEN`/`GITHUB_TOKEN` e não comprova MFA GitHub. Configuração válida informa `CONFIGURED_AUTH_NOT_OBSERVED`; autorização real é consultada no início das operações. Modelo e formulário não escolhem comando, destino ou credencial.

Depois de revisar o diff e preparar a versão, **Enviar proposta para revisão** chama `publish-draft`. O adaptador revalida tarefa, versão, fingerprint, arquivos, commit/tree, base, executáveis e autorização; registra intenção; cria somente a branch própria ausente com lease e abre PR **draft**, com edição por mantenedores desabilitada. O corpo é construído com IDs/hashes/paths e enviado por stdin (`--body-file -`), sem prompt/summary/resposta do modelo ou arquivo temporário mutável. Confirma o resultado remoto por head/base/repo/PR. Código publicado deve ser engenharia sanitizada: dados de clientes, corpus privado e credenciais ficam fora do envio. Não há merge, dispatch, deploy ou instalação por essa operação.

**Verificar publicação** chama `reconcile-publication`, consultando o resultado remoto sem criar branch/PR e preservando journal local. Resultado ambíguo não autoriza repetir criação cegamente: ausência após criação incerta exige duas observações separadas por pelo menos 60 segundos e nova ação explícita. Mudança da base ou conflito conserva o recibo e bloqueia promoção; não há force push de branch existente ou rebase automático.

Quando `main` avança durante a criação, o resultado pode conservar `observedPullRequest`: draft encontrado com número/URL, head e base realmente observada. A base preparada permanece no recibo original; `BASE_CHANGED` bloqueia publicar/promover essa versão. As interfaces mostram a diferença e permitem consulta de CI desse draft somente como metadados. Observar o resultado não cria outro PR nem reescreve a proposta.

**Consultar testes GitHub** chama `read-ci`. O recibo informa check-runs/runs associados ao SHA preparado e a base atual. Mesmo `REMOTE_CHECKS_PASSED` conserva `ciVerified=false`, `actualCheckout=NOT_OBSERVED` e `requiredCoverage=NOT_OBSERVED`: a API não prova checkout real/cobertura obrigatória nem libera a versão. Consulta não dispara workflow, merge, deploy ou instalação. `publicationVersion`/journal são separados de `taskVersion`; o recibo de preparo `pushed=false` continua sendo o registro da etapa local anterior.

## Proteções e checks executáveis

Host/origem estritos, verificação do endereço remoto, JSON e cabeçalho próprio nas mutações. Pareamento local usa cookie HttpOnly/SameSite=Strict; Secure não é aplicado ao HTTP loopback. Pasta de estado instalada usa ACL do usuário Windows atual e SYSTEM.

Somente PUBLIC/INTERNAL de engenharia sanitizada são aceitos. Nunca inserir dados clínicos, pessoais identificáveis, financeiros reais ou secrets. O filtro de padrões é defesa adicional, não detector completo. O modelo não tem shell, ferramentas, credenciais cloud ou fallback externo. Ollama usa `127.0.0.1:11435` e `OLLAMA_NO_CLOUD=1`. A fronteira de confiança inclui a conta Windows e processos locais; não há MFA local nem isolamento contra usuário hostil da mesma conta.

`safe-read.cjs` abre descritor readonly, usa `O_NOFOLLOW`/`O_NONBLOCK` quando o OS fornece essas flags, verifica tipo/tamanho e compara snapshots BigInt de identidade/metadados por descritor e pathname após abrir. A leitura em chunks fica limitada ao tamanho inicial mais um byte; mudança, symlink, arquivo incompatível ou limite excedido bloqueiam o retorno. O descritor é fechado em sucesso/falha. Server, Studio, Publisher e updater usam esse helper nos seus contratos de leitura. Checks de ancestrais continuam existentes; isso não elimina todas as races em ancestrais/reparse points Windows ou substitui isolamento da conta. O módulo legado de conhecimento permanece byte a byte preservado e mantém seu próprio leitor.

O staging cria worktree detached sem checkout e materializa blobs brutos para evitar hooks e filtros smudge/clean. Git usa ambiente reduzido, hooks desabilitados, fsmonitor desabilitado e commits sem assinatura automática. Árvores com symlinks, submódulos, credenciais, nomes inseguros ou colisões de nomes são recusadas. Só o template exato `.env.example`, validado sem padrão de segredo, pode ser materializado.

`SYNTAX_AND_DIFF_V1` executa somente `node --check` em JS/CJS/MJS, parse de JSON e `git diff --cached --check`. TS/TSX, HTML, CSS e textos recebem integridade textual, sem compilação semântica. `STATIC_CHECKS_PASSED` significa esses checks fixos; a resposta conserva `projectTests=NOT_EXECUTED_RUNNER_NOT_IMPLEMENTED`, `ci=NOT_CONFIGURED` e `deploy=NOT_PERFORMED`. A worktree, índice, blobs e hashes são revalidados antes do commit local criado com `commit-tree` e `update-ref` exclusivo.

## Build, validação e continuidade

Em checkout revisado com Node >=22 e dependências TypeScript já disponíveis:

```powershell
python desktop/ia-master/build.py --output C:\caminho\novo-pacote
$env:AURORA_TEST_BUILD='C:\caminho\novo-pacote'
$env:AURORA_STUDIO_TEST_GIT='C:\Program Files\Git\cmd\git.exe'
node --test desktop/ia-master/server.test.cjs desktop/ia-master/studio.test.cjs desktop/ia-master/publisher.test.cjs desktop/ia-master/studio-local.test.cjs
node --test desktop/ia-master/knowledge-registry.test.cjs desktop/ia-master/update.test.cjs desktop/ia-master/safe-read.test.cjs
python -m unittest discover -s desktop/ia-master -p test_build.py
```

O build não baixa modelos nem instala componentes. Manifesto/ZIP incluem Studio, Publisher, adaptador de conhecimento, safe-read, updater, servidor/gerenciador, UI/fontes locais e kernel compartilhado. O manifesto registra SHA e `dirty`; o gerenciador recusa instalação/gestão de build dirty. Pacote de trabalho dirty permite revisão e testes sintéticos, não liberação instalada.

Para instalação futura, revisar CI do SHA final, hash do pacote, Node >=22, runtime oficial Ollama v0.35.1 standalone e modelo `qwen3:8b` com digest registrado. Conferir assinatura/digest do runtime segundo o procedimento aprovado. O gerenciador preserva a instalação/atalho principal e recusa estado já existente. Um processo instalado 1.0.1 divergente deve permanecer operando até um fluxo de atualização e rollback revisado; `start` 1.1.0 bloqueia conflito antes de iniciar/encerrar processos. Este componente não implementa atualização automática da instalação existente.

Testes locais usam fixtures sintéticas, Git temporário, inferência e transporte GitHub mock. Foram comprovados em execuções separadas de 12/10 **15 testes safe-read + 19 updater** e **18 UI local + 2 integração Studio/Publisher**. Modelo real, pareamento no navegador, instalação, CI final, HML e PR remoto novo exigem evidências próprias. `/health` identifica o manifesto observado no início do processo, sem afirmar pin cloud, integridade em disco ou instalação certificada. `/api/status` distingue modelo disponível, conhecimento, sessão, repositório/Publisher e sincronização `NOT_VERIFIED`.

## Atualização explícita da instalação existente

`update.cjs` atende somente à baseline Windows 1.0.1, fonte `041920fe44e09e5d8c0b05f558a5ad5442af782d`, já identificada neste PC. A candidata 1.1.0 deve estar limpa, possuir manifesto e hashes conferidos, preservar todos os arquivos anteriores e o adaptador de conhecimento byte a byte. A configuração, corpus, modelo, credencial local, cliente principal e atalhos permanecem no mesmo destino. A pasta física `components/ia-master/1.0.1` é mantida para preservar os atalhos existentes; a versão efetiva vem do manifesto, não do nome da pasta.

O operador prepara um JSON local de opções com `root`, `startup` e `candidate` absolutos, `sourceRevision` da candidata, `baselineManifestSha256` e `manifestSha256`. Os valores precisam corresponder à instalação do usuário atual e aos bytes do pacote de CI revisado. Não há credencial nessa entrada. Invocação, usando o Node >=22 já instalado:

```powershell
node C:\caminho\candidata\update.cjs preflight C:\caminho\opcoes-revisadas.json
node C:\caminho\candidata\update.cjs update C:\caminho\opcoes-revisadas.json
```

`preflight` verifica pacote/baseline sem atualizar. `update` exige Master parado e porta livre; não encerra processos por conta própria. Lock, backup, staging, troca de diretório e readback conservam o predecessor. Falha tenta retorno somente se os hashes ainda corresponderem à própria tentativa. Alteração concorrente ou backup adulterado bloqueia a recuperação e preserva a evidência. A ausência da entrada de startup é preservada.

Metadados legados e opções CLI aceitam um BOM UTF-8 inicial produzido por ferramentas Windows. O parser normaliza somente a view de leitura; hashes, CAS, backup e rollback continuam usando os bytes originais. Manifestos e recibos permanecem estritos.

O resultado `UPDATED_FILES_VERIFIED_RUNTIME_NOT_VERIFIED` comprova somente os arquivos. Iniciar pelo atalho existente e conferir `/health`, conhecimento, sessão, modelo e fluxo de tarefa antes de registrar aceite operacional. A reversão explícita usa `node C:\caminho\candidata\update.cjs rollback C:\caminho\opcoes-revisadas.json`, com `backup` e `receiptSha256` reais acrescentados às opções e processo parado. O retorno também exige readback do runtime original. Os testes usam instalações temporárias sintéticas; não constituem recibo desta atualização no PC do titular.

## Conhecimento e interface

O adaptador de conhecimento da instalação 1.0.1 foi preservado **byte a byte** no source/pacote candidato e testado com fixtures sintéticas. Continua usando `stateDir/knowledge/knowledge_registry.v1.json`; não copiou/leu o corpus real ou atualizou o runtime nesta engenharia. `/api/status` distingue registros carregados de absorção histórica declarada pelo corpus. `/api/improve` e propostas Studio registram recibo com hash, IDs selecionados e orçamento; não incluem o conteúdo dos registros na auditoria. O Studio conserva **600 bytes UTF-8**, incluindo o cabeçalho, e seleciona somente registros completos que caibam. `NO_RECORD_FITS`/`CONTEXT_LIMIT` não permitem truncar registros ou ampliar o orçamento. Registro carregado não significa que todos os registros entraram em cada pedido; seleção não é treinamento.

O portal oferece foco opcional no formato `src/modulo.ts@20-60`, um intervalo por arquivo selecionado, e mostra os intervalos efetivamente recebidos pelo modelo. Arquivos completos continuam no contexto privado da tarefa; o recorte não modifica o patch por truncamento.

Desligar o componente: `node manage.cjs stop --disable-startup` da release verificada encerra somente processos correspondentes nas portas próprias e remove apenas a entrada de startup correspondente. Preserva modelo, dados privados, auditoria, cliente e integrações; não restaura uma versão anterior. Propostas isoladas não são aplicadas ao cliente por esse fluxo. CI/HML, revisão e rollback do projeto continuam necessários antes de promover qualquer draft publicado.
