# AURORA NEXUS — preparação de distribuição iOS

Data de referência: 15/10/2026. Este pacote é preparação técnica, não publicação.
A configuração `identity.json` começa bloqueada, com identificadores ausentes.
Nenhuma identidade Apple, assinatura, conta ativa, IPA, convite TestFlight ou
página da App Store é inferida por este documento ou pelos testes sintéticos.

## Identidade e pré-requisitos

Preservar `AURORA NEXUS`, o portal canônico, autenticação/MFA, isolamento por
organização e a identidade visual aprovada. O bundle do aplicativo Mac existente
não deve ser copiado para o iOS por suposição. Reutilizar o App ID iOS existente
na equipe Apple, caso haja um; não registrar outro antes dessa verificação.

| Requisito | Evidência / ação indispensável |
|---|---|
| Apple Developer Program | Account Holder confirma membership ativa, equipe correta e acordos vigentes. Se expirada, renova a mesma conta; se não inscrita, conclui inscrição e validação. Nenhum pagamento ou aceite contratual é executado por este pacote. |
| Titularidade jurídica | Conferir pessoa/organização vendedora. Inscrição organizacional requer entidade legal e requisitos Apple, inclusive D‑U‑N‑S quando aplicável. Não converter uma conta individual silenciosamente. |
| Bundle ID explícito | Identificador lido em Certificates, Identifiers & Profiles e no registro correto do App Store Connect. Não usar a identidade local de simulador nem inventar um valor definitivo. |
| Team ID / App ID Prefix | Registrar ambos separadamente. Um prefixo legado pode ser diferente do Team ID. |
| App Store app ID / SKU | Confirmar o registro iOS correto e seu ID numérico. SKU é definido no cadastro Apple; não é o Bundle ID nem o releaseId. |
| Certificado Apple Distribution | Chave privada disponível apenas no keychain autorizado; SHA‑256 do certificado público coincide com o aprovado e com o perfil. Nunca commitar P12, senha, chave privada ou P8. |
| Perfil App Store Connect | Perfil iOS explícito, válido, da equipe/bundle certos, com o único certificado aprovado. Sem dispositivos Ad Hoc, provisionamento Enterprise, debug ou novas capacidades. O operador o instala pelo mecanismo oficial do Xcode. |
| Ícone aprovado | PNG RGB 1024 × 1024, sem canal alfa, derivado da identidade original; SHA‑256 aprovado. Nenhum ícone genérico é criado para preencher essa ausência. |
| Export compliance | Revisão explícita do aplicativo completo e criptografia utilizada. Não preencher `usesNonExemptEncryption=false` apenas porque há HTTPS. Documentação adicional Apple, quando requerida, é etapa própria. |
| Ferramentas | Xcode 26+ e SDK iOS 26+ em Mac/runner autorizado. O destino mínimo iOS 16 é preservado. Windows prepara/testa código; não produz archive iOS. |

A ausência de variáveis/nomes de segredos Apple no repositório não prova inexistência
de certificados na conta Apple. A conta não foi inspecionada em sessão autenticada
nesta preparação. O relatório operacional anterior informava membership inativa.

## Configuração pública, segredos privados

`identity.json` contém somente identificadores, decisões e hashes públicos. Seu
preenchimento exige revisão vinculada ao commit. Os valores nulos são deliberados:
qualquer execução normal de `distribution.py` permanece bloqueada enquanto faltarem.

O perfil e o ícone são entradas por caminho explícito, fora do repositório. O perfil
é decodificado no Mac e confrontado com a identidade revisada; não é descoberto por
varredura de contas ou keychains. O certificado/chave já devem estar provisionados
pelo operador. Não há importação, criação ou instalação de credenciais neste código.
O perfil decodificado isoladamente não certifica registro/assinatura Apple; o export
assinado passa por verificação adicional e a Apple valida o upload separadamente.

## Fluxo executável

1. Concluir identidade/perfil/ícone e revisão, integrar somente após os gates do
   repositório e obter checkout limpo do SHA aprovado.
2. Confirmar o próximo `CFBundleVersion` no App Store Connect. O caminho inicial
   aceita inteiros de 1 a 9999; não reinicia contador, não modifica a versão canônica
   do produto e não confunde o sufixo beta interno com a versão numérica da loja.
3. Usar Mac dedicado ou runner Apple autorizado com perfil instalado e certificado
   de distribuição utilizável. Não executar cargas no MacBook de supervisão.

Comandos ilustram os parâmetros, não constituem execução realizada:

```sh
# Sem assinatura: valida somente o cadastro fechado; falha com a identidade nula.
python3 desktop/ios/distribution.py

# Define parâmetros locais com os valores/caminhos efetivamente revisados.
# EXPECTED_SHA deve ser o SHA completo aprovado, não simplesmente qualquer HEAD.
python3 desktop/ios/distribution.py --prepare \
  --profile "$APP_STORE_PROFILE" --icon "$APPROVED_ICON" \
  --expected-source-sha "$EXPECTED_SHA" --build-number "$BUILD_NUMBER"

# Solicitação explícita de archive + export local, nunca upload automático.
python3 desktop/ios/distribution.py --archive \
  --profile "$APP_STORE_PROFILE" --icon "$APPROVED_ICON" \
  --expected-source-sha "$EXPECTED_SHA" --build-number "$BUILD_NUMBER"
```

A configuração habilita assinatura somente em **app / Release** e arquivamento
somente do app. Debug, projeto e UI tests permanecem sem assinatura. O scheme e o
catálogo de ícones são gerados; a política WebKit, URL, MFA e capacidades não mudam.
`ExportOptions.plist` usa `app-store-connect`, assinatura manual, export local e
`manageAppVersionAndBuildNumber=false`. Não usa provisionamento automático nem
cria identidades Apple. O build falha quando a identidade instalada não é utilizável.

Saídas ignoradas pelo Git, todas em `desktop/ios/Generated/`:

| Saída | O que comprova |
|---|---|
| `DistributionPreparation.json` | Configuração validada contra entradas fornecidas; `PREPARED_NOT_SIGNED`. |
| `Distribution.xcarchive` e `Export/*.ipa` | Artefatos somente após Xcode executar. Não são criados nos testes locais Windows. |
| `SignedExportReceipt.json` | Após verificação do IPA: identidade, versão, fonte, certificado SHA‑256, assinatura, entitlements e hash do IPA. Estado `SIGNED_IPA_VERIFIED_LOCALLY`, ainda sem TestFlight/App Store/aceite real. |

A proveniência embarcada usa `APPLE_SIGNING_REQUESTED`, não `SIGNED` nem publicação.
Seu `certificateSha256` registral continua nulo; o certificado Ed25519 de release
Aurora não é substituído por um certificado Apple. A central nativa não atesta sua
própria publicação. O certificado Apple fica no recibo externo com campo próprio.

Não sobrescrever archive/export já existente. Conservar artefatos anteriores e usar
outro checkout limpo do mesmo SHA ao repetir um build. Em falha, preservar evidência
sanitizada e não instalar nada. Reversão deste patch é revert do PR; não altera apps,
servidor, ponteiro de release nem dados. Um build já enviado à Apple não deve ter seu
número reutilizado; correção/reenvio exige número válido e nova validação.

## CI e liberação

`ios.yml` continua **sem segredos**, com build/testes sintéticos de simulador e todos
os testes Python `test_*.py`. Ele não publica IPA nem executa `distribution.py --archive`.
Testes que simulam respostas de `codesign` verificam contratos e recusas, não execução
real das ferramentas Apple. Archive/export assinado ainda exige validação no Mac.

Não foi criado environment de assinatura. Uma futura automação de assinatura/upload
exige desenho e revisão próprios: ambiente protegido, refs autorizadas, SHA exato,
revisão independente quando aplicável, menor privilégio, keychain temporário e limpeza
obrigatória de perfil/P12/P8 mesmo em falha. Não usar `pull_request_target` ou secrets
em código de PR; não contornar proteções existentes para obter uma IPA.

## TestFlight e App Store: marcos separados

Após uma IPA real validada, o operador autorizado envia o archive pelo Xcode Organizer
ou a IPA pelo Transporter para o **registro Apple confirmado**. Registrar o recibo
Apple, bundle, versão/build e SHA‑256 do arquivo. Upload aceito não é processamento
concluído. Reconsultar o App Store Connect até o build aparecer processado, resolver
export compliance e configurar descrição beta, contato e grupo interno autorizado.
Não convidar testadores externos nem criar link público automaticamente.

Em dispositivo físico, validar login/MFA, revogação/expiração, retorno de segundo
plano, acessibilidade, layout iPhone/iPad e fluxos autorizados com dados sintéticos.
OAuth externo e downloads hoje bloqueados pelo cliente precisam de teste e solução
específica antes de serem anunciados; não desabilitar a allowlist para fazê-los passar.
Distribuição externa TestFlight pode exigir Beta App Review; App Review da loja é
outro processo. Publicação pública só fecha com estado Apple e página real verificados.

