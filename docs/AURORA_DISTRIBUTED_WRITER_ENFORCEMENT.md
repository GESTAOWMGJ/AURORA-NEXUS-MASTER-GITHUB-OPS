# AURORA — enforcement gradual do lease canônico

Incremento 1.1.0 do **AURORA-REALTIME-PLATFORM-GUARDIAN-001**, sobre
`eef855d8ffbfd5ca63d3410bfba1cefd4863a48f`. Estado: implementação parcial candidata.
Base posterior incorporada: `e3b75f52aaeda25dc70d022f88b10725ae570bf9`
(PR #364, ordem do tráfego HML), com atualização do inventário após revisão do delta.
Não constitui implantação, handoff físico, inventário instalado ou enforcement
universal. `allLegacyWritersEnforced=false` permanece no registro nativo e cockpit.

## Fato comprovado na fonte

O guardião 1.0.0 era um decisor local sem armazenamento compartilhado. O nome da
plataforma bastava para renovar o lease: duas instâncias CLOUD_CONTROL_PLANE não
eram distinguíveis. O smoke e a política não protegiam commits dos handlers.

A implementação canônica agora reside em
`firebase-migration/functions/src/realtimePlatformGuardian.js`; o caminho antigo
em `scripts/aurora/realtime_platform_guardian.js` apenas a reexporta. O compilador
inclui o mesmo módulo no pacote Functions. Não existem duas implementações do
árbitro, nem uma nova fila, agenda ou tabela de idempotência.

## Fronteiras migradas nesta candidata

| Fronteira existente | Caminho | Proteção candidata |
| --- | --- | --- |
| Ingestão HMAC usada pelo bridge Apps Script | `index.ts:ingestWmgjEvent` | Transação de entidade, versão, recibo, nonce, auditoria e checkpoint |
| Documento canônico de coletor/Xeon/API/manual | `auroraIntegrationRuntime.ts:auroraNexusIntegrationDocuments` | Mesma chave `apiIdempotency`, mesma entidade e versão |
| Observação documental pendente | Mesmo handler, `recordDocumentObservation` | Mesma transação e recibo de observação |
| Relato de agente | `auroraNexusIntegrationPing`, POST | Checkpoint autenticado por organização |
| Configuração de automação | `auroraNexusIntegrationKeys`, CONFIGURE_AUTOMATION | Transação existente, com revogação revalidada |
| Conclusão de instalação | `auroraRuntime.ts:completeInstallation` | Mesmo checkpoint; prova de ingestão permanece obrigatória |
| Projeção nativa | `auroraRuntime.ts:refreshProjection` | Fontes, snapshots e auditoria na mesma transação |
| Comandos internos | `auroraRuntime.ts:auroraNexusAction` | Mesmo comando, idempotência e auditoria |

| Memória orgânica | `auroraOrganicRuntime.ts`, POST | Mesmo checkpoint, revisão e recibo; GET permanece somente leitura |
| Observação orgânica automática | `auroraOrganicAutoObserve.ts` | Transação original, falha isolada preservada |
| Decisão financeira | `auroraFinancialDecisionRuntime.ts` | Mesmo snapshot/MFA/idempotência; sem movimentação financeira |
| Relatório societário | `auroraShareholderReportRuntime.ts` | Mesmo evento/versão, sem duplicação no replay |
| Pré-credenciamento | `auroraMedicalPartnerRuntime.ts`, quatro fronteiras | Convite, submissão, reserva e recibo documental; precondição nativa do Storage permanece fora do callback |
| Credenciais de integração | `auroraIntegrationRuntime.ts`, CREATE/REGISTER_HASH/REVOKE | Mesma identidade/hash, revogação do administrador revalidada no commit; replay de revogação não muda recibo |
| Perfis e onboarding | `auroraUserProfiles.ts`/`auroraOnboardingInvitations.ts`, sete caminhos de mutação | Reserva, membro pendente, conclusão, recuperação, revogação, convite e consumo recebem orgId explícito no store guardado |
| Vigilância documental | `auroraDocumentGovernance.ts:syncDocumentGovernance` | Fonte/organização/ação relidas no commit de cada item, sem lote concorrente; falha preserva os outros itens |
| Expiração de locks legados | `index.ts:runtimeWatchdog` | Mesmo lease; expiração revalidada pelo readTime do destino; sem apagar epoch ou alterar locks do guardião |
| Autoteste criptográfico | `auroraCryptoRuntime.ts`, três fronteiras | Reserva, sucesso e erro usam o mesmo guardião e runId; KMS permanece fora do callback |

São **31 fronteiras transacionais**, não 31 plataformas instaladas ou todos
os writers do repositório. O escritor efetivo dessas entradas é o servidor,
independentemente de a solicitação vir de Apps Script, Xeon, web ou cliente local.
As chaves de origem não são reinterpretadas como concessões de lease. Nenhum
endpoint novo de concessão de lease nem token de autoridade no corpo HTTP foi criado.

## Contrato de commit e fencing

O adaptador `auroraWriterGuardian.ts` utiliza `runtimeLocks` existente, com caminho
determinístico por `orgId` autenticado e recurso `canonical-data`. Nesta primeira
migração, o recurso abrange os dados canônicos do tenant inteiro: escolha
conservadora que evita locks diferentes para writes potencialmente sobrepostos,
mas pode aumentar contenção. A futura granularidade exige prova dos conjuntos de
conflito; não usar chave de tentativa/idempotência como chave de recurso.

1. Cada chamada usa identificador de instância distinto, gerado no servidor.
2. O registro de lease é lido na própria transação Firestore dos efeitos. Relógio
   vem de `DocumentSnapshot.readTime`; o orçamento usa tempo monotônico decorrido.
3. Lease ativo de outro proprietário bloqueia o callback. Renovação exige
   proprietário e epoch exatos; um token antigo não readquire implicitamente.
4. Epoch cresce e não é apagado. Lease inválido, escopo divergente, ausência de
   relógio ou epoch esgotado falham fechados. Callbacks não podem escrever em outro
   tenant nem na coleção de locks por meio do adaptador público. A única exceção interna
   é `expireLegacyRuntimeLock`: transição fixa de LOCKED para EXPIRED em lock
   legado vencido; recusa o prefixo reservado, guardianId, resourceKey canônico,
   tenant divergente e timestamp inválido. Não oferece callback nem escrita livre.
5. Efeitos e estado RELEASED são persistidos no mesmo commit. Durante o callback,
   a exclusão é a transação do Firestore; não há lease adquirido em um commit
   separado que precise ser liberado em `finally` após crash.
6. Em conflito, o SDK repete a transação e revalida o token. O teste de orçamento
   antes do commit não é relógio de commit do provedor; fencing depende também do
   conflito/isolamento transacional. Não promete prazo absoluto de commit em 45 s.
7. A função de negócio continua responsável pela idempotência original. Resposta
   perdida é reconciliada pelo mesmo recibo. Replays não recebem nova identidade.
8. Falha aborta somente a transação afetada. A projeção posterior conserva o
   recibo já aceito; loops independentes usam o tratamento de falhas existente.
9. Após SIGKILL anterior ao commit, locks internos do provedor podem sobreviver
   ao processo. A primeira retomada pode esgotar as tentativas do SDK com ABORTED.
   Esse resultado vira HTTP 503 / GUARDIAN_CONTENTION_RETRY; o chamador existente
   conserva chave, orçamento e backoff. Não há retry adicional no guardião, nem
   exclusão de lock. Resultado desconhecido não é classificado como ausência de efeito.

Não colocar chamadas HTTP, Gmail, Drive, Auth, Storage, arquivos ou comandos do
sistema dentro do callback: ele pode executar novamente. O wrapper é uma
fronteira explícita de código, não um sandbox contra Admin SDK externo. IAM e
Security Rules mantêm seus papéis; clientes continuam sem escrita em runtimeLocks.
O watchdog legado não apaga epochs: esses registros não utilizam seu campo
`leaseUntil`, nem devem receber política TTL de exclusão.

## Inventário e sequência restante

`python3 scripts/aurora/audit_writer_inventory.py --check` confronta a fonte com
`docs/validation/writer-inventory.json`. O inventário enumera arquivos, hashes e
linhas candidatas; não inclui conteúdo documental ou credenciais. A heurística
inclui chamadas que podem ser só estado em memória, headers ou leitura HTTP.
Não resolve chamadas dinâmicas, código gerado, IAM, cópias instaladas ou projetos
Apps Script fora do repositório. Alteração de hash/linha exige revisão e atualização
do inventário na CI existente; atualizar o JSON não comprova enforcement.

| Família ainda pendente | Trabalho necessário no mesmo sistema |
| --- | --- |
| Outros writers Cloud Functions | Conferir IAM e efeitos externos de Auth/Storage/KMS, além de scripts administrativos; manter autorização e idempotência próprias. As 31 fronteiras acima não cobrem efeitos externos do Admin SDK |
| Apps Script `src/` | Revisar cada mutação Spreadsheet/Drive/Properties/Gmail no ponto de efeito; os diretórios legados continuam inventariados, não tratados como fonte publicada |
| Xeon e clientes | Confirmar binários e configurações carregados; mapear escrita local, sincronização, instalador e atualizador. Upload canônico protegido não equivale a arquivo local protegido |
| Provedores externos e scripts administrativos | Usar precondição/idempotência nativa ou execução pelo proprietário único com recibo reconciliável. Uma consulta ao lease antes de uma escrita externa não elimina a corrida entre consulta e efeito |
| Runtime real | Confirmar todas as identidades com permissão de escrita, deployment SHA, destino e canários. Retirar caminho direto só após paridade, rollback e readback |

**Inferência de engenharia:** centralizar as entradas que já convergem ao Firebase
reduz a superfície inicial sem alterar o protocolo dos clientes. A extensão dessa
proteção às cópias instaladas depende de publicação e recibos próprios.

## Validação e promoção

- Testes novos de instâncias da mesma plataforma, concorrência/idempotência,
  epoch antigo após takeover, lease Xeon ativo/expirado, isolamento, dados de lease
  inválidos, falta de relógio, falha individual e resposta perdida.
- Regressões dos handlers reais preservam HMAC, nonce, membership, revogação,
  revalidação, observação pendente, primeira ingestão, instalação e projeção.
- Suite de emulador usa dois clientes SDK independentes, disputa do mesmo recibo,
  takeover sintético e rollback individual. Casos SIGKILL antes/depois do commit
  exercitam processo real e recuperação do mesmo recibo no emulador.
- O emulador é restrito a loopback e ao projeto de testes existente. Não comprova
  handoff no Xeon, rede particionada real ou operação publicada.
- O primeiro teste SIGKILL antes do commit identificou contenção remanescente
  (run 41198118769); o caso depois do commit preservou o recibo. A correção conserva
  a falha transitória. O run 41198402007 mostrou que três tentativas imediatas
  ainda podem terminar PENDING. O teste preserva esse resultado e exige retomada
  em ciclo posterior após o timeout de inatividade do provedor, usando a mesma
  chave e o orçamento original; um tenant independente deve continuar elegível.
- CI, revisão, emulador, implantação e recibos de cada plataforma são evidências
  separadas. O estado permanece parcial até migração e validação de cada família.

Referências de comportamento do provedor:
[transações](https://firebase.google.com/docs/firestore/manage-data/transactions),
[isolamento e contenção](https://firebase.google.com/docs/firestore/transaction-data-contention),
[readTime](https://googleapis.dev/nodejs/firestore/latest/DocumentSnapshot.html).

## Prova instalada no fluxo existente

O workflow protegido existente executa `verify-installed-writer-guardian.mjs`
após autenticação e smoke canônico. O probe confere o SHA e os hashes do manifesto
implantado antes do efeito; usa a mesma sessão e CSRF para uma chamada ao refresh
existente, sem abrir endpoint nem criar executor. A leitura Firestore exige epoch
crescente e igualdade exata de `updateTime` entre lease RELEASED e projeção.
HTTP 200 sozinho, timeout, epoch antigo ou commits diferentes permanecem
`PENDING_EFFECT_PROOF`. Nenhuma chave nova de idempotência ou retentativa automática
é criada. O resultado sanitizado acompanha o artefato do deploy existente.

A prova cobre o commit canônico do servidor usado por esses clientes. Não comprova
escritas locais, cópias externas de Apps Script nem handoff físico entre máquinas.
A identidade do cliente original deve ser conservada. Atualização web e atualização
binária são evidências distintas. A autorização específica do PR #362 preserva
CI exata, aprovação real do ambiente protegido, assinatura e CAS da release; não
estende a validade de credenciais ou de exceções de risco anteriores.

## Rollback e aprendizado

Reverter a candidata retorna às fronteiras anteriores e **reduz a cobertura**.
Preservar registros de lease/epochs, fontes, versões, recibos e trilhas; nunca
apagar locks para liberar um writer. Durante rollback misto, conter os writers
afetados ou manter leitura degradada até reconciliar versões e proprietários.

O registro nativo incorpora o padrão abstrato: identidade de plataforma não é
identidade de instância; validar posse somente antes do efeito é insuficiente;
idempotência permanece no executor original; falha individual conserva o lote.
Persistência no corpus privado e adoção do motor instalado permanecem PENDING
sem recibo próprio. Nenhuma regra privada de cliente foi exportada.


## Extensão administrativa — 31/10/2026

Delta sobre a main `7b59861db48185456c30a2d7382e69c08461ab84` (PR #362,
árvore idêntica à candidata `7f34f75c8e302750f313afb86e9ef8b6905a9e36`): mais 12
caminhos de efeito, total 31. A contagem inclui sete mutações do engine de perfis
que convergem no mesmo ProfileStore. As três verificações somente-leitura de
`checkLease` não contam como novas mutações. A regressão tipada cobre chamadas
Firestore diretas em `functions/src`; não equivale a análise de chamadas dinâmicas,
prova de IAM ou garantia de todos os destinos. Restam duas transações sem mutação
(consulta de instalação e GET orgânico) além do núcleo guardado.

O watchdog documental retorna `changed`, `pending`, `failures` e `partial`.
Cada falha deixa a fonte intacta para o ciclo existente e não apaga os commits dos
itens válidos. Fonte corrigida entre varredura e commit é reavaliada. Expiração
legada reavalia o timestamp no commit; renovação concorrente não é vencida por uma
foto antiga. Não há nova fila, agenda, tabela de idempotência ou retry interno.

### Limites concretos do enforcement universal

| Efeito remanescente | Limite / próxima prova necessária |
| --- | --- |
| Apps Script: Spreadsheet, Properties, Drive e Gmail | LockService/Properties não são o lease Firestore. A fonte ainda contém gravação direta. Inventariar scriptId/deployment e credenciais de todas as cópias; transferir os efeitos ao proprietário existente com precondição no destino. Uma consulta prévia ao lease não serve como fencing |
| Auth: criar usuário, claims, habilitar/desabilitar e revogar tokens | Reservas e membership agora são guardados; os efeitos Auth continuam fora da transação. Preservar o processo de recuperação existente; não declarar fencing do provedor por checkLease antes da chamada |
| Storage e KMS | Reservas/recibos guardados, efeitos externos com seus próprios controles. Prova independente por destino; nunca executar chamadas externas no callback repetível |
| Xeon e clientes: arquivo, SQLite, corpus, instalador e updater | A ingestão no servidor passa pelo mesmo lease. As gravações locais e versões carregadas ainda precisam de migração/paridade e recibo físico. Não copiar o árbitro para criar um lock isolado em cada dispositivo |
| Scripts administrativos e identidades IAM | O runtime não intercepta Admin SDK de outro processo. Enumerar e retirar escrita direta somente após paridade e rollback; inventário do repositório não enumera credenciais implantadas |

Resultado atual: `PARTIAL_IMPLEMENTATION_PENDING_RUNTIME_VALIDATION`;
`allLegacyWritersEnforced=false`, `physicalHandoffVerified=false`. Nenhuma flag é
promovida por existência de fonte, teste ou CI. A autorização do titular permanece;
o impedimento remanescente é técnico e de prova de implantação/destino.


### Readback externo de Storage — continuação 31/10/2026

O upload de credenciamento mantém a precondição nativa `ifGenerationMatch: 0`.
Tanto sucesso de transporte quanto resposta perdida/conflito exigem leitura dos
bytes da geração exata antes do recibo. Metadados SHA-256 não são prova dos bytes.
A leitura limita o tamanho, recusa gerações sem precisão no SDK, não descomprime
conteúdo e confronta o SHA-256 calculado com a entrada validada. Geração ausente
ou removida deixa a operação pendente; não há fallback para o objeto corrente.
O recibo e a auditoria conservam a geração comprovada. A conclusão revalida
organização, convite e o mesmo lease; revogação ou outro proprietário impedem a
confirmação sem apagar o objeto nem desfazer outros itens. Replay conserva o
recibo original; recibos legados não recebem prova nova por inferência.

Isto comprova integridade de uma geração no destino, **não fencing distribuído
do efeito GCS**. Um upload iniciado antes de revogação/takeover ainda pode criar
um objeto pendente: Firestore e GCS não compartilham commit atômico. Não criar
um check prévio nem copiar o lock para disfarçar essa limitação. IAM, quarentena,
retenção da geração e recibo instalado continuam dependências de homologação.
Os writers locais do Xeon e Apps Script permanecem pendentes de migração com
proteção efetiva no destino; nenhuma versão instalada é promovida por este teste.

Regressões sintéticas cobrem metadados falsos, bytes divergentes/truncados/maiores,
resposta perdida, geração removida, replay e revogação/takeover durante readback.
O aprendizado abstrato no registro nativo separa prova dos bytes de posse do
lease; leitura pelo motor instalado e adoção física permanecem pendentes.
