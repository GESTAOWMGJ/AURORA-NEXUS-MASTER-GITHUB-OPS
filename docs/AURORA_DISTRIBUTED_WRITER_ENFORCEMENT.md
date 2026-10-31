# AURORA — enforcement gradual do lease canônico

Incremento 1.1.0 do **AURORA-REALTIME-PLATFORM-GUARDIAN-001**, sobre
`eef855d8ffbfd5ca63d3410bfba1cefd4863a48f`. Estado: implementação parcial candidata.
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

São **oito fronteiras transacionais**, não oito plataformas instaladas ou todos
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
   tenant nem na coleção de locks por meio do adaptador.
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
| Outros writers Cloud Functions | Migrar transações e writes diretos de orgânico, finanças, perfis, credenciais, credenciamento, criptografia e vigilância; manter autorização e idempotência próprias |
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
- CI, revisão, emulador, implantação e recibos de cada plataforma são evidências
  separadas. O estado permanece parcial até migração e validação de cada família.

Referências de comportamento do provedor:
[transações](https://firebase.google.com/docs/firestore/manage-data/transactions),
[isolamento e contenção](https://firebase.google.com/docs/firestore/transaction-data-contention),
[readTime](https://googleapis.dev/nodejs/firestore/latest/DocumentSnapshot.html).

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
