# Referência comum de componentes — candidata v2

Atualização candidata da beta `1.1.0-beta.2`: a integração Windows passa a
`1.0.2`, em destino próprio, preservando os componentes e o checkpoint existentes.
O agente permanece `1.0.1` e o diretório/identidade IA continuam preservados.
As versões abaixo descrevem a baseline histórica; a referência vigente depende
do certificado, da publicação e dos recibos atuais, nunca apenas deste documento.

Baseline: `a3ef7a65a56b6c29d74d5e92e0622e81bb0f5cbb`, 13/10/2026.
Estado desta candidata: IMPLEMENTED, regressões sintéticas locais aprovadas;
CI, revisão, deploy, endpoint e publicação v2 **NOT_DEPLOYED / PENDING**.
O run real `38457139904` publicou o certificado v1 existente, cuja cobertura é
PARCIAL. Este incremento não reescreve o ponteiro, sua assinatura ou seu histórico.

O desafio era a diferença entre a referência global e os pacotes locais: Server e
Web atestavam o fechamento compilado `lib/*.js`; Satellite atestava quatro
launchers HML. Isso não incluía o pacote IA Master local nem o fechamento do
adaptador/agente Windows. A representação reutiliza `AURORA-CANONICAL-RELEASE-001`
do registro nativo, sem outro robô, cron, executor, banco ou privilégio.

## Certificado e compatibilidade

O schema v2 exige exatamente `server`, `web`, `satellite`, `iaMaster` e
`windowsIntegration`. Cada pin conserva `version`, `sourceSha` e
`manifestSha256`; o `sourceSha` deve coincidir com a referência comum. As versões
dos componentes são próprias: produto/server/web `1.1.0-beta.1`, IA Master
`1.1.0`, integração Windows `1.0.1`, Satellite `0.2.0-hml.20261001` nesta baseline.
Não se afirma que esses números de versão são iguais.

Ed25519 assina `AURORA_ACTIVE_RELEASE_V2\0` seguido do JSON canônico com chaves
ordenadas recursivamente. Os bytes e o domínio `AURORA_ACTIVE_RELEASE_V1\0`
permanecem intactos para leitura de v1 e conferência do predecessor. v1 retorna
`componentCoverage.status=PARTIAL`, `complete=false`; nunca é promovido a
cobertura completa por flags. O writer de novas promoções exige v2.

`COMPLETE_SIGNED_COMPONENT_SET` significa somente que os cinco pins estão na
referência assinada e lida do ponteiro protegido. Recibos de instalação,
processamento, persistência/replay e aceite nativo continuam independentes.
`allClientsSynchronized=false` e `nativeMacInstallation=UNVERIFIED` permanecem;
o launcher Mac HML não recebe a identidade ou o aceite do aplicativo original.

## Bytes e entrega

O builder existente da IA Master gera o pacote real, com 34 arquivos públicos
mais seu `manifest.json` nesta candidata, incluindo os consumidores explícitos
adicionados por este incremento. Nenhum corpus, `control.key`, sessão, credencial,
configuração instalada ou modelo entra no pacote. O manifesto bruto da IA é
retido em `runtime-release/iaMaster-manifest.json`.

`windowsIntegration-manifest.json` declara `AURORA_WINDOWS_INTEGRATION`, plataforma
Windows e sete módulos: `aurora_cloud_sync.py`, `aurora_deployment.py`,
`client_agent.py`, `client_secret_store.py`, `install_client_agent.py`,
`provider_connectors.py` e `published_release.py`. Seus bytes vêm da pasta
`client-agent` do mesmo pacote real. Isso não ativa provedores nem muda os alvos
de entrada, sampleKey, checkpoint, operação ou credencial da instalação.

As pastas públicas `ia-master-package` e `windows-integration-package`, os dois
ZIPs reais e os cinco manifestos são retidos no artefato do deploy protegido.
Composição fechada, paths, links/hardlinks, tamanhos, hashes e ZIP são verificados.
Pacote gerado divergente não é sobrescrito. O publisher exige todos os manifestos
e os bytes reais de ambos os pacotes antes de assinar. A retenção CI não significa
instalação, atualização automática ou publicação de binário no portal.

