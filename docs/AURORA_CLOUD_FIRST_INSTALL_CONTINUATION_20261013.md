# Nuvem do cliente e primeira instalação — 13/10/2026

Baseline: `067aecf14d0b0119b204bf2ec6e7cd892aed9586`. Mesmo produto,
M01/M08/M10 e rotina `AURORA-INSTALL-INTEGRATION-001`; não cria outro motor.

## Requisito e incremento

O titular autorizou primeira instalação plug and play com os conectores e chaves
necessários à operação e continuidade da ingestão até o fim do escopo do cliente.
O agente 1.0.0 consultava repetidamente a primeira página dos provedores. O 1.0.1
continua Drive/Gmail por pageToken, Microsoft Mail por nextLink estritamente
vinculado à mesma pasta, e IMAP por UIDVALIDITY/UID em leitura somente.

No estado protegido já existente, cursores só avançam após recibos de processamento
de todos os documentos estruturados da página. A página em curso tem fingerprint
estável: mudança exige reconciliação, sem descartar pendência. Queda depois do commit
remoto retoma a mesma chave canônica. Uma nova travessia após EOF descobre alterações
e reutiliza recibos, sem duplicar documentos. Lotes respeitam limites de recurso;
o mesmo watch continua após a primeira instalação, sem outro scheduler.

`cloudEnumerationComplete` confirma somente travessia do escopo delimitado.
`cloudSnapshotVerified` também exige recibos processados e ausência de extrações
pendentes. `fullSynchronizationVerified` permanece false: listagem/um documento não
comprovam cobertura de toda a empresa, formato não suportado ou estado financeiro.
PDF/XLS/XML e outros formatos continuam pendentes de extração pelo fluxo existente.
Microsoft com paginação de anexos bloqueia avanço, sem omissão silenciosa.

## Provisionamento necessário por cliente

Incremento de 15/10/2026: reutilizar primeiro a fonte e a autorização já existentes
na mesma organização. O preview de reaproveitamento da WMGJ verifica somente
configuração, acesso aos metadados e gatilhos existentes; não lê documentos,
não concede OAuth e não instala outro executor. Registro inativo não equivale
a ingestão ou ativação. Conflitos de pasta, tenant, configuração e gatilhos exigem
reconciliação, preservando a fonte original.

No aceite de instalação, todas as fontes configuradas precisam de acesso atual,
processamento e replay verificados. Fontes com paginações de tamanhos diferentes
devem continuar pelo mesmo estado, sem perder recibos. EOF ou recibo em cache não
substitui revalidação; autorização vencida, extração pendente e mudança da página
em curso impedem a conclusão. Essa regra integra a rotina existente no motor;
implantação e teste real dos provedores continuam sendo evidências próprias.

1. Identidade autenticada e vínculo empresarial vigente no destino aprovado.
2. Fontes explícitas: pasta Drive, label Gmail, pasta Microsoft ou pasta IMAP.
3. Credencial AURORA com `documents.ingest`, emitida pela API administrativa
   existente com sessão, MFA e alçada. Nunca reutilizar chave de outro cliente.
4. Consentimento e tokens OAuth oficiais dos provedores configurados. IMAP exige
   OAuth2/TLS; o agente não coleta senha do provedor nem contorna consentimento.
5. Segredos em DPAPI/Keychain no componente protegido, fora do navegador/argv/log.
6. Instalação autorizada com `--startup --start-now`; tenant validado antes de
   qualquer leitura da origem; teste real do conector, recibo e versão/hash processados.

Adaptadores presentes e empacotados não significam que essas etapas ocorreram.
O incremento OAuth Google desktop abaixo oferece renovação protegida no código;
configuração e consentimento reais continuam pendentes até comprovação própria.
Renovação dos demais provedores e extração de todos os formatos permanecem
dependências abertas. Não há criação de identidade/chave de terceiros apenas
pelo código nem transmissão sem credencial própria válida.

