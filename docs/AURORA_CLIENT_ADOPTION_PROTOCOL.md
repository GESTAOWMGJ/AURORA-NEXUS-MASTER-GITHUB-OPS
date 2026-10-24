# Protocolo reutilizável de adoção por cliente

Extensão candidata de `AURORA-INSTALL-INTEGRATION-001`, no mesmo motor e nas
estruturas existentes. O incremento foi desenvolvido sobre
`1eb89666b7c9d468958c7c6f226b69c901588be2` e reconciliado com a main
`fc22441fb6fed095137a74103fa20ad640b522f9`, preservando a continuidade documental
e os contratos de ingestão posteriores. Essas bases de engenharia não são uma
nova referência de instalação.
O procedimento não contém valores de clientes, credenciais ou dados históricos.

`auroraNativeRoutines.ts` fornece um planner determinístico e a política da rotina
existente, sem imports cloud ou dependências novas no kernel IA.
`auroraMasterEngine.ts` usa esse planner;
`auroraRuntime.ts` passa o `member` já verificado e o resultado atual de
`loadInstallationReadiness`. No bootstrap reutiliza a leitura existente. A rota
do Motor Mestre lê o mesmo estado existente para usuários com escopo completo.
Nenhum parâmetro do navegador fornece MFA, credencial ou flags de aceite ao planner.
O teste de papel, permissão, escopo e MFA foi extraído sem mudança de comportamento
para a mesma rotina pura e continua sendo usado pelo ingest nativo, com origem
canônica compartilhada por reexport. Os tipos mínimos de readback são estruturais;
não importam autenticação Firebase ou reducers de persistência no pacote local.

O readback é produzido por `readInstallationReadiness/readInstallationAcceptance`:
verifica entidade atual, revisão imutável, snapshot projetado, recibo persistido,
payload, replay, automação, emissor, membership e validade/escopos. A nova avaliação
confere tenant/ator, método, fonte e a mesma identidade do documento. Não substitui
a transação ou revalidação de autoridade, nem retorna capacidade de execução.
Não há endpoint, banco, conector, scheduler, secret store ou instalador paralelo.

O método e a fonte comprovados selecionam somente o pipeline canônico. Outros
alvos precisam de seleção explícita e recibos próprios. `SCOPED_PIPELINE_VERIFIED`
significa apenas processamento, recibo/replay, automação e commit atuais do
documento selecionado. Não significa aquisição global, extração de formatos,
agente em execução ou instalação física. Windows/Mac/iOS selecionados continuam
`PENDING_DEVICE_ACCEPTANCE`; o planner não implementa seu executor de atualização.
Ele nunca autoriza instalação ou bloqueia publicação global por pendência de tenant.

| Prova | Autoridade e limite |
| --- | --- |
| Identidade e configuração | Sessão individual, tenant, papel e MFA atuais; configuração por CAS no fluxo existente. |
| Aquisição | Driver e consentimento oficial próprios; API/token, pasta ou evento manual possuem escopos distintos. Escolha do usuário não comprova acesso. |
| Extração/observação | Bytes e versão observada, backend de extração e recibo de observação próprios. Metadados e hash não atestam fatos. |
| Processamento canônico | Entidade atual e versão imutável com snapshot e processamento verificados; prova de persistência/projeção do documento selecionado. |
| Fatos canônicos aceitos | Não atestados por esse readback: processamento, `nativeReady` e `workflowState` não comprovam aprovação factual ou humana. `acceptedCanonicalFacts` permanece `NOT_ATTESTED_BY_PIPELINE_READBACK`; o planner não promove narrativa ou observação nem inventa um novo recibo de aprovação. |
| Recibo/replay/automação | Mesma organização, fonte, documento, versão, revisão, snapshot e configuração; repetir não cria outra entidade ou versão. |
| Release e adoção | Referência única assinada, trust independente, nonce atual e closure exata; identidade instalada, backup, CAS, journal e aceite nativo separados. |

OAuth próprio Aurora usa o driver oficial existente, onde cadastrado e consentido.
As alternativas token/API, pasta/agente e manual exigem autorização específica.
O contrato atual de aceite do pipeline atesta `API_TOKEN` e `MANUAL`; nenhum
campo novo faz `CLOUD_OAUTH` ou `LOCAL_AGENT` passar sem evidência de adaptador.
Manual é evento no pipeline e não equivale a polling. Provedor/driver indisponível
permanece pendente ou não suportado. Cada novo cliente configura seu próprio vínculo.
Segredos seguem o canal protegido e escopos mínimos existentes; não entram na saída
do planner, em corpus, argumento, fato ou log. Só capacidade abstrata cruza tenants.

O aprendizado reutilizável exige aquisição dos bytes ou células autorizados com
versão estável da fonte. Planilhas percorrem páginas limitadas de todo o intervalo
selecionado, sem tratar a primeira página como cobertura. A conclusão da ingestão
avança apenas após recibo canônico confirmado. Cursor de enumeração e fila podem
registrar continuação recuperável antes do processamento; isso não atesta
conclusão. Resposta perdida exige releitura durável pelo contrato da operação
selecionada. A fila Drive usa READBACK paginado desde offset zero, incluindo
documentos, aliases e pendências, com totais fechados; API e manual recuperam o
recibo e a versão imutável pela identidade conhecida. Outros adaptadores conservam
seu próprio contrato; não recebem modos ou offsets Drive por inferência. Não se
autoriza outro envio com identidade nova. Aliases usam SHA-256 dos bytes apenas
no mesmo tenant e escopo, preservando as identidades de origem e o vínculo ao
recibo primário; nomes iguais não comprovam duplicação.

