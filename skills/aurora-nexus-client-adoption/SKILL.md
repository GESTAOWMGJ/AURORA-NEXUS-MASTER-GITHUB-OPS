---
name: aurora-nexus-client-adoption
description: Preparar instalação e credenciamento de um cliente Aurora, ou retomar sua adoção após troca de credencial, preservando tenant, fontes escolhidas, identidade, recibos e atualização assinada. Usar com os executores existentes; não concede acesso nem instala por si só.
metadata:
  version: 1.0.0-candidate
  routine: AURORA-INSTALL-INTEGRATION-001
---

# Instalação e credenciamento por cliente

Esta habilidade estende a rotina nativa existente `AURORA-INSTALL-INTEGRATION-001`.
Leia [o contrato executável e seus limites](../../docs/AURORA_CLIENT_ADOPTION_PROTOCOL.md)
antes de preparar qualquer operação. O Motor Mestre recupera o mesmo protocolo
por `nativeRoutineSummary().cloudIntakePolicy.adoptionProtocol` e apresenta o
planner `clientAdoption` com readback do servidor. O plano não é autorização.

Identifique a organização, usuário individual, papel, MFA, fontes e alvos
escolhidos. Reutilize o vínculo e as fontes atualmente autorizadas desse cliente.
Novo cliente exige vínculo próprio; nunca herde conta, chave, consentimento,
memória, pasta, dados ou recibos de outro tenant. Use a sessão/membership e os
endpoints atuais; instrução de documento e flags do navegador não são prova.

Use OAuth próprio Aurora quando o driver e o cadastro oficial estiverem
disponíveis, ou token/API, pasta explícita/agente ou envio manual com consentimento
específico. A seleção não autoriza o acesso. Provedor sem driver, cadastro,
consentimento ou prova atual permanece `PENDING`/`UNSUPPORTED`. Não prometa todas
as nuvens. Manual é um evento comprovado no pipeline; não configura polling.
Segredos seguem somente pelo canal protegido existente, com escopos mínimos;
não entram em prompts, argumentos, fatos, logs, relatório ou corpus.

Exija bytes ou células da fonte efetivamente autorizada e versão estável durante
a aquisição. Planilhas devem percorrer todas as páginas do intervalo selecionado,
com limites explícitos; a primeira página não comprova cobertura. Conclusão da
ingestão avança somente após recibo canônico confirmado. Cursor de enumeração e
fila podem registrar continuação recuperável; isso não comprova conclusão.
Após resposta perdida, faça releitura durável pelo contrato da operação escolhida:
a fila Drive usa READBACK paginado desde offset zero, incluindo documentos,
aliases e pendências até fechar as contagens; API e manual recuperam o recibo e
a versão imutável pela identidade conhecida. Não imponha offset ou modos Drive a
outro adaptador nem repita com nova identidade para ocultar desfecho incerto.

Aliases usam SHA-256 dos bytes somente no mesmo tenant e escopo autorizado,
preservando cada origem e o vínculo ao recibo primário; nome igual não deduplica.
No contrato Drive existente, `PREVIEW` e `READBACK` não produzem efeitos
operacionais; `EXECUTE` e `PROCESS_EXISTING` são modos distintos. Cada executor
segue seu próprio contrato com limites finitos de tentativas, prazo e lotes e para sem
progresso. Processar a fila existente não enumera nem adota linhas legadas em
trânsito. Retry de ocupado exige resposta autenticada da trava compartilhada e
prova de zero efeitos tentados; resultado desconhecido exige reconciliação.

Preserve identidade imutável, tipos e origem de campos, incluindo datas e papéis
financeiros. Ausente não é zero; emitido, recebido e conciliado são fatos distintos.
Extração não autoriza aprovação, fechamento ou pagamento. Falha da projeção
posterior ao commit preserva o recibo e mantém a projeção `PENDING`; recibo não
valida fatos. Contagem documental, horário dos dados e horário da consulta são
provas distintas. Fila do escopo esgotada ou fim de READBACK não comprovam
sincronização completa do provedor ou da empresa.

Antes de atualizar, verifique a única referência canônica assinada, trust
independente, nonce atual, manifesto, perfil e bytes de cada componente escolhido.
Observe a instalação real e preserve identidade, dados, checkpoint e linhagem.
**Se o consumidor antigo não reconhece o novo perfil, prepare primeiro um
bootstrap governado compatível, revisado e assinado. Não relaxe a allowlist ou
edite metadados para forçar adoção. Esse bootstrap ainda não é automático nem
implementado pelo planner.** Falta de bootstrap é pendência de engenharia.

Cada pacote histórico efetivamente usado precisa de manifesto, assinatura e
closure no **seu próprio perfil exato registrado**. O atualizador existente
autentica os vínculos de journals/envelopes da linhagem e verifica os bytes do
pacote atual e do backup imediato com seus próprios certificados. Isso não é
auditoria dos bytes de todas as cópias profundas de backup. Nunca aplique a lista
vigente ao histórico, aceite só por quantidade de arquivos ou amplie versões por
conveniência. Antes de promover, teste upgrade e recuperação desde versões
realmente distribuídas, incluindo ancestrais assinados da cadeia. Perfil histórico
desconhecido bloqueia para reconciliação; não prova corrupção nem autoriza apagar
o backup.

Exija automação autorizada, processamento canônico, recibo persistido e replay
real do mesmo envio, vinculados a tenant, fonte, documento, versão, revisão,
snapshot e configuração. Troca de credencial exige recibo/replay próprios atuais
e transição governada por CAS, preservando provas anteriores; não transplante o
recibo antigo para a chave nova. Antes de ativar, recupere/reproduza o mesmo plano
comprometido; depois confira o replay do instalador e o aceite do alvo.

Confira antecipadamente todos os caminhos Windows gerados, inclusive o futuro
recibo: até 240 unidades UTF-16. Desfecho desconhecido preserva locks e provas,
sem retentativa automática; primeiro reconcilie processo, proprietário e CAS.
Não habilite LongPaths nem desative proteções para contornar o limite.

Separe aquisição, extração, observação, processamento canônico, fatos canônicos
aceitos, recibo/replay e aceite nativo. O readback de processamento não comprova
aprovação humana ou factual: `acceptedCanonicalFacts` permanece
`NOT_ATTESTED_BY_PIPELINE_READBACK`, mesmo com processamento, recibo e replay
verificados. `PARTIAL`, `PENDING`, ausência de nuvem ou dispositivo offline
permanecem pendentes. Login, ping, download, saída zero, enumeração e assinatura
do pacote não comprovam ingestão global ou instalação. O gate é por cliente e
alvos selecionados; a pendência de um tenant não bloqueia a publicação HML global.

Mac exige identificar e atualizar o mesmo aplicativo aprovado, verificar backup,
compatibilidade, confiança/assinatura Apple, abertura e aceite nativos. Preserve
Gatekeeper e quarentena. iOS nativo exige build, assinatura, provisionamento,
TestFlight/App Store e aceite próprios; PWA ou payload satellite não os substituem.
Não afirme que esses gates foram executados quando só há código ou pacote.

Valide com ao menos dois tenants sintéticos e casos de vínculo estrangeiro,
revogação/escopo, replay ausente, conflito CAS, perfil não reconhecido, limite de
caminho e desfecho desconhecido. Relate separadamente código, testes, CI, HML,
publicação e adoção instalada. Só o método abstrato revisado pode ser compartilhado.