## OAuth Google desktop — candidato de 15/10/2026

Baseline deste incremento: `6a21a03d616f5e7f3b89075f7854309d1bb5bbde`.
O mesmo agente cliente passa para `1.0.3`; Windows Integration passa para
`1.0.5`, preservando checkpoints `1.0.0` a `1.0.4`. O pacote mantém seus sete
arquivos de integração e os 34 arquivos da IA Master. Não há outro executor,
scheduler, banco ou ativação de fonte por este registro.

Cada fonte Google Drive aceita uma destas configurações, mutuamente exclusivas:

```json
{"provider":"GOOGLE_DRIVE","folderId":"<pasta-autorizada>","tokenEnv":"<referencia-legada>"}
```

```json
{
  "provider": "GOOGLE_DRIVE",
  "folderId": "<pasta-autorizada>",
  "oauth": {
    "schemaVersion": "aurora.google.oauth.source.v1",
    "clientId": null,
    "credentialRef": "AURORA_GOOGLE_OAUTH_<32_HEXADECIMAIS_MAIUSCULOS>",
    "scopeProfile": "DRIVE_READONLY_EXISTING_FOLDER"
  }
}
```

O segundo exemplo é um modelo pendente, não uma configuração pronta para uso.
`credentialRef` representa a referência gerada e vinculada à configuração da
fonte, sem token no JSON. `google_oauth_credential_ref(org, instanceId, folderId)`
calcula os 32 caracteres hexadecimais maiúsculos; um valor arbitrário não serve.
`clientId` aceita `null` ou um identificador público;
o operador deve fornecer o de um cliente OAuth Google do tipo Desktop. A
validação do formato não comprova tipo, titularidade ou aprovação do cliente.
Não há client secret empacotado,
client ID universal fabricado nem herança de credenciais entre organizações ou
dispositivos. Sem client ID, o diagnóstico é `PENDING_CONFIGURATION`: não abre
navegador, não lê o segredo e não solicita a rede.

Depois de preparar a configuração explícita no destino do agente existente,
o operador pode consultar o estado ou iniciar o consentimento localmente:

```text
python aurora-coletor/install_client_agent.py --target <mesmo-destino> --google-oauth-status <indice-da-fonte>
python aurora-coletor/install_client_agent.py --target <mesmo-destino> --authorize-google-drive <indice-da-fonte>
```

O índice começa em zero. Essas operações são exclusivas entre si e com
instalação, continuação, inicialização, desativação ou configuração de segredos.
O diagnóstico `PROTECTED_GRANT_PRESENT` comprova apenas presença de um registro
protegido compatível; não comprova validade atual no Google, aquisição ou instalação.
O consentimento é opt-in: navegador externo oficial do provedor, callback
loopback local, state e PKCE S256. Código de autorização, verifier e state
permanecem na memória durante a tentativa. Access token e refresh token são
persistidos somente no mesmo bundle protegido pelo DPAPI do usuário atual no
Windows ou pelo Keychain no macOS; o adaptador recebe o access token em memória.
Não entram no JSON de configuração, recibo, log ou argumento de processo.
O registro fechado usa Base64URL sem padding, no máximo 16.384 caracteres, dentro
da proteção DPAPI/Keychain existente. Base64URL é codificação, não criptografia.
Organização, instância, pasta, client ID, perfil e alias vinculam o registro;
troca incompatível bloqueia. Renovação e CAS usam uma trava para o mesmo item
protegido; no Mac a trava acompanha o escopo global do item Keychain.
Não copiar sessão Aurora,
cookies, senha, código MFA ou credencial entre dispositivos. Concessão negada,
expirada ou revogada mantém pendência para nova autorização oficial.

