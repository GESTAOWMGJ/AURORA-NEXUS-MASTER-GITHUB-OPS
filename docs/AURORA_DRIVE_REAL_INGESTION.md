# Ingestão real do Drive no motor existente

## Problema e comportamento

O coletor anterior voltava ao início das raízes, não percorria subpastas e limitava a extração de Sheets às primeiras 200 linhas. A projeção financeira também conservava campos brutos incompatíveis com o contrato estrito da API. Uma tentativa real foi rejeitada pelo validador antes de persistir o primeiro evento.

A correção reutiliza a fila, a trava compartilhada, os checkpoints e o bridge HMAC existentes. O executor permanece LEGACY_MIRRORED; não há segundo agendamento ou organismo. O fluxo autorizado é apenas Drive, sem disparar o orquestrador amplo de Gmail, comunicação externa ou lançamento financeiro.

## Escopo privado

O secret de repositório AURORA_WMGJ_DRIVE_SOURCE_SCOPE contém schemaVersion aurora.authorized-drive-source-scope.v1, orgId, projectId, autorização registrada, sources, fileIds e excludedFolderIds. IDs, referências e conteúdo reais não devem ser incluídos neste repositório ou nos artefatos públicos de CI.

Cada fonte declara sourceId, system DRIVE, folderId, active e slaMinutes. IDs explícitos são processados na ordem recebida; raízes são ordenadas por sourceId. As exclusões se aplicam às subárvores. O fingerprint inclui o escopo e a configuração do bridge, sem revelar credenciais.

## Execução

A função auroraExecutarIngestaoDriveAutorizada aceita PREVIEW, EXECUTE e READBACK. PREVIEW não enfileira nem envia. EXECUTE adquire a trava existente, revalida a identidade e usa configuração de transporte restrita à chamada. Não muda flags globais ou triggers. Os limites são por chamada e por prazo.

O workflow existente aurora-rc11-recovery-real-ingest.yml admite operation DRIVE_TOTAL. Ele exige main exato, a confirmação RUN_AUTHORIZED_REAL_DRIVE_INTAKE, SHA-256 do escopo privado, janela HML válida, OAuth existente, fonte Apps Script publicada correspondente e recuperação do banco (default). O modo antigo RC11_SAMPLE permanece separado; não é reexecutado por esta carga.

A rotina enumera recursivamente e persiste o cursor na configuração existente. Uma expiração de cursor recomeça a pasta com deduplicação por identidade. O estado de cada documento permanece na fila existente. Planilhas são lidas em blocos de 200 linhas até o final; limites de tamanho e formatos sem extração comprovada permanecem pendentes explicitamente.

SHA-256 de bytes identifica aliases dentro do mesmo tenant e escopo. Nome repetido não é prova de duplicação. Os aliases conservam seu ID de origem e o recibo do documento primário. Nenhuma fonte é movida, apagada ou reescrita.

## Persistência e prova

Documentos genéricos entram para revisão. O registro canônico contém origem, hashes, estado e extractionEvidence estruturado; não contém narrativa livre. O texto integral continua na fonte referenciada e a planilha mantém uma amostra operacional. Esta entrega não declara pesquisa integral do texto na plataforma.

Cada envio exige recibo e replay idêntico com nonce novo, sem mudança da revisão. O coordinator consulta o documento canônico e sua versão imutável, conferindo origem, conteúdo, hash do texto, revisão e evidência de extração. READBACK pagina todos os recibos duráveis e aliases desde offset zero, inclusive após uma perda de resposta anterior. A contagem final deve fechar e nenhuma pendência pode ser tratada como concluída.

Os artefatos públicos contêm apenas contadores, hashes e estados. Planos privados e respostas detalhadas são removidos do runner. fullSynchronizationVerified continua false: enumeração, extração e ingestão documental para revisão não comprovam sincronização integral de todos os processos da empresa.

## Projeção financeira tipada

O mapper v1.3.0-typed-financial deriva identidade, competência e workflow antes de projetar os campos permitidos. Mantém valores em centavos, papéis financeiros, origem de campos e referências documentais; não transporta a linha bruta. O hash da linha completa preserva o vínculo auditável à fonte. Referências Drive, Gmail e anexos fiscais são preservadas sem inventar IDs.

A API aceita o contrato financeiro somente na raiz, com tipos, campos e estados explícitos. Texto livre, dados clínicos, campos extras e valores incompatíveis continuam rejeitados. A extensão do schema não amplia os escopos das chaves HMAC, não aprova recebíveis, não concilia e não executa pagamentos.

## Validação e retomada

Os testes de contrato cobrem recursão, expiração de cursor, mudanças de origem, aliases, leitura após 200 linhas, erros por documento, replay, isolamento de configuração, paginação durável e readback das versões imutáveis. A paridade financeira executa o mapper real e o validateEvent real com fixtures sintéticas.

Uma falha de identidade, autorização, recibo ou replay interrompe o ciclo. Falhas de formato permanecem explícitas e não impedem os demais itens. Depois de uma passagem completa sem progresso, a execução conserva as pendências para tratamento, em vez de repetir indefinidamente.

Rollback de código usa o commit anterior e a publicação anterior do Apps Script. Documentos já aceitos têm revisões imutáveis; não devem ser apagados para simular rollback. Não reexecute eventos com identidade nova para ocultar uma falha ou um recibo incerto.