## Leitor privado atual — endpoint futuro

Rota candidata: `GET https://auroranexus.com.br/api/integration/active-release`.
As duas configurações Hosting usam a função já existente
`auroraNexusIntegrationPing`. Não existe função nova. Somente bearer com o scope
existente `integration.read` é aceito; cookie ou declaração de MFA não substitui
a credencial. Organização, chave ativa/não expirada e membership/alçada do emissor
são revalidados, inclusive após as leituras aguardadas.

O cliente envia `X-Aurora-Release-Nonce`, exatamente 64 hex minúsculos gerados
para aquele request. Não são aceitos parâmetros de query, locators de documento,
tenant escolhido pelo request ou mutações. O servidor lê somente
`platformRuntime/activeRelease`, valida schema/Ed25519/gates, confere a assinatura
e os manifestos reais do runtime iniciado e exige correspondência com a fonte.
O ponteiro é relido após a conferência do runtime; promoção ou revogação entre
essas leituras negam a resposta. É uma leitura limitada no tempo, sem afirmar
transação distribuída entre ponteiro, credencial e estado de deployment.
Falha, revogação, fonte divergente, falta de build ou evidência indisponível negam
a resposta. Headers incluem `private, no-store, max-age=0` e `Vary: Authorization`.

Resposta fechada:

```text
schemaVersion: aurora.active-release-read.v1
source: platformRuntime/activeRelease
canonicalOrigin: https://auroranexus.com.br
orgId: organização da chave revalidada
requestNonce: nonce exato recebido
observedAtUtc: leitura atual do servidor
certificateSha256: hash dos bytes canônicos assinados
envelope: { certificate, signature }
runtime: { sourceSha, serverManifestSha256, webManifestSha256 }
componentCoverage: { status, complete, requiredComponents, coveredComponents, missingComponents }
nativeMacInstallation: UNVERIFIED
deviceInstallationVerified: false
```

Não há `currentPointer=true`, raw document, chave pública escolhida pela resposta,
token, UID/emissor, e-mail ou dados operacionais de cliente. `orgId` é o vínculo
mínimo necessário para o consumidor comparar com a organização local existente.
Um envelope isolado permanece `CANDIDATE_UNVERIFIED`; atualidade exige request
TLS legítimo na origem/rota fixas, sem redirect, chave pública de fingerprint
confiável, nonce e frescor conferidos, identidade organizacional, hash, fonte e
manifestos coincidentes. A chave delegada fica somente no processo; não extrair
cookie de navegador, usar Admin SDK como MFA ou elevar um booleano de confiança.

## Gates, testes e retorno

Main/PR/CI exatos, aprovação real do futuro run protegido, smokes, pair Ed25519,
tráfego pronto/CAS/readback, predecessor explícito e histórico create-only
permanecem. A revisão humana das quatro candidatas/gateway/R029 continua resolvida
no escopo registrado; este código posterior não recebe revisão independente
retroativa. R029 não foi prorrogada: corte `2026-10-15T03:00:00.000Z`, fim de 14/10
em São Paulo, ferramentas de teste HML somente. Produção e dado clínico não são
autorizados por esta candidata.

Regressões cobrem v1 parcial/v2 obrigatório, domínio de assinatura, fontes e roles
divergentes, bytes adulterados/ausentes/extras, links, replay/nonce, escopo,
expiração/revogação, membership, runtime e schema fechado. Os testes de endpoint
usam adapters e chaves sintéticos; não são autenticação HML ou publicação real.

Rollback de código: reverter este incremento e preservar históricos assinados.
Não converter ou reassinar o v1 publicado. Um futuro v2 publicado exige reconciliar
ponteiro/histórico e o predecessor antes de qualquer reversão operacional. O Mac
original continua sujeito à identificação e ao aceite do mesmo aplicativo.