O perfil solicita `https://www.googleapis.com/auth/drive.readonly`. Esse escopo
Google é amplo e classificado como restrito; não é um consentimento limitado
àquela pasta. O Aurora aplica sua própria fronteira de pasta explícita em cada
aquisição, sem ampliar a configuração automaticamente. `drive.file` seria um
perfil alternativo e não está implementado: acesso a uma pasta escolhida não
pode ser apresentado como prova de acesso aos filhos sem validação específica.
A configuração e eventual verificação do aplicativo Google são dependências
externas; nenhuma aprovação do provedor é inferida dos testes sintéticos.
É necessário habilitar Drive API e cadastrar ou confirmar um cliente Desktop
próprio do Aurora no projeto autorizado, com tela de consentimento e usuário de
teste quando aplicável. A documentação Google marca `client_secret` como opcional
nesse fluxo; este incremento não o recebe. Recusa do cliente permanece pendência
de configuração, sem fallback para cliente web, clasp ou conector do Codex.
Aplicativos External/Testing podem receber refresh token de sete dias; isso não
é continuidade de distribuição comprovada. Referências oficiais:
[OAuth desktop](https://developers.google.com/identity/protocols/oauth2/native-app),
[escopos Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
e [expiração de refresh token](https://developers.google.com/identity/protocols/oauth2#expiration).

O consentimento não instala nem ativa o agente. Renovar o access token permite
tentar a aquisição no watch existente, mas `sourceReady` e o aceite da instalação
continuam exigindo acesso fresco à fonte, todas as páginas autorizadas, ausência
de extrações pendentes, processamento canônico, recibos persistidos, replay e
configuração da automação vigente. Um refresh bem-sucedido não satisfaz esses
gates. Não há ativação de tenant, alteração de IAM/backend ou fonte real neste
incremento.

O escopo é Google Drive em Windows/macOS. Não adiciona OAuth iOS, renovação de
Gmail, Microsoft Mail ou IMAP, nem exportação de Google Docs/Sheets nativos ou
extração de PDF no agente. Esses formatos continuam pendentes no agente quando
não há adaptador existente compatível; o extrator Apps Script mantém seu estado
`LEGACY_MIRRORED` e sua validação própria. O registro `cloudIntakePolicy` incorpora
a capacidade abstrata e os limites no motor, sem declarar instalação plug and
play comprovada. Código, testes sintéticos, CI no SHA final, promoção assinada,
consentimento real e aceite de cada dispositivo permanecem provas separadas.

## Continuidade MANUAL do instalador — candidato de 15/10/2026

A rotina existente `AURORA-INSTALL-INTEGRATION-001` reaproveita a importação
manual feita pelo usuário no portal canônico, com login/MFA e configuração
autorizada. O componente de integração avança para 1.0.4, preservando a leitura
dos checkpoints 1.0.0 a 1.0.3. Para instalar por `--integration-method MANUAL`, usar o mesmo JSON
administrativo já importado e uma credencial de integração vigente com
`integration.read`, no ambiente protegido do processo.

O instalador consulta duas vezes o recibo do documento exato pela rota existente
`GET /api/integration/ping?documentId=...`. Confere organização, processamento,
versão, fatos e hash canônicos, recibo, replay persistido e configuração vigente,
exigindo método MANUAL nas duas respostas. Divergência desses vínculos ou revogação
bloqueia a instalação. O endpoint não atesta igualdade de campos do JSON que não
integram a projeção canônica. A releitura
não transmite o documento, não configura automação e não copia cookies, sessão ou
código MFA. O replay pertence à operação manual realizada no portal; a saída
explicita que o instalador não o executou.

Esse caminho não escreve no checkpoint compartilhado nem na âncora da IA Master.
A trilha API_TOKEN conserva os requisitos de transição explícita antes de escrita.
Falha de autorização ou prova continua bloqueando a promoção do cliente.

Código e testes sintéticos desse candidato não comprovam instalação distribuída,
consentimento OAuth, extração de documentos comuns ou ingestão global. A adoção
exige CI na fonte final, promoção assinada e execução real pelo mesmo instalador.
Rollback usa o pacote anterior e os backups existentes; nenhum dado-fonte é apagado.

## Aquisição documental estruturada — candidato de 15/10/2026

Incremento delimitado do mesmo agente: componente Windows Integration 1.0.6 e
clientAgent 1.0.4, preservando checkpoints anteriores. O OAuth 1.0.5 não comprovava
aquisição de bytes. Este incremento acrescenta `aurora.document.acquisition.v1`
opcional ao contrato da API existente, sem alterar o payload legado sem prova.
O registro nativo `cloudIntakePolicy.documentAcquisitionEvidence` expõe a
capacidade e seus limites; não concede acesso nem cria executor ou banco.

O adaptador Drive seleciona parser pelo MIME informado pelo provedor, sem confiar
no nome. Suporta JSON canônico, CSV com cabeçalhos canônicos e XLSX canônico de
uma aba. Google Sheets usa a exportação CSV da primeira aba; não são bytes
nativos do workbook e a exportação não comprova cobertura de todas as abas.
O download/export é somente leitura, limitado a 1 MiB, com os limites menores
dos parsers JSON/CSV preservados, TLS e rejeição de redirecionamento existentes.
A versão opaca numérica do mesmo objeto é observada na listagem e novamente
após adquirir os bytes. Mudança de versão/MIME/identidade deixa pendência.

Cada registro materializado mantém os fatos estruturados úteis já aceitos pela
API, com hash do objeto opaco, versão observada, MIME da fonte/representação,
SHA-256 e tamanho dos bytes adquiridos, extrator/método/versionamento, posição e
contagem dos registros. `textFormat=CANONICAL_RECORD_JSON` e `textSha256` referem-se
apenas à representação JSON normalizada daquele registro, nunca ao texto integral
do documento. `rowFactsSha256` vincula a prova aos mesmos 14 campos normalizados.
O servidor valida esse vínculo e devolve o hash da prova persistida; o cliente
exige esse reconhecimento além dos recibos de processamento existentes.
O hash também é relido da versão imutável atual na prova de processamento;
recibo antigo com fatos iguais não pode substituí-lo pelo de outra aquisição.
Metadados declarados pelo cliente autenticado não são assinatura do Google nem
recomputação do hash de arquivo pelo servidor, que não recebe os bytes originais.

`canonicalSnapshotHash` e `source.contentHash` legados continuam sendo hashes dos
fatos, com `hashMethod=canonical_structured_sha256`. O SHA-256 dos bytes fica em
`source.acquisition.byteSha256`, com seu hash de prova separado. A evidência entra
na mesma transação `sourceDocuments/entityVersions/apiIdempotency/auditEvents` e
checkpoint existentes. Nova versão observada do mesmo objeto com os mesmos fatos
pode acrescentar revisão imutável, sem inventar novo `sourceVersion` financeiro.
Mesma versão observada com prova diferente, regressão ou troca de objeto são
conflitos. Mudança de fatos continua exigindo evolução do `sourceVersion` declarado
na fonte. Repetição exata permanece idempotente. Documento que já tem prova de
aquisição não pode perdê-la silenciosamente numa atualização sem essa prova.

Formato não extraído conserva identidade opaca, MIME e versão na tabela `intake`
do SQLite já existente, sem nome, caminho, texto bruto ou segredo. A página não
avança até processar todos os registros e resolver essas identidades/versões.
Desaparecimento do arquivo ou nova versão não encerram pendência antiga. Somente
todos os registros da mesma versão com recibos confirmados podem resolvê-la;
a resolução preserva hashes e referências dos recibos. Adaptadores legados que
possuem apenas contagem mantêm uma barreira agregada explícita, sem inventar IDs.
Contagens de pendência em cursores legados são preservadas nessa mesma fila antes
de uma nova travessia; exigem reconciliação e não podem sumir com o rescan.

Google Docs, PDF/OCR, documentos livres, pastas filhas, exportação de todas as
abas e extração semântica financeira continuam pendentes. O extrator Apps Script
existente permanece `LEGACY_MIRRORED`; nenhum fallback regex vira fato financeiro.
Não se persistem texto clínico nem documentos reais por este candidato. Testes
sintéticos de bytes, paridade Python/TypeScript e retomada da fila não comprovam
consentimento, Drive real, transação em HML ou instalação atualizada. Os gates de
processamento, replay e automação da instalação permanecem obrigatórios.

Rollback preserva a fila e o histórico. Agente antigo não entende as barreiras
novas; portanto não pode ser usado para declarar instalação/ingestão concluída
enquanto houver pendências documentais sem reconciliação explícita.

## Evidências separadas desta sessão

- PR #244 integrado em `067aecf1`; P2 de recibo de domínio resolvido.
- Cliente Mac existente identificado, backup integral com hashes conferido,
  identidade e recursos preservados; launcher atualizado para
  `2026.10.13-beta.1` e `https://auroranexus.com.br/portal`.
  Diagnóstico nativo passou e o sistema aceitou a abertura do aplicativo.
- Probe no Mac: portal 200 com formulário de senha, bootstrap anônimo
  401/AUTH_REQUIRED, projeto HML esperado conferido. Isso não prova login do titular.
- Fonte WMGJ: metadados da planilha mestre e pasta operacional conferidos;
  59 abas identificadas. Amostra de cabeçalhos do índice Gmail diverge entre
  layouts; amostra de memória contém fallback de metadados. O backfill atual não
  mapeia todas as abas. Nenhum desses registros foi promovido a fato financeiro.
- Xeon: comando de status aceito pelo TRIGGERcmd sem recibo de execução.
  Inventário Desktop Commander mostra Windows offline. Nenhuma ingestão completa
  ou implantação do agente foi comprovada nesse dispositivo nesta sessão.

## Publicação pelo fluxo existente

O deploy/publisher run `38435627327` teve os três jobs relidos com sucesso;
o recibo versionado em `0fca3cb2ff95f74bd60724dde83655e7a0991181` confirma
activeRelease ACTIVE em `a89d431c` e certificado
`a71a53a3cfa56005b30b793defe73be188d9a4a079f199974b390826ba7d58f5`.
O request HML deste incremento usa esse predecessor explícito e a baseline
ancestral aprovada. O dispatcher existente resolve CI e PR no SHA novo e o
publisher exige compare-and-swap; promoção concorrente bloqueia, sem sobrescrita.
A execução e eventual aprovação do environment continuam sendo provas próprias.
Não repete ingestão maio/2026, restore, rotação HMAC ou reconciliação já realizada.

## Validação, motor e retomada

Testes sintéticos executam o transporte e os recibos reais com respostas simuladas:
paginação, isolamento, prova pendente, formatos não extraídos, alteração de página,
repetição idempotente e crash real de processo antes/depois do commit remoto.
CI, por SHA, pertence ao PR deste incremento. `cloudIntakePolicy` incorpora a regra
abstrata ao registro nativo existente e à projeção; código não significa adoção no
runtime cloud/Xeon, nem treinamento de pesos ou ingestão WMGJ concluída.

Retomar pelo executor existente quando acessível: conferir versão/hash e identidade,
ler configuração e status sem exibir segredos, reconciliar filas/cursores, validar
consentimentos, executar o watch e conferir cobertura/recibos até EOF e extrações.
Cobertura total fica PENDING até manifestos das fontes e comparação de contagens,
hashes, pendências e documentos recuperáveis. Dados clínicos sensíveis mantêm seus
gates próprios; não entram no fluxo administrativo para contornar essa dependência.

Rollback: versão anterior do agente preserva intake/recibos; tabelas de progresso
novas podem permanecer sem uso. Restaurar o launcher pelo backup privado conferido,
apenas se os arquivos ainda corresponderem ao recibo da atualização; não apagar
fontes, credenciais, dados ou recursos cloud. Não iniciar executores equivalentes.
