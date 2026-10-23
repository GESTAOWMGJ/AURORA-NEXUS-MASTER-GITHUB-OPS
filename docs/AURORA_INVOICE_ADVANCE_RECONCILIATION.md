# Conciliação de nota, adiantamentos e pagamentos posteriores

Método `AURORA-FIN-ADVANCE-001`, versão 1.0.0, 21/10/2026.
Vinculado às rotinas existentes `AURORA-REV-SAN-001` e `AURORA-FIN-SOC-001`.
Baseline de engenharia: `c1db7befa34c56467217590613a97b438933edb6`.

## Regra reutilizável

Uma nota que documenta adiantamentos não cria, por sua emissão, outro pagamento
ou outra despesa além do mesmo serviço. Vincular documento fiscal, obrigação e
liquidações por identidade e evidência, nunca apenas por igualdade de valores.
Preservar separadamente competência do serviço, emissão, escrituração, data
de lançamento bancário e eventual data diferente no histórico do banco.

1. Ler primeiro os registros atuais e as revisões, incluindo conciliações já feitas.
2. Confrontar emissor/tomador, identidade completa da nota, natureza, valor bruto,
   retenções, líquido, documentos bancários e lançamentos do razão. Não tratar
   número de nota isolado como identidade global nem ligar despesa a nota de receita.
3. Manter uma obrigação econômica e suas alocações de liquidação. Pagamento parcial,
   adiantamento, compensação e documento fiscal representam eventos distintos;
   apenas o reconhecimento econômico fundamentado compõe custo, uma vez.
4. Nota e razão podem comprovar o vínculo fiscal-financeiro sem comprovar todos os
   períodos executados. Competência declarada não equivale a escala validada.
5. Pagamento posterior sem alocação comprovada permanece pendente. Não concluir que
   é duplicidade, complemento, dívida, outro serviço ou custo adicional. Razão com
   corte anterior não prova ausência de lançamento/pagamento posterior.
6. Reutilizar a pendência e a thread atuais. Conferir mensagens recebidas/enviadas,
   anexos, solicitações e prazo antes de cobrar. Arquivo já recebido não deve ser
   solicitado novamente; pedir somente validação ou complemento indispensável.
   Resposta e recibo de envio não equivalem a resolução. Falha de busca não é ausência.
7. Antes de alterar fonte autorizada, reler células/versão, conferir validação e
   fórmulas, registrar antes/depois e fonte/hash. Preservar valores de caixa e
   histórico. Repetição com a mesma identidade deve produzir zero efeito financeiro.
8. Manter custos totais, margem e resultado líquido não apurados quando faltarem
   elementos essenciais. DRE agregada de vários meses não substitui o resultado
   isolado de uma competência. Autorização societária é controle independente.

## Registro original, adoção e limites

`nativeRoutineSummary().invoiceAdvanceReconciliationPolicy` leva este método ao
registro da projeção e ao Motor Mestre já existentes. O JSON de política usa o
esquema compatível com `desktop/ia-master/knowledge-registry.cjs` e contém somente
um método abstrato. É um pacote de intercâmbio, não uma nova base de memória.
As provas privadas da operação permanecem nos controles autorizados do tenant;
não são copiadas para código, fixtures ou corpus comum.

Estado histórico do registro inicial: `REGISTERED_METHOD_PENDING_EXECUTOR_VALIDATION`. A primeira etapa registra
procedimento e contrato; não implementa novo conciliador automático, remetente,
scheduler, acesso à origem ou alçada financeira. O executor de saneamento do PR278
é uma dependência independente: revalidar sua versão/estado antes de reutilizá-lo.
Não declarar instalado no Xeon, sincronizado na nuvem ou utilizado na operação
por existir código, arquivo, teste ou tarefa de continuidade.

Quando o executor autorizado estiver online, ler identidade/tenant, versão/hash
e o corpus existente; usar o adaptador governado vigente para propor o método
pela mesma chave. Não sobrescrever `knowledge_registry.v1.json` com este pacote,
nem executar importação manual para contornar schema, concorrência ou autorização.
Se o adaptador não suportar a operação, registrar a lacuna. Confirmar recibo,
hash e recuperação pelo motor antes de registrar adoção; repetir a mesma chave
para comprovar ausência de duplicação. Não reiniciar o motor sem necessidade.

## Validação e rollback

Os testes usam somente dados sintéticos e verificam compatibilidade/recuperação
no loader existente, isolamento do pacote genérico e presença do contrato no
registro e na projeção. Isso não testa reconciliação financeira real nem prova
escrita atômica no corpus instalado. CI e adoção exigem recibos próprios.