Não preencher `testFlightURL` com link da página inicial TestFlight. Não preencher
`appStoreURL` com portal/PWA, App Store Connect ou URL calculada de um ID não publicado.
A página pública do aplicativo só será registrada após existir e ser comprovada.

## Metadados da loja

`metadata.pt-BR.json` organiza textos em português, limites de campos, proposta de
categoria **Negócios**, instruções beta e lacunas. É rascunho, não conteúdo enviado.
Nome e subtítulo preservam a marca; não anunciam certificação, operação offline,
receita recuperada, decisão clínica ou recursos ainda não comprovados.

Antes da submissão, preencher vendedor legal/copyright, contato de revisão, e-mail de
feedback e páginas públicas reais de suporte/privacidade. A URL de suporte não é
presumida a partir do portal autenticado. Rever disponibilidade geográfica e modelo
de distribuição: loja pública, unlisted ou Custom App não são decisões equivalentes.
O titular solicitou loja pública; não substituí-la silenciosamente por canal privado.

App Privacy deve inventariar **app nativo + WebKit + portal + backend + terceiros**.
Não declarar ausência de coleta só porque o shell não exporta cookies. Revisar dados
vinculados à identidade, finalidades, terceiros, tracking, retenção e exclusão. Não
adicionar PrivacyInfo.xcprivacy vazio como falsa certificação: APIs de motivo obrigatório
e SDKs/manifestos devem corresponder à implementação completa. Preencher o questionário
etário atual, sem atribuir faixa presumida por tratar-se de software empresarial.

A revisão Apple recebe acesso de teste controlado a tenant sintético, com instruções
operáveis de login/MFA. Credenciais entram apenas nos campos seguros de App Review,
nunca neste JSON, PR, screenshots ou logs. Não desativar MFA global. Se criação de
conta estiver disponível no app, revisar exclusão de conta conforme a regra Apple.
Revisar também pagamentos/assinaturas e serviços B2B na implementação concreta.

O app usa WebKit e uma central nativa, mas isso não garante cumprimento da regra 4.2
(funcionalidade mínima). Demonstrar utilidade real, fluxos completos e estabilidade;
não aumentar alegações comerciais para compensar limitação funcional.

## Recursos visuais — inventário de entrega

| Recurso | Especificação / conteúdo | Estado desta preparação |
|---|---|---|
| Ícone | Original aprovado, PNG RGB 1024 × 1024 sem alfa, SHA‑256 revisado; catálogo gerado dos mesmos bytes. | Entrada indispensável pendente; não redesenhado. |
| iPhone | Capturas reais de Dynamic Island/tela média: 1206 × 2622 ou 1179 × 2556 em retrato. | Captura pendente após build utilizável. |
| iPad | Como o target suporta iPad: capturas de 13 polegadas, 2064 × 2752 ou 2048 × 2732 em retrato. | Captura pendente; suporte iPad preservado. |
| Sequência editorial | Portal autorizado, visão operacional permitida, central de versão/integração e fluxo efetivamente homologado. Usar 3–5 capturas úteis por família como proposta, sem telas fictícias. | Roteiro organizado; nenhuma imagem fabricada. |
| App preview | Opcional; apenas gravação real da mesma versão, sem dados de clientes. | Não necessário para a primeira submissão; não produzido. |

Apple exige de 1 a 10 screenshots por tamanho; formatos JPEG/PNG sem transparência.
As dimensões acima seguem a referência consultada em 15/10/2026 e devem ser conferidas
novamente antes do envio. Capturas de dados institucionais reais, prontuários, CPF,
identificadores financeiros, cookies ou MFA não entram no material. Simulador pode
produzir capturas da interface real; teste de dispositivo e aceite são provas distintas.

## Fontes oficiais

- [Requisitos de SDK e sistema](https://developer.apple.com/news/upcoming-requirements/)
- [Renovação de membership](https://developer.apple.com/help/account/membership/renewal/)
- [Inscrição e titularidade](https://developer.apple.com/help/account/membership/program-enrollment/)
- [Perfil App Store Connect](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/)
- [Upload de builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
- [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
- [App Privacy, inclusive Web views](https://developer.apple.com/app-store/app-privacy-details/)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Screenshots](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [Apple security verify-cert policies](https://github.com/apple-oss-distributions/SecurityTool/blob/main/security.c)
