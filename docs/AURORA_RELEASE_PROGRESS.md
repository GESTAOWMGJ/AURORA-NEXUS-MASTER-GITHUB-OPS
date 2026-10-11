# AURORA NEXUS — progresso até a versão vendável

## Release train

- Produto: **1.0.0-rc.1**
- Política operacional: **2.3.0**
- Motor orgânico: **1.2.0**
- Native Intelligence: **0.1.0**
- Piloto de referência: **WMGJ Operação**
- Baseline de código: `main` pós-PR #39

## O que já é produto

- login-first, sessão e membership;
- Firestore protegido e tenant WMGJ;
- módulos M01–M10 e M03.1;
- dashboard SHADOW;
- ações de auditoria com evidência;
- AURORA-ORG-001 AUDIT/FINANCE;
- deploy HML protegido e smoke autenticado;
- retomada/idempotência do fluxo orgânico;
- Native Intelligence v0 sem provedor externo, neste RC.

## Bloqueios objetivos

### Portal canônico e cutover HML — 08/10/2026
`AURORA-CANONICAL-PREFLIGHT-001`: o workflow verifica DNS resolvido, HTTPS com
certificado válido, formulário de login utilizável, negação anônima do bootstrap
e `init.json` ligado ao projeto HML aprovado antes da autenticação de nuvem.
Redirect é recusado, inclusive o loop portal → Firebase técnico → portal.
Os smokes público e autenticado usam `https://auroranexus.com.br`; login,
membership, MFA, CSRF e gates do release assinado continuam na autoridade Firebase.
Patch candidato sobre `de1ae74d88fdec711c6ed89fe29fe1dd755d0bc7`, com regressões
sintéticas; não comprova DNS/TLS emitido, implantação, login real, ingestão ou GA.
Responsável operacional: titular do domínio e maintainer HML. Próximo gate:
concluir DNS/TLS apontando ao roteamento revisado do gateway com o AuthGate
Cloud Run existente, executar preflight real e CI no SHA final antes do deploy HML.
Rollback: reverter o patch e restaurar a revisão conhecida do gateway; preservar
sessão, banco existente e backups, sem publicar redirect técnico antes do cutover.

### Projeto de produção — 05/10/2026
`AURORA-PROD-PROJECT-001`: produção permanece `BLOCKED_PROJECT_NOT_VALIDATED`.
Request v2 e domínio mantêm ID/número nulos; candidato recusado somente histórico.
Bootstrap/workflow exigem contrato explícito e consulta GCP read-only bem-sucedida
antes de provisionar. Criação de projeto e vínculo automático de billing removidos.
Patch baseado em `68467209`; testes sintéticos não constituem produção verificada.
HML e recursos de produção preservados. [Contrato e próximo gate](../firebase-migration/docs/38-production-project-contract.md).

### Ingestão real
Não liberar enquanto faltar ensaio real de restore e promoção governada da identidade/keyring de ingestão.

### Desktop
Não tratar launcher HML como sucessor do aplicativo funcional. Inspecionar a baseline instalada e validar atualização in-place/rollback.

### Collective Intelligence
Privacy Gate → Knowledge Capsule → Knowledge Registry → Pattern Matcher permanece o próximo grande módulo de produto; não deve receber dados brutos de outro tenant.

## Definição de avanço por prompt

Toda solicitação relevante deve:
1. gerar ou atualizar patch;
2. adicionar teste;
3. alterar um gate ou explicar por que não altera;
4. manter rollback;
5. reportar SHA/CI/deploy separadamente;
6. escolher o próximo bloqueio de maior impacto.

## Próximos incrementos recomendados

1. fechar recovery gate e liberar amostra operacional real WMGJ;
2. implementar M12 Collective Intelligence em modo PRIVATE/COLLABORATIVE;
3. consolidar a IA nativa com Knowledge Registry e Pattern Matcher;
4. validar atualização do app Mac instalado;
5. hardening comercial, domínio, distribuição e documentação;
6. promover RC aprovada para `1.0.0` GA.


## Candidato desktop — 02/10/2026 — PR #95

Componente `imac-bootstrap-hardening-1`, sem alterar o release train do produto.
Baseline da branch preservada: `ad50a0b4484d4d399a845513a40d57c52cff269e`; main reconciliada:
`ee4d274bf27e36b293f2043fe2d4d818ea965c3d`.

- Implementado no candidato: dry-run por padrão; apply/host explícitos; staging;
  validação shell/JSON/PLIST; backups; rollback em falha; espelho fast-forward-only.
