# Cliente nativo iOS — candidata

O titular solicitou iOS nativo por TestFlight/App Store e informou que não existe
app na App Store. Este diretório prepara uma aplicação SwiftUI/WebKit própria;
o fluxo padrão não registra identidade Apple, não assina nem publica uma IPA.
A preparação opt-in de distribuição está em [AppStore/README.md](AppStore/README.md),
com entradas revisadas, archive/export local e validação de recibos separados.
O app Mac escolhido e o ponteiro Q não são alterados.

O Portal mantém a interface canônica em https://auroranexus.com.br/portal.
Firebase Authentication, autorização organizacional e MFA continuam no contexto
WebKit do próprio portal: SDK em memória e sessão HTTP do servidor. O cliente não
lê/exporta cookies, senhas, tokens, Keychain, segredos TOTP nem sessões de outros
navegadores. Não existe ponte JavaScript nativa genérica, credential bridge,
autenticação paralela, handler de URL externa ou bypass de TLS.

A navegação principal é canônica. Somente o iframe exato de autenticação do
projeto HML existente é permitido como subframe de infraestrutura; ele nunca
vira entrada de usuário ou origem de arquivos. Popups, URL externa, mídia e
downloads binários não suportados são recusados. O seletor de arquivos normal
do WebKit exige ação do usuário na interface canônica e segue os gates existentes
do servidor; nenhum arquivo é varrido ou classificado como fato pelo app nativo.

A central nativa mostra proveniência fechada do build e pendências separadas
de Cloud/OAuth, API token, agente local e manual. O diagnóstico é uma consulta
anônima de cabeçalhos ao /portal fixo, com timeout, sem redirect, corpo privado,
cookies ou credenciais. HTTP 200 não atesta sessão/MFA, ingestão ou instalação.
OAuth externo de provedor e login/MFA precisam de homologação real no dispositivo;
nenhuma adaptação de callback/provedor ou exceção de navegação foi inventada.

A configuração deriva releaseId/versão/SHA da mesma fonte. A identidade local
de teste é explicitamente sintética e unsigned; uma bundle ID configurada ainda
não equivale a registro Apple. No fluxo unsigned, nenhum Team ID, provisioning profile, entitlement,
Apple login ou credencial de assinatura é criado/inspecionado. O fluxo de
distribuição lê somente a configuração pública revisada e o perfil explicitamente
fornecido; não descobre contas, não instala certificados e não concede capacidades.

Após commitar a fonte iOS e a versão canônica, execute
`python3 desktop/ios/configure.py --unsigned-test-identity` na raiz para gerar o
projeto local; ou use `--bundle-identifier` com a identidade configurada pelo
titular. Fontes iOS/versão modificadas ou não rastreadas bloqueiam a configuração.
`Generated/` é descartável e ignorado. O executável de Simulator permanece
unsigned, mesmo quando uma bundle ID foi informada.

## Verificação

Execute `swift run AuroraIOSChecks` neste diretório para verificações Foundation
sem app/UI/rede e sem dependência de XCTest. Execute `swift test` para a suíte
XCTest quando o toolchain incluir esse módulo.
O workflow ios.yml existente configura projeto/scheme explícitos, compila para
iOS Simulator sem codesign e executa UI sintética sem login/rede. O artefato
continua candidato unsigned de Simulator, não IPA de distribuição.
O ZIP interno preserva o bundle; o artefato retém seu SHA256 e a proveniência.

O Mac autorizado tem somente Command Line Tools/Swift, sem Xcode/SDK de iPhone
Simulator nem módulo XCTest observados. Testes Swift puros não validam SwiftUI/WebKit/iOS. Build
nativo e testes de Simulator requerem Xcode, no runner CI configurado.

TestFlight/App Store continuam pendentes de build exato, identidade Apple,
assinatura/provisionamento, ícone/metadata de loja, revisão Apple e aceite real.
A central nativa oferece funcionalidade adicional, mas não garante aprovação
pela regra 4.2 de funcionalidade mínima.

Fontes oficiais: [WKWebView](https://developer.apple.com/documentation/webkit/wkwebview),
[WKWebsiteDataStore](https://developer.apple.com/documentation/webkit/wkwebsitedatastore)
e [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

## Distribuição opt-in — candidata de 15/10/2026

`distribution.py` acrescenta uma etapa separada de preparo e, sob execução explícita
em Mac autorizado, archive/export manual. A configuração `AppStore/identity.json`
permanece sem identidade Apple comprovada e bloqueia a execução normal.
O caminho requer SHA revisado, fonte limpa, perfil App Store, certificado e ícone
aprovados por SHA-256 e decisão de export compliance. Não inclui upload automático.

O build de simulador continua unsigned e o workflow executa todos os testes Python.
A proveniência de distribuição é uma solicitação de assinatura, não um atestado
de assinatura/loja. O recibo do IPA assinado só é produzido após verificação real.
Metadados pt-BR, requisitos visuais, intervenção do Account Holder e sequência
TestFlight/App Review estão documentados no pacote AppStore. Não há link de app
publicado inventado nem substituição do iOS por PWA.
