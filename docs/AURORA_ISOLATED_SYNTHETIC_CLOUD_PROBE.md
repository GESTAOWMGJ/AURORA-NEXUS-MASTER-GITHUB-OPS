# Homologação isolada dos formatos Cloud

O workflow manual `aurora-cloud-synthetic-hml.yml` reutiliza o projeto, ambiente,
OAuth/clasp e bridge HMAC existentes. É uma ferramenta de homologação sintética,
sem outro pipeline operacional, cron, registro de fontes ou fila global. Preparar
fonte/testes não executa a ferramenta. Não há aprovação automática de instalação.

Após revisão, CI e publicação exata pelo `deploy-appscript.yml`, o titular pode
aprovar o environment `firebase-homologation` para o SHA corrente de main e a
confirmação `RUN_ISOLATED_SYNTHETIC_HML_PROBE`. O workflow não chama o helper
`ensure-appscript-execution-deployment.sh`, pois esse helper publica/reimplanta.
Lê o deployment canônico existente e exige sua descrição/SHA e versão numérica;
`clasp pull --versionNumber` lê essa versão. Hashes normalizados apenas de CRLF
do probe, extrator e bridge, além do manifesto, devem corresponder à fonte local.
As funções realmente executadas calculam seus próprios hashes antes de criar
arquivos. A versão é relida após a execução; mudança bloqueia a prova.

A única entrada operacional é `auroraExecutarProbeNuvemSinteticaHml` via Execution
API não-dev. Não recebe IDs/pastas/documentos/URLs arbitrários. Exige HML exato,
organização `wmgj`, confirmação, nonce, fonte, hashes e validade curta dentro da
janela de aprovação já existente (sem estendê-la). ActiveUser e EffectiveUser
devem estar presentes, coincidir e corresponder ao hash Master autorizado antes
de qualquer leitura de configuração sensível ou criação Drive. `ANYONE` no
manifesto e aprovação CI não substituem essa guarda. E-mail ausente ou outra
identidade OAuth bloqueiam; não se ampliam allowlists nem credenciais.

A validade é reavaliada antes de cada nova operação iniciada pelo probe, de cada
POST/retry HMAC, dos requests do coordenador/readback e antes de reconhecer PASS.
Uma operação Google já iniciada pode terminar após o prazo: não há cancelamento
atômico nem hooks nas requests internas do extrator legado. O probe revalida
imediatamente após extrair e antes do próximo efeito. O cleanup restrito dos IDs
sintéticos já criados continua permitido após o prazo; resultado tardio não vira
PASS.

O prazo HML/R029 foi renovado expressamente pelo titular em 14/10, no mesmo
escopo, até `2026-10-16T03:00:00.000Z` (16/10 00:00 em Brasília), conforme
`hml-owner-release-approval-v1.json`. As constantes do probe e readback conservam
esse hard cutoff; a autorização não se estende automaticamente nem libera
produção, dados clínicos ou nova alegação de revisão independente.

Cria uma nova pasta marcada e quatro arquivos novos: Google Doc, Google Sheets,
texto e PDF exportado daquele Doc. Extratores existentes devem retornar conteúdo,
método correto e o nonce; OCR/metadados falhos continuam FAIL/PENDING. Não chama
modelo, não classifica dados de cliente nem acessa raízes configuradas. Um objeto
de classificação fixo descreve somente a fixture sintética verificada. O bridge
usa documentType `OTHER`, competência de teste `2026-05`, sem valores financeiros
ou contagens de produção. O campo canônico `sourceContext` conserva marcador,
formato e SHA256 do texto realmente extraído; OCR não comprova fatos financeiros
nem revisão humana. O bridge
original cria `sourceDocument` e usa o mesmo transporte/HMAC/retry. A configuração
local por chamada usa `dryRun=false`, sem alterar ScriptProperties, e seu logger
não escreve em planilha. O wrapper operacional original mantém config/logger.

As provas são separadas: extração, ACK autenticado/replay e materialização
canônica. O plano privado contém só IDs criados nessa chamada; o runner usa WIF
HML existente para GET de exatamente sourceDocument, versão imutável e recibo de
idempotência de cada fixture (12 documentos), comparando hashes/identidade/revision.
Não lista coleções nem consulta documentos reais. Apenas hashes/estados chegam ao
artefato; plano, código remoto, OAuth, headers e IDs permanecem fora do artefato
e dos logs. ACK sozinho não atesta processamento, projeção ou instalação.
O SHA atribuído cobre versão Apps Script e runner. Não é observação independente
do SHA do runtime Functions. Scope HMAC `sourceDocument` e permissão WIF de leitura
precisam existir: rejeição bloqueia, sem alterar keyring/grants.

Os arquivos/pasta criados diretamente pelo probe só são enviados à lixeira após
validar seu marcador, parent e identidade em memória. Não há busca/limpeza por
prefixo nem exclusão permanente. OCR usa o cleanup legado do extrator: apenas o
ID retornado por `Drive.Files.copy` nesta chamada sobre o PDF novo; esse cleanup
interno não ganhou validação de parent/marcador. Interrupção/erro pode deixar
artefatos marcados recuperáveis; nunca se infere limpeza concluída sem resultado.
Eventos, versões e auditoria canônicos sintéticos ficam preservados.

A intenção de criação e o ID ou sua incerteza são registrados antes de obter o
handle Drive de Docs/Sheets. Uma falha após criar, inclusive na resposta de criação
ou em `getFileById`, conserva `unresolvedCreationCount` e impede
`cleanupVerified=true` e PASS. Não se busca nem adota um arquivo por nome para
encobrir a perda do handle.

PASS aqui cobre quatro formatos sintéticos no escopo explícito. Não comprova
enrollment/refresh OAuth por cliente, quatro métodos de aquisição reais, escopo
global, automação configurada, DTO de aceite ou beta instalada. Esses gates
continuam próprios. O caminho RC1.1 de recovery/amostra real não é usado.

Referências oficiais: [clasp pull versionado](https://github.com/google/clasp/blob/v3.4.1/src/commands/pull.ts),
[scripts.run](https://developers.google.com/apps-script/api/reference/rest/v1/scripts/run),
[Session](https://developers.google.com/apps-script/reference/base/session).