Validação de 21/10/2026 no ambiente de engenharia: 6 testes do loader e 10 do
registro/projeção passaram. O teste TypeScript usa o loader `tsx` previsto pelo
projeto; a primeira tentativa com strip-types puro não resolveu imports `.js`
para fontes `.ts` e foi substituída por esse runner. `git diff --check` passou.
Esses testes não foram executados no dispositivo físico offline.

Rollback: reverter este incremento pela revisão existente, preservando os
registros de auditoria, vínculos documentais e corpus privado. Eventual revogação
do método instalado deve usar o mecanismo existente e conservar a versão anterior.
Gates do Release Cockpit permanecem inalterados; nenhum gate é promovido.


## Integração executável candidata — 21/10/2026

Baseline main: `226a7f1` (titularidade/registro). Método e pacote de intercâmbio
1.0.0 preservados, SHA-256
`690cbef0b732a060e5b63575268e67280a7b352dbb7d07797491d0facc1da349`.
A implementação 1.0.0 passa a `INTEGRATED_READ_ONLY_PENDING_RUNTIME_VALIDATION`.
Isto não é promoção de gate do Release Cockpit, adoção do corpus ou instalação.

### Componentes reutilizados e fronteiras

- `auroraRuntime.refreshProjection`: lê as coleções atuais na mesma transação e
  persiste a avaliação nos snapshots/histórico/auditoria já existentes. Identidades
  vêm do ID Firestore, sem aceitar `_documentId` escolhido pelo conteúdo.
- `auroraEngine.buildProjection` chama o redutor puro `auroraInvoiceAdvance.ts`;
  `auroraNativeIntelligence` encaminha lacunas ao planejamento do Motor Mestre.
  Despesas explicitamente classificadas não entram no faturamento de receitas;
  débitos explicitamente classificados não entram nos recebimentos.
- `/api/native` da IA Master aceita opcionalmente `invoiceAdvanceSource` no mesmo
  contrato autenticado local. Exige organização e classificação PUBLIC/INTERNAL
  em todas as linhas. Retorna somente `LOCAL_UNVERIFIED_PREVIEW`, com recibo da
  aplicação e zero chamada ao modelo. Não autentica a origem do conteúdo importado.
- O registro genérico existente identifica método, versão e estado. O loader
  `knowledge-registry.cjs` permanece byte a byte intacto (hash
  `dc6c99e407faa11adb46e68d798bd49374e54ada820c0f755520fcfec32abbb8`).
  Não há importador novo, corpus paralelo, substituição ou migração de memória.
- A referência operacional cita `motor-learning.cjs` e a cópia instalada
  `tools/motor-learning.v1.cjs`. O arquivo não está presente nesta árvore canônica.
  O serviço `/api/improve` existente produz propostas; não é um importador de
  corpus. Sem inspeção/hash da cópia instalada, sua compatibilidade permanece
  pendente. Não reconstruir esse adaptador por suposição nem substituí-lo por
  escrita manual no corpus. Registro, seleção e aplicação não são a mesma prova.
- O fluxo legado `appsscript/07_ia_fechamento_conciliacao.gs` consulta modelo e
  fecha linhas por diferenças/confiança. Não oferece o contrato documental
  necessário a este método. Permanece fora da ativação deste incremento.

### Contrato de entrada explícito, sem migração automática

Somente `reconciliations.methodId=AURORA-FIN-ADVANCE-001` opta pelo método.
O objeto `advance` usa schemaVersion 1, obligationId, invoiceId, invoiceIdentity
(issuerId, recipientId, invoiceKey), economic (eventId, competence, amountCents,
evidence), ledger (postingDate, evidence) e payments (bankTransactionId,
amountCents, evidence). A competência do registro deve coincidir com a econômica.
O fixture sintético executável em `test/fixtures/invoice-advance.cjs` especifica
os campos completos. O mapeamento privado ainda precisa de revisão; ausência
desse envelope não permite inferir relações a partir de texto ou valores iguais.

Cada evidence fixa id, sourceVersion e canonicalSnapshotHash de um documento
atual revisado da mesma organização, também listado em evidenceRefs da conciliação.
A prova econômica liga evento, competência, partes e valor; a prova do razão liga
nota, evento e data; a prova de alocação liga nota, evento, transação e centavos.
A nota é explicitamente EXPENSE, com bruto, retenção e líquido coerentes. Banco
usa DEBIT e valor negativo canônico, status liquidado/conciliado e datas próprias.
`historyDate:null` registra ausência conhecida, sem copiar a data bancária.

Uma obrigação tem uma nota nesta versão conservadora. Vários IDs para o mesmo
evento econômico ou identidade fiscal bloqueiam o reconhecimento. Repetições
idênticas não somam efeitos. Conflitos preservam pendência; não escolhem a última
linha. Pagamentos repartidos entre obrigações nunca excedem a transação, inclusive
entre competências. Débitos explicitamente marcados com o método permanecem
pendentes enquanto não totalmente alocados. Movimentos não marcados não são
inferidos como relacionados; a avaliação não atesta cobertura bancária integral.