No contrato Drive existente, PREVIEW/READBACK conservam ausência de efeitos
operacionais e EXECUTE/PROCESS_EXISTING são modos distintos. Cada executor segue
seu próprio contrato com orçamentos finitos de tentativas, prazo, lotes e ausência
de progresso, sem fallback mutável automático. Processar a fila existente não
enumera nem adota linhas legadas em trânsito. Retry de ocupado exige resposta
autenticada da trava compartilhada e prova de zero efeitos tentados; desfecho
desconhecido exige reconciliação. Preservar tipos, origem de campos, identidade
imutável, datas e papéis financeiros: ausente não é zero; emitido, recebido e
conciliado são fatos distintos; extração não autoriza aprovação, fechamento ou
pagamento. Projeção que falha depois do commit mantém o recibo e o estado da
projeção PENDING. Esse recibo atesta persistência e identidade, sem aceitar fatos
ou revisão financeira. Contagem documental, horário dos dados e horário da
consulta não se substituem. Fila do escopo esgotada ou fim de READBACK não
comprovam sincronização completa do provedor ou da empresa.
Esses campos são regras do protocolo; não criam um executor nem demonstram sua
execução para qualquer cliente.

Os contratos existentes de [aquisição Drive](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/blob/fc22441fb6fed095137a74103fa20ad640b522f9/docs/AURORA_DRIVE_REAL_INGESTION.md),
[alimentação financeira estruturada](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/blob/fc22441fb6fed095137a74103fa20ad640b522f9/docs/AURORA_STRUCTURED_FINANCIAL_FEEDING.md)
e [continuidade da projeção documental](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/blob/fc22441fb6fed095137a74103fa20ad640b522f9/docs/AURORA_BETA_DOCUMENT_PROJECTION_20261023.md)
registram a origem dessas regras. O protocolo reutiliza seus invariantes
sanitizados; não importa o runner, escopo privado, segredo ou autorização WMGJ.

Troca de credencial mantém a identidade documental e o histórico. A credencial
atual deve produzir seu recibo e replay, ser selecionada explicitamente e passar
por automação/emissor/escopos atuais. `checkpoint-transitions` preserva predecessor,
âncora assinada e commit por CAS; não editar metadata, journal ou checkpoint para
forçar sucesso. Comprovar recover/replay do mesmo plano comprometido antes da
ativação seguinte e conferir o replay do instalador depois. O planner descreve
esses gates; os executores existentes continuam sendo sua autoridade.

Consumidor legado que desconhece o perfil/manifesto seguinte precisa primeiro de
bootstrap compatível governado, derivado da baseline observada, revisado, testado,
assinado e adotado com backup/CAS/aceite. Não basta copiar arquivos nem ampliar
allowlist. A descoberta/preparação automática desse bootstrap **não está
implementada** neste incremento. Não se presume que todo consumidor antigo possa
adotar o perfil atual diretamente.

Cada pacote histórico efetivamente usado exige seu próprio perfil exato registrado
para validar manifesto, assinatura e closure. O atualizador existente autentica
os vínculos de journals/envelopes de toda a linhagem e verifica os bytes do pacote
atual e do backup imediato com seus próprios certificados. Isso não comprova uma
auditoria dos bytes de todas as cópias profundas de backup. Não aplicar a allowlist
atual a pacotes históricos, aceitar apenas contagem ou ampliar versões por
conveniência. Upgrade e recuperação devem ser testados desde versões efetivamente
distribuídas e seus ancestrais antes de promover o consumidor. Uma falha conservadora
de perfil não autoriza alterar backup, journal, metadata ou repetir a tentativa.
A ampliação do registro de perfis históricos pertence ao consumidor revisado;
este planner não implementa nem presume correções futuras desse consumidor.

Todos os caminhos Windows prospectivos, inclusive nomes futuros de recibo, devem
caber em 240 unidades UTF-16. O helper puro do planner recusa comprimento maior;
os escritores/transportes de cada executor precisam aplicar seu próprio preflight
antes de efeitos. Não há alteração automática de LongPaths. Resultado desconhecido
mantém locks, prova, CAS e histórico; não agenda retry nem afirma rollback realizado.
Retomada depende de reconciliar processo/proprietário/bytes e do fluxo autorizado.

Mac exige a identidade e a descendente aprovada do aplicativo de cada instalação,
staging, backup verificável, confiança Apple, compatibilidade, troca controlada no
mesmo destino e abertura/aceite nativos. Não usar launcher experimental como
substituto nem desativar Gatekeeper. iOS nativo exige projeto/build Apple,
assinatura/provisionamento, distribuição TestFlight/App Store e aceite do aparelho.
O satellite/PWA atual não é essa entrega. Disponibilidade de artefato não comprova
que dispositivo offline recebeu ou aceitou atualização.

Sem nuvem/readback atual, manter `PENDING_AVAILABILITY`. Desfecho desconhecido gera
`PENDING_RECOVERY`. `PARTIAL`/`PENDING` não vira conclusão e uma amostra não promete
todas as fontes. Os testes usam duas organizações e armazenamento em RAM com os
redutores reais de configuração, recibo/replay e leitura, além de negativos de
isolamento, autoridade, revogação, identidade, alvo e capacidade de caminho.
Eles não comprovam CI, deploy, publicação, tenant real, instalação ou aceite nativo.
Rollback de engenharia: reverter este incremento; preservar fontes, registros e
executores. Nenhuma migração de dados é necessária.