## Diagnóstico de retomada — 23/10/2026

Falhas fixas do scanner e do cursor de processamento preservam seu código no wrapper e no coordinator. Mensagens livres continuam ocultas. A mudança permite distinguir um checkpoint excedido, uma fila incompatível e uma linha legada em processamento, sem repetir automaticamente uma chamada com efeitos incertos.

READBACK acrescenta um diagnóstico limitado às duas propriedades do tenant e fingerprint autorizados. Informa presença, validade, índices e tamanhos; não revela tokens, IDs, nomes ou valores das propriedades. A leitura ocorre sob a trava compartilhada e conserva recibos duráveis. Um cursor salvo abaixo do limite não prova que o próximo checkpoint caberá.

O preview legado de publicação registra fase e motivo por listas fechadas, inclusive em falha. Seus gates, contrato de sucesso e erro público permanecem iguais; stdout, stderr, argumentos e exceções brutas nunca entram no artefato.

Baseline deste incremento: 1ae49855b9ee1fd8f12e896c77ca98fdb4e5ca23. Testes sintéticos cobrem privacidade, ausência de escrita, rejeição por identidade/escopo, falha posterior do readback e proibição de retry dos novos códigos. O incremento não reconcilia estados legados, não comprova ociosidade de executores e não declara a carga completa. A causa e a recuperação reais dependem da leitura do runtime publicado. Rollback conserva o checkpoint e usa a fonte/publicação anteriores.

## Processamento da fila existente

Quando a enumeração encontra uma linha legada em EXTRAINDO ou CLASSIFICANDO, ela mantém o bloqueio AURORA_DRIVE_INFLIGHT_RECONCILIATION_REQUIRED. O workflow existente permite selecionar drive_mode=PROCESS_EXISTING dentro de operation=DRIVE_TOTAL para processar somente registros já vinculados ao escopo autorizado.

Esse modo conserva o fingerprint, os gates de proprietário, tenant, configuração, versão publicada, recuperação, trava compartilhada e HMAC por solicitação. Exige os cabeçalhos ID_ORIGEM, STATUS e OBSERVACAO; reutiliza o processador e o READBACK paginado existentes. Não enumera, não avança o cursor da varredura nem adota linhas legadas.

O coordenador verifica os recibos canônicos e versões imutáveis de cada lote. As paradas são fila drenada, ausência de tentativas, orçamento limitado sem progresso ou limite de lotes. complete permanece false; scopedQueueDrained descreve somente a fila do escopo. EXECUTE continua como padrão e não faz fallback automático.

Validação: 74 testes direcionados; cenário integrado sintético com 245 documentos scoped, 43 linhas legadas, uma linha de outro tenant e retomada após resposta perdida. Os módulos de scanner, extração e idempotência não foram alterados por esta mudança. A execução sobre dados reais exige os gates e a evidência normal do workflow.

## Releitura isolada e saneamento de vínculos — candidato de 23/10/2026

O mesmo workflow passa a aceitar `drive_mode=READBACK` em `operation=DRIVE_TOTAL`.
O coordenador executa PREVIEW e as páginas READBACK, conferindo a publicação
Apps Script e o fingerprint antes de cada página. Conserva os gates de identidade,
escopo, configuração, autorização e recuperação. Não chama o ciclo mutável, não
enumera, não extrai novamente e não altera tentativas, fontes ou checkpoints.

Cada linha do escopo precisa vincular `ID_ORIGEM` ao mesmo `fileId` da evidência,
inclusive quando já representa documento ou alias comprovado. Uma divergência
interrompe a leitura com código fixo; não corrige nem promove a linha por inferência.
O coordenador exige uma entrada privada para cada pendência e rejeita identidades
repetidas ou compartilhadas com documentos e aliases, inclusive entre páginas.

O resumo público `pendingDiagnostics`, versão `aurora.drive-pending-diagnostics.v1`,
agrega quantidade por código, estado da fila e classe de mídia, além de tentativas
registradas e contagens de versão/tentativas desconhecidas. Os valores usam listas
fechadas. `NOT_RECORDED` distingue ausência de código de `UNKNOWN`; metadados
inválidos permanecem desconhecidos. IDs, nomes, URLs, texto, hashes legados e
mensagens livres de erro não entram nesse resumo. A origem continua privada e
a leitura de metadados da fila não determina a causa de uma falha de conversão.

O contador superior `canonicalReadbacksVerified` reflete a cobertura canônica
verificada mesmo sem novos envios. O término usa `READBACK_VERIFIED` e
`READBACK_ONLY`; `complete` e `fullSynchronizationVerified` permanecem `false`,
mesmo com fila vazia. A prova de enumeração e a aceitação documental continuam
exigindo suas evidências próprias.

Este incremento parte de `d77fe7169442e5bac57b06ba2100416b1cc3d687` e precisa
de publicação Apps Script e execução autorizada correspondentes antes de ser
considerado comportamento observado. Os testes sintéticos verificam recibos
existentes, paginação, conflitos de identidade, privacidade, ausência de efeitos
e rejeição de mudança de publicação/escopo. Rollback usa código e publicação
anteriores, preservando a fila e os recibos; não requer reprocessar os dados.
