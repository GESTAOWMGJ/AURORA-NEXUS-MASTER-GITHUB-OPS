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
