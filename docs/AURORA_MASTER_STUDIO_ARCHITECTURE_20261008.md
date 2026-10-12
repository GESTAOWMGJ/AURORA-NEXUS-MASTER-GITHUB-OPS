# Master Studio: desenvolvimento pela interface Aurora

Atualização factual de 12/10/2026, no checkout `feat/account-security-controls`. O componente local declara versão **1.1.0** e já implementa contexto, tarefa persistida, proposta, diff, staging, checks estáticos e branch/commit local. As capacidades futuras permanecem separadas. Código e testes locais desta candidata não comprovam CI do SHA final, HML, instalação, sincronização ou publicação.

## Finalidade

O titular pediu um Master completo para desenvolver aplicações com a IA dentro da interface Aurora, sem depender da interface ChatGPT. O ponto de partida é o componente local IA Master existente: interface, sessão privada e modelo local pertencem ao Aurora. A autorização permanente desta sessão permite continuar a engenharia e as entregas reversíveis no escopo registrado em [AURORA_AUTONOMY_FAILSAFE_20261008.md](AURORA_AUTONOMY_FAILSAFE_20261008.md), preservando identidade, MFA aplicável, credenciais com escopo, testes e evidências. A autorização não transforma uma resposta do modelo em credencial ou em código autorizado a executar.

## Evidência do código atual

| Componente | Comportamento existente | Limite verificado |
| --- | --- | --- |
| `desktop/ia-master/server.cjs` | Servidor Node **1.1.0** em `127.0.0.1:38765`; sessão local, Host/Origin estritos, JSON/cabeçalho próprio, tickets descartáveis, ponte opt-in do portal vinculada à origem/organização e auditoria de hashes. | Ponte desligada por padrão; sem MFA local ou endpoint LAN. Não há push, deploy, instalação ou runner de testes gerais. |
| `localChat` no mesmo arquivo | Inferência `qwen3:8b` em Ollama `127.0.0.1:11435`, sem redirecionamento nem fallback externo; uma inferência por vez. Studio usa JSON estruturado, `num_ctx=8192`, reserva de 2.048 tokens de saída e recorte do método de até 600 bytes. | Pedido do Studio limitado a 4.096 bytes UTF-8, com views explícitas; saída truncada é recusada. A rota antiga `/api/improve` conserva `num_predict=512` e proposta somente. Modelo não recebe ferramentas. |
| `/api/improve` e `desktop/ia-master/app.js` | Objetivo de engenharia, proposta em português, cache de 16 entradas, exportação explícita de JSON. | `PROPOSAL_ONLY`, `applied=false`; conteúdo e propostas ficam em memória, auditoria armazena somente hashes. |
| `/api/native` | Reutiliza `buildMasterOperationalState` do kernel compilado. | `LOCAL_UNVERIFIED_PREVIEW`; não autentica a origem do snapshot importado. |
| `desktop/ia-master/studio.cjs` | Contexto do Git `HEAD`, catálogo permitido, foco opcional por linhas, hashes, tarefas persistidas, locks/CAS por versão, proposta local ou manual e diff. | Até 10 arquivos, 30.000 bytes por arquivo e 50.000 bytes no conjunto. Código e pedido ficam nos registros privados; auditoria usa hashes/metadados. Não é um banco operacional novo. |
| Staging, `SYNTAX_AND_DIFF_V1` e preparo | Worktree detached sem checkout, blobs brutos em batch, revalidação de base/índice/hashes; `node --check`, parse de JSON e `git diff --cached --check`; `commit-tree` e `update-ref` exclusivo criam branch local. | TS/TSX/HTML/CSS/texto recebem integridade textual. `projectTests=NOT_EXECUTED_RUNNER_NOT_IMPLEMENTED`, `ci=NOT_CONFIGURED`, `pushed=false`, `deployed=false`. `STATIC_CHECKS_PASSED` não significa suíte do projeto aprovada. |
| Portal e `auroraIaMasterClient.ts` | Studio visível a administrador com MFA e escopo de toda a organização; ticket de uso único cria token local separado da sessão Firebase. Logout/perda de autorização encerra a view e descarta respostas tardias. | Serviço precisa estar no mesmo PC do navegador. Não encaminha identidade/cookies Firebase nem concede permissões cloud. |
| `firebase-migration/functions/src/auroraIaMaster.ts` | Ordem regra nativa, modelo local, externo desativado; gates de patch isolado, testes, revisão de segurança, CI, HML e rollback. | `arbitraryCodeExecution=false`, `sourceMutation=false`; GitHub é integração que exige credencial própria no runtime. |
| `auroraNativeRoutines.ts` | Adendo de autonomia resolutiva legível pelo motor; autorização persistente da sessão. | `registrationOnly=true`, `permissionsGranted=false`, executor `SPECIFIED`; recuperação cloud automática ainda sem validação de runtime. |
| `auroraOrganicCore.ts`, `auroraOrganicService.ts` e schema `organic-patcher.schema.json` | Propostas versionadas, execução de relatórios com operações fixas, comparação de revisão e invalidação por mudança da evidência. | Executor read-only não interpreta código gerado; schema mantém `executionMode=READ_ONLY`, `activationAllowed=false`. Não serve de autorização para editar repositórios. |
| `desktop/ia-master/build.py` / `manage.cjs` | Empacota kernel compartilhado, captura SHA/dirty, hashes e gerencia processos correspondentes ao componente. | Manifesto observado não é prova de integridade do processo, recibo da instalação ou pin canônico cloud. |

