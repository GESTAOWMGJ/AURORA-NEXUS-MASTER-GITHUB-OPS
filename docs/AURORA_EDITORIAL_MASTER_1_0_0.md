# AURORA Editorial Master — marketing institucional 1.0.0

O método incorpora a orientação autorizada de 26/10/2026 para preservar a
identidade Personalité em timbrados, convites e manuais. A fonte reutilizável é
`desktop/ia-master/knowledge-records/editorial-master.v1.json`, registro
`AURORA-EDITORIAL-MASTER-001`. A marca solicitada continua sendo o contexto de
cada entrega: o preset Personalité não substitui JFN ou a marca de outro tenant.

## Integração existente

O registro alimenta o loader `desktop/ia-master/knowledge-registry.cjs`, sem
alterar seu esquema ou orçamento. Referencia `AURORA-PERSONALITE-001`, sua
capacidade `AURORA-PERSONALITE-MEDIA-001` e `AURORA-IA-MASTER-001`, já representadas
em `nativeRoutineSummary()`. É referência editorial, não rotina executora,
agendamento, banco, autoridade de publicação ou nova versão binária do produto.

O corpus instalado e a memória privada de aprendizagem permanecem fora do Git.
O repositório recebe apenas o método sanitizado e seus testes. O convite pessoal,
identificação de destinatários, contatos, documentos privados e imagens de
terceiros não integram esse registro. Distribuição a outros tenants exige revisão
e contexto próprios, sem herdar dados ou permissões do tenant de referência.

## Conteúdo retido

- Paleta creme, petróleo, dourado e oliva; wordmark aprovado e acento Personalité.
- Composição arejada, arcos e botânica discretos, hierarquia e timbrado consistentes.
- Texto integral em camada editável, PDF legível, revisão de todas as páginas.
- Convites acolhedores no grau autorizado e manuais didáticos com estado factual.
- Proteção contra títulos/assinaturas órfãos, estilos herdados e texto rasterizado.
- Separação entre produção de material, envio, publicação e ativação do software.

## Adoção e verificação

Antes de alterar o corpus instalado: conferir organização, hash do loader,
esquema, versão e hash do corpus. Preservar os registros existentes e criar backup
dos bytes anteriores. Aplicar a adição por escrita atômica com comparação da
baseline; conflito interrompe o procedimento. Repetição do mesmo registro deve
ser idempotente; mesmo ID com conteúdo diferente exige revisão explícita.

Conferir o hash por releitura e `/api/status`. Verificar seleção por linguagem
natural no loader e solicitar uma resposta pelo `/api/improve` existente, com
recibo que inclua este ID e o hash atual. A memória privada do ciclo usa o
adaptador já instalado `motor-learning.v1.cjs`, depois da conferência de seus
bytes, sem imprimir credenciais ou transferir conteúdos entre organizações.

O registro pode ser `REGISTERED` como método editorial, mantendo
`technicalState=SPECIFIED`: isso não transforma uma recomendação de conteúdo em
executor implementado. O resultado do modelo continua `PROPOSAL_ONLY` e exige
revisão. Corpus carregado, seleção, resposta correta e envio são fatos distintos.
O Studio conserva o limite de 600 bytes e não comporta este registro completo;
não há alegação de adoção nesse canal. Pesos do modelo e cloud não são atualizados
por este procedimento. Metadados históricos de instalação não devem ser
reescritos para fingir uma nova instalação binária.

### Evidência observada em 26/10/2026

Na instância local autorizada, o corpus passou de 1.0.2 para 1.0.3, de 22 para
23 registros carregados, sem rejeições e preservando integralmente os 22
registros anteriores. Backup, hash anterior/novo, leitura posterior e recibos
permanecem no armazenamento privado existente. O SHA-256 do arquivo-fonte
editorial é `b23b26965ac450045ed90344a8ded1076a052f2c19b2881efeb798975997e801`.

A consulta nativa selecionou `AURORA-EDITORIAL-MASTER-001` e o modelo local
respondeu com os quatro códigos de cor corretos, preservação da marca JFN,
revisão das páginas e distinção entre material, ativação e permissão de envio.
O adaptador persistiu a resposta como `PROPOSED`; repetição recuperou o mesmo
registro sem nova inferência. A conferência foi feita pelo assistente em uma
consulta limitada, não por auditor independente. Não comprova todas as respostas
futuras, Studio, cloud ou adoção em outros tenants.

Os 35 testes locais de registro, recuperação editorial e servidor passaram.
A primeira tentativa do teste de servidor falhou por ausência de
`AURORA_TEST_BUILD`; a execução correta usou o pacote de teste gerado pelo
`build.py` e as variáveis previstas no workflow. Esse pacote dirty é exclusivo
de teste e não foi instalado. O workflow existente passa a incluir também
`editorial-knowledge.test.cjs`; CI do novo commit deve ser confirmado pelo SHA.

## Testes e reversão

`node --test desktop/ia-master/knowledge-registry.test.cjs desktop/ia-master/editorial-knowledge.test.cjs`
verifica seleção integral, revogação sem perda dos demais métodos e exclusão
honesta quando não há orçamento. Testes de servidor cobrem o transporte nativo.

Reverter revogando este ID com preservação do histórico, confirmar exclusão na
seleção seguinte e conservar recibos. Backup integral só pode ser restaurado
após conferir que não apaga alterações posteriores. Esta entrega não altera
tenant, credencial, permissão, paciente, interface do portal ou estado de produção.
