# Continuidade documental do beta — 23/10/2026

## Problema e decisão

A ingestão HMAC já persistia entidades, versões imutáveis e recibos canônicos,
mas não solicitava a atualização imediata da projeção usada pelo painel. A rotina
periódica existente executa a projeção a cada 15 minutos. A interface também
associava a ausência de uma operação nativa verificada à ausência de documentos,
embora documentos recebidos para validação já fizessem parte do acervo canônico.

O titular autorizou expressamente a publicação e o teste provisório do beta em
23/10/2026. O registro `provisionalBetaAcceptance` da política HML identifica esse
aceite; a publicação reutiliza `OWNER_DEPLOYMENT_APPROVAL`, os checks do SHA exato,
o ambiente protegido, os smokes, a assinatura e a troca CAS do certificado ativo.
Não há alegação de revisão independente. A vigência HML/R029 não foi prorrogada.
A autorização documental privada continua sendo a fonte de escopo dos dados reais.

## Continuidade da ingestão até a interface

1. A transação HMAC autentica organização, identidade, assinatura e nonce e
   confirma a entidade, sua versão e o recibo pelo contrato existente.
2. Após o commit, o handler solicita `refreshProjection` para a organização
   autenticada, também no replay idempotente. A importação ocorre dentro do handler
   para preservar a configuração global de região dos exports de Functions.
3. Sucesso retorna `projectionStatus=REFRESHED`. Se a projeção falhar, o recibo
   mantém HTTP 202 ou 200 e retorna `projectionStatus=PENDING`. Um erro posterior
   não transforma uma ingestão já confirmada em falha canônica.
4. A mesma rotina de projeção usa as coleções canônicas, os limites, o hash de
   origem e o histórico imutável existentes. Replay e agenda de 15 minutos podem
   recuperar uma projeção pendente; nenhum scheduler adicional foi criado.
5. O painel consulta o bootstrap autenticado a cada 15 segundos quando online,
   visível e sem edição. Impede sobreposição e recua para 60 segundos após falha.
   Consultas de credenciais não aumentam junto com a frequência do resumo.

O prazo de 15 segundos é o intervalo de consulta, não um SLA de ingestão nem
garantia de latência zero. A enumeração da origem e a presença de um cliente
conectado continuam tendo suas condições próprias.

## Apresentação do dado unificado

O cartão documental utiliza exclusivamente `documentIntelligence` da projeção
publicada para a organização da sessão:

| Campo | Significado apresentado |
|---|---|
| `totalDocuments` | Documentos canônicos recebidos, de todas as competências |
| `pendingDocumentFlow` | Documentos aguardando validação |
| `sourceDependentDocuments` | Documentos ainda dependentes da origem |
| `nativeReadyDocuments` | Documentos prontos para análise nativa |

Valor ausente ou inválido permanece “Sem fonte”; zero comprovado permanece zero.
A interface exibe o horário da projeção e seu `snapshotId`, separando-os da última
consulta do navegador. A competência financeira existente é preservada. Uma
resposta com organização explicitamente divergente remove os dados privados.

Documentos recebidos não alteram `nativeReady`, `sourceIndependent`, a primeira
ingestão nativa verificada, revisão documental ou validação financeira. Aliases e
itens sem extração não são adicionados ao contador canônico por inferência. Fila
autorizada esgotada, cobertura integral do Drive e instalação dos clientes exigem
evidências distintas.

## Validação e publicação

Os testes do handler exercitam HMAC real com fixture transacional, falha depois do
commit, recuperação por replay, versão seguinte, invariância do histórico,
isolamento organizacional, assinatura inválida e replay de nonce. Os testes de
interface cobrem dados ausentes, zero, competência, organização divergente,
descarte de dados privados, edição em andamento, sobreposição e recuperação.

Teste local não comprova publicação. A liberação deve registrar SHA integrado,
CI desse SHA, run protegido, versão efetivamente publicada, certificado ativo e
smokes. A alimentação real deve registrar recibos, versões imutáveis e READBACK
paginado pelo fluxo existente `DRIVE_TOTAL/PROCESS_EXISTING`. Nenhum número de
documentos real é fixado no código desta entrega.

## Falha e recuperação

Falha de projeção mantém a ingestão comprometida e registra apenas mensagem fixa
sem documentos, credenciais ou erro bruto. A recuperação usa replay idempotente ou
a rotina periódica existente. Se o cliente perde autorização, limpa a visão privada.
Rollback de código e certificado segue o procedimento HML existente e exige um
predecessor confirmado; não desfaz documentos ou versões já aceitos.

O extrator documental continua conservando falhas de formato como pendências.
Um término sem erro do coordenador não atesta ingestão global concluída. Originais,
checkpoints, escopo da organização e controles de idempotência permanecem intactos.