## Componentes implementados e próximos incrementos

1. **Interface Aurora local e portal:** Studio com objetivo, seleção de contexto/trecho, tarefa, proposta, diff, checks e preparo local. A sessão privada existente e o pareamento local são reutilizados; publicação/instalação permanecem indisponíveis.
2. **Planejador local:** regras nativas escolhem o próximo passo; Qwen redige explicações e uma proposta estruturada. Ausência do modelo permanece visível, sem encaminhamento a um provedor externo. A API valida o objeto antes de usá-lo.
3. **Contexto de engenharia:** catálogo explícito de repositórios e arquivos permitidos, fixado a SHA/base. Importação exclui links simbólicos, caminhos que escapam da raiz, binários, credenciais, configuração secreta, documentos pessoais e evidência bruta de tenant. Apenas PUBLIC/INTERNAL sanitizado entra na inferência. Conhecimento versionado é contexto; treinamento de pesos permanece desligado.
4. **Registro local de trabalhos, implementado:** contextos, código, pedido e propostas de engenharia ficam no diretório privado do componente, com IDs opacos, versão, hashes, estados e CAS. A auditoria conserva metadados/hashes. Tickets, cookies, tokens e segredos não pertencem a esses registros. Hashes encadeados detectam corrupção; não autenticam um dono hostil da máquina.
5. **Patch isolado, implementado:** literais únicos `before/after`, sem sobreposição e sem criar o alvo de outra edição; a fonte integral e a view recebida são conferidas. Proposta manual também aceita conteúdo integral. Staging preserva o checkout ativo, materializa blobs brutos sem hooks/filtros e recusa drift; não executa comandos escolhidos pelo modelo.
6. **Verificação estática, implementada; runner do projeto, futuro:** somente `SYNTAX_AND_DIFF_V1`. Builds e testes semânticos do projeto ainda exigem um runner isolado com receitas confiáveis, limites e credenciais/rede contidas. Uma allowlist de comando não torna scripts do projeto seguros.
7. **Git local, implementado; CI/publicação, futuros:** preparo cria branch/commit local com base e fingerprint revalidados. Não há endpoint de push, PR, CI, deploy ou instalação. A promoção posterior segue os workflows protegidos e provas reais do repositório; a sessão da conversa não fornece credenciais ao runtime.
8. **Recuperação com escopo explícito:** falhas locais preservam `STAGING_BLOCKED`, `CHECK_FAILED` ou `PREPARATION_BLOCKED`; não repetem staging/preparo cegamente. A main `1a2e483` já contém CAS/readback e rollback do tráfego do AuthGate HML, conforme [docs/38](../firebase-migration/docs/38-hml-owner-release-governance.md). Isso não é um endpoint de recuperação do Studio, rollback de dados ou prova de deploy desta candidata.