O resultado preserva referências e datas, separa `recognizedCostCents` do caixa
alocado e mantém `totalCostsCents`/`netResultCents` nulos: o método cobre um recorte,
não o resultado mensal inteiro. Qualquer lacuna impede publicar custo do recorte
como concluído. O método nunca altera lançamentos, resolve achados, autoriza
pagamento, emite nota, distribui resultado ou envia mensagens.

### Recibos, idempotência, recuperação e acesso

A avaliação fornece método/versão/hash, orgId, competência, inputHash,
evidenceHash e receiptHash determinísticos. Na nuvem, o mesmo envelope integra
snapshot/sourceHash/histórico já existentes. A identidade do snapshot de integração
inclui `invoice-advance-v1`, evitando reutilizar recibo anterior à implementação.
A repetição usa a transação e o histórico existentes; não há outra fila ou lock.
O acesso financeiro existente também protege os vínculos do método. No runtime
local, a auditoria guarda apenas hashes da entrada e do recibo, não o conteúdo.

Testes encerram processos reais com SIGKILL antes e depois do commit de um double
transacional sintético que executa o escritor real `refreshProjection`. A retomada
não duplica histórico/auditoria nem reconhecimento. Isso comprova o comportamento
do código nesse fixture, não atomicidade do serviço Firestore, leases entre Xeon e
nuvem ou recuperação de uma instalação real. Esses gates continuam independentes.

### Dependências e revisão

PR #278 inspecionado em `b7da1fbbc3516386ce33898c6af57cb272d0bc59`: executor de
saneamento implementado, nove workflows de PR concluídos com sucesso, draft aberto
sem revisões registradas. Seus tipos de pendência e configuração privada exigem
validação própria; este incremento não inventa encaminhamento do novo achado para
planilha/Gmail. Reutilização futura exige mapeamento explícito, revisão independente,
concessão vigente, histórico de mensagens importado, deduplicação e recibos.

PR #294 também estava sem revisões registradas na inspeção. A API de proteção da
main respondeu 403 ao conector; a lista acessível de rulesets retornou vazia. Isso
não comprova ausência de proteção. Preservar revisão humana e CI do SHA final;
não fazer merge, deploy ou habilitação operacional por este incremento.

O Xeon estava offline no canal com retorno verificável. O Windows SAS possuía
somente comandos básicos no TRIGGERcmd; o disparo de abertura do Prompt retornou
`Trigger sent`. Não foi possível inspecionar pacote, identidade, corpus ou instalação
no SAS. Não confundir disparo com execução. A instalação solicitada aguarda canal
com leitura/execução e pacote aprovado compatível; o corpus privado não será copiado
entre máquinas como atalho para habilitação. Manter o Mac como supervisão leve.

Rollback: reverter o incremento de código pelo fluxo de revisão, conservar
snapshots, conciliações, evidências e histórico. O método não muda fontes financeiras
nem corpus privado. O pacote local amplia somente o kernel existente (36 arquivos; fechamento legado de 34 preservado). O consumidor atualizado aceita os dois fechamentos sob certificado e hashes; consumidores antigos de 34 arquivos precisam de atualização revisada antes dessa candidata. Sua promoção,
assinatura e atualização no mesmo destino continuam pelos gates atuais.

## Correção da composição de publicação — 21/10/2026

O run 39640397010, SHA bd8fb02afd38b378e476306f39bc556ad0e2b7ec,
falhou com COMPONENT_MANIFEST_INVALID: o builder já produzia 36 arquivos,
mas release-component-packages.mjs aceitava somente a composição legada de 34.
O leitor passa a reconhecer exatamente duas listas fechadas: a legada e sua
extensão com kernel/auroraInvoiceAdvance.js e kernel/auroraEvidence.js.
Extensão parcial, módulo desconhecido, fonte divergente, arquivo extra e digest
alterado continuam bloqueados. Não há aceitação baseada apenas na contagem.

Os 24 testes focados do leitor/retenção/ZIP passaram, incluindo roundtrip da
extensão e preservação do pacote Windows de sete arquivos. São testes sintéticos,
sem prova de assinatura, publicação, instalação, adoção privada ou conciliação real.
O conteúdo concorrente do candidato foi preservado na linearização sobre a main
226a7f101f4bf1e0680afca2459132f01ebaf71d; CI e revisão devem usar o novo SHA.
Rollback desta correção: reverter a aceitação da composição estendida e seus
testes; manter fontes, corpus, recibos, histórico e gates existentes.