## Diagnóstico das pendências de conversão

A entrega também valida ID novo e MIME da cópia OCR, solicita explicitamente a
conversão documentada e centraliza a tentativa de limpeza do temporário em
`finally`. Falha ao criar a cópia e falha ao abrir a cópia são estados distintos.
O original não é usado como destino de limpeza. Isso reforça o conversor existente;
não constitui afirmação de recuperação dos PDFs operacionais.

Na verificação autorizada de 23/10/2026, os dez objetos PDF pendentes apresentaram
o mesmo hash de bytes, cabeçalho PDF 1.5 e marcador de criptografia. Escopo e versão
de cada origem foram reconferidos, sem alteração dos originais ou da fila. Uma
amostra continuou retornando HTTP 400 nas tentativas de conversão. A estrutura
encontrada é pista de diagnóstico, não prova isolada da causa nem da exigência de
senha. Nenhuma proteção foi removida e nenhum objeto foi promovido a alias ou
documento processado sem recibo canônico. Permanecem ainda a planilha acima do
limite de texto e o formato ZIP sem extrator suportado.

O preview de configuração de conectores ganhou diagnóstico sanitizado dos
predicados de seleção da implantação. As rejeições, o SHA esperado e a comparação
antes/depois permanecem obrigatórios; não foi adicionado retry permissivo.

### Releitura anterior à versão publicada

O deploy posterior ao PR #311 publicou a versão 36, mas o preview encontrou na
releitura a versão 35 da mesma identidade canônica. A API consultada em seguida
confirmou a versão 36 com o SHA integrado e os módulos esperados. O artefato de
falha identifica essa observação; não estabelece se houve cache ou propagação do
provedor.

A recuperação limita-se a novas leituras após o preview: uma versão estritamente
anterior, com identidade canônica única e igual à conferida antes, pode aguardar
convergência por até cinco tentativas. Nenhuma versão anterior é aceita. A leitura
final precisa coincidir exatamente em identidade, versão e SHA com a inicial e
passar nas verificações de fontes e manifesto. Estado ambíguo, identidade distinta,
versão superior ou descrição divergente na mesma versão continuam bloqueando de
imediato. Persistência da leitura antiga também bloqueia ao esgotar o limite.

O CI passa a executar os testes desse preview antes de qualquer deploy Firebase.
Alterações de coordenadores `.cjs` também acionam a publicação Apps Script existente,
para que sua referência de código acompanhe o SHA integrado.

## Prova posterior à promoção — candidato de 23/10/2026

O smoke anterior à promoção confere o runtime novo e a referência ativa anterior.
O job `publish-active-release` acrescenta uma segunda consulta autenticada ao
portal canônico, depois da troca CAS, da finalização e da retenção do ZIP. A fase
`POST_PROMOTION` exige a fonte e a versão esperadas no certificado ativo, nos
manifestos e nos bytes locais de servidor/web, além de `RUNTIME_BYTES_MATCH`.
O verificador rejeita referência ausente, anterior ou divergente.

O certificado esperado vem da saída pública validada de
`export-public-unified-release.mjs`, usada para finalizar o mesmo candidato,
e segue pelo output `certificate_sha256`. Não é derivado da resposta bootstrap
sob verificação. A fase anterior continua aceitando o predecessor nos limites
do contrato existente; a fase posterior rejeita esse argumento.

A consulta reutiliza WIF, a conta de deploy, a conta de smoke HML e a sessão no
domínio canônico. Confere organização `wmgj`, ambiente, modo e membro esperados.
Tokens, cookies e respostas ficam em diretório temporário restrito, removido
também em falha. O log de sucesso registra somente códigos e hashes públicos.

Falha no smoke posterior torna o job falho e conserva o ZIP já retido e o pin
promovido para diagnóstico. Não introduz rollback automático. A recuperação
continua exigindo o procedimento existente e um predecessor confirmado.

Os testes exercitam a chamada CLI do próprio workflow, referências/certificados
divergentes, manifestos e bytes incompatíveis, ordem de retenção e limpeza privada
em falhas sintéticas dos provedores. Essa validação local não comprova o smoke
remoto. Mesmo o smoke remoto aprovado não comprova instalação no Mac/Windows,
aceitação física, saneamento das pendências ou sincronização plena dos dados.

Impacto no Release Cockpit: a prova de publicação ganha o smoke final do SHA
integrado. A pontuação de engenharia, os gates de ingestão/aceitação física e os
estados `nativeReady`/`sourceIndependent` não são promovidos por esse teste.
O incremento mantém a linha `1.1.0-beta.2` e permanece candidato até CI e HML
do próprio SHA, sem reaproveitar o sucesso de uma publicação anterior.