## Estados e semântica

O ciclo implementado é `CONTEXT_BOUND → PROPOSED → VALIDATED → STAGING → PATCH_STAGED → STATIC_CHECKS_PASSED → PREPARING_VERSION → VERSION_PREPARED`. `PREPARED_LOCAL_ONLY` identifica o commit local. `TESTED`, `CI_VERIFIED`, `HML_VERIFIED` e entrega instalada/publicada exigem provas posteriores, fora desse contrato local.

`STAGING_BLOCKED`, `CHECK_FAILED` e `PREPARATION_BLOCKED` preservam histórico, versão e erro sanitizado. Estados genéricos de recovery permanecem planejamento; o servidor não os anuncia como operações executadas. Capacidades e limites são observados em `/api/studio/capabilities`, sem concessão de acesso.

## Entregas graduais verificáveis

| Incremento | Entrega | Critério de aceite |
| --- | --- | --- |
| S1 | Interface, sessão/ponte e proposta: código implementado, testes locais. | Modelo real, pareamento no navegador e disponibilidade do serviço precisam de recibos próprios. |
| S2 | Catálogo, views de contexto e registros persistidos: implementados. | Fixtures verificam limites, tenant, paths, hashes e estados; importação de corpus real e aprendizado de pesos não são comprovados. |
| S3 | Validação, worktree isolada e commit local: implementados. | Fingerprint/CAS e checks fixos são separados dos testes semânticos e da aplicação no cliente. |
| S4 | Checks estáticos implementados; runner isolado de projeto ainda não implementado. | Builds/testes gerais exigem isolamento, limites, rede/credenciais controladas e prova do runner. |
| S5 | Git/CI/HML dentro da interface Aurora. | Runtime autenticado com escopo mínimo; PR/run/artefato e readback reais; promoção respeita gates protegidos; rollback específico demonstrado. |
| S6 | Aprendizado abstrato e manutenção contínua. | Resultado validado, regressão e abstração por tenant; sem dados brutos no registro compartilhado; nenhuma autoatribuição de permissão. |

## Limitações operacionais atuais

O contrato oferece ponte opt-in com CORS exato, token próprio e vínculo de origem/organização. Loopback continua sendo o PC do navegador; acesso de outro dispositivo não chega ao Xeon por esse endereço. A disponibilidade depende do PC ligado e do serviço disponível. Não há MFA local, alta disponibilidade ou isolamento contra processos hostis da mesma conta Windows.

O helper experimental está em `work/failsafe-spec/authgate-failsafe.py`, fora do repositório e do pacote. Ele não é o executor vigente do workflow nem evidencia recuperação desta candidata. O mecanismo integrado da main é `firebase-migration/scripts/promote-hml-authgate-traffic.mjs`, com limites documentados em docs/38.

A preservação da `knowledge-registry` proveniente do componente instalado 1.0.1 está sendo reconciliada e testada nesta candidata. Não declarar importação de corpus real, treinamento, instalação ou funcionamento dessa compatibilidade antes de sua evidência específica.

Evidência local de 12/10: 24 testes de runtime/onboarding, 5 de serving/CSP, 23 de preflight e 16 métodos do contrato/workflow HML aprovados em execuções separadas; o último probe Windows cobriu 20 cenários em 289,732 s, após corrigir o harness de streams. Essa evidência verifica os escopos citados, não modelo real, CI do SHA final, HML, instalação ou publicação.