- Testes: fixtures offline de segurança, idempotência e rollback em
  `tools/imac/tests/test_bootstrap.py`; o workflow de instaladores cobre Ubuntu/macOS.
- CI do SHA final deve ser conferido no PR; checks anteriores não liberam o patch.
- Gate desktop/comercial permanece bloqueado: falta teste autorizado no iMac real,
  Node 16/High Sierra, retorno remoto e rollback nativo comprovado.
- Não é atualização do .app original, instalação realizada, ingestão ou deploy.
  Runbook/limites e responsável sugerido em `tools/imac/README.md`.
- Preflight nativo somente leitura disponível; Node major 16 é obrigatório antes
  de qualquer escrita. Inventário após despacho de reinício não comprova reinício
  concluído, disponibilidade atual ou retorno remoto de conteúdo.

## Correção candidata de status do iMac — 03/10/2026 — PR #95

Baseline: head `8a23778e7886b34a963b138294292b2a0dec5c39`, contendo a main
`91665cc94c4bde9b82a75cd39905263c60e02191`. Produto permanece 1.0.0-rc.1.
M08/M10: o helper de status troca a busca textual de argumentos pela consulta
do PID gerenciado, executável Node e estado. Emite PRESENT/ABSENT/UNKNOWN como
presença de processo, horário UTC e conectividade UNKNOWN; não emite ONLINE/OFFLINE.

Validação local: 39 testes offline aprovados (12 novos), incluindo Node sem
argumento console, wrapper ainda em shell, PID inválido/duplicado, processo zumbi
e falhas de consulta. CI do novo SHA e homologação High Sierra ainda são gates
separados. Nenhuma instalação, reinício ou novo disparo remoto neste incremento.

## Retorno automático de status do iMac — 03/10/2026 — PR #95

Atualiza o estado histórico das seções anteriores. Helper validado no High Sierra
10.13.6/x86_64, Node v16.20.2, a partir do SHA 55296288; substituição isolada com
backup usando 2bb6672, sem reinício. A falta de `{{result}}` em voiceReply impedia
o retorno esperado. Após o ajuste local, o TRIGGERcmd devolveu diretamente o
JFN_MAC timestamp=2026-10-03T15:27:42Z, PROCESS_PRESENT, managed_pid=1337.
Janela da chamada: 15:27:32.654Z–15:27:44.135Z. Evidência de uma resposta textual,
sem código de saída nativo e sem homologação de app, HML ou disponibilidade contínua.

O candidato incorpora o mesmo voiceReply. A origem do helper conserva dois blobs
exatos revisados, ambos com o mesmo helper; recibos e backups anteriores continuam
compatíveis. A branch incorpora a main 5dcaddc88b27b54a7f24f9042b05e9799205fb1a,
incluindo seus três arquivos de HMAC sem alteração própria. CI deve ser conferido
no SHA final do PR. Não é merge, deploy nem aplicação do bootstrap no iMac.
Próximo gate: revisão do candidato reconciliado e ensaio nativo autorizado de
rollback/instalação completa; não repetir o teste remoto de status já aprovado.

## Preparação do ensaio nativo completo — 03/10/2026 — PR #95

Revisão do SHA 1869e75: pós-apply ainda usava pgrep por argumentos, e reversão
após aplicação bem-sucedida dependia do runbook manual. O pós-apply passa a usar
o helper de PID/executável validado, sem sendresult. O teste nativo preparado
faz duas aplicações e restaura os seis alvos da baseline, com hashes, permissões,
backup privado e verificação do processo. Recusa sobrescrever edição concorrente
ou usar backup corrompido. Não marca sucesso quando a restauração dos arquivos
termina mas o serviço não retorna. A origem aceita continua fixa em blobs exatos;
o helper permanece byte a byte igual ao validado no High Sierra.

Autorização do titular abrange revisão/ensaio de bootstrap e rollback. Não houve
execução nativa deste novo ensaio ainda: TRIGGERcmd oferece apenas comandos
cadastrados e Desktop Commander continua sem o iMac. O próximo passo é iniciar
TEST_NATIVE_BOOTSTRAP.js --exercise no Terminal local, no SHA final com CI aprovado,
e correlacionar o retorno remoto após restauração. PR permanece draft; não há
merge, deploy, atualização de app nem homologação HML por este preparo.
Rollback de código: reverter este incremento na branch; o script instalado
permanece intacto. Próximo gate: executar o ensaio completo no iMac e confirmar
o retorno remoto após a restauração da baseline.
