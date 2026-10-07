# AURORA NEXUS — continuidade do aplicativo instalado

## Regra vigente: a versão funcional instalada é a base

Decisão do titular em 28/09/2026: utilizar o Nexus original já instalado e funcionando no Mac como base de todas as melhorias, atualizações e futuras instalações. Preservar seu nome, ícone, miniatura, padrão visual e funcionamento. Essa decisão prevalece sobre o plano anterior de entregar um cliente HML separado como alternativa de aplicativo.

O relato do titular estabelece a referência de produto. Não estabelece, sozinho, os metadados técnicos do bundle. Na checagem desta conversa, Desktop Commander não retornou dispositivo conectado; TRIGGERcmd retornou apenas Trigger sent. Nome exato do .app, caminho, versão, bundle identifier, arquivo de ícone, assinatura e backend do original permanecem NÃO INSPECIONADOS. Não substituir esses valores pelos do pacote HML nem pelos de uma versão registral.

### Identificar antes de alterar

Inspecionar apenas a aplicação e as configurações estritamente necessárias no escopo autorizado: localização efetiva do .app; CFBundleName/CFBundleDisplayName; CFBundleIdentifier; versões interna e pública; executável; arquitetura/macOS suportados; recursos de ícone efetivamente usados; mecanismo de abertura; origem do código/build; endereço/backend operacional e estado de assinatura. Registrar evidência de abertura e funcionamento, separadamente da mera presença do arquivo.

Preservar uma cópia verificável da aplicação funcional e das configurações necessárias ao rollback antes de substituição. Evidências locais, caminhos particulares, credenciais, tokens e dados de clientes não devem ser publicados no repositório. Não ler Keychain, sessões, pastas pessoais ou documentos institucionais para descobrir um ícone ou nome do app. Não solicitar acesso amplo ao disco para essa identificação.

### Atualização do mesmo aplicativo

- Derivar a candidata da baseline funcional identificada e de sua origem de código. Não usar o launcher HML como se fosse essa baseline.
- Manter o mesmo nome do .app, nome exibido, identidade de bundle, destino de instalação e ícone original. Preservar a experiência no Finder, Dock e janela, bem como configuração, dados, autenticação individual e padrão da interface. Não acrescentar HML, datas ou novos nomes ao aplicativo principal.
- Incrementar a versão técnica sem reiniciar a identidade do produto. Preservar o backend/endereço funcional; qualquer migração de destino exige validação específica e não pode redirecionar silenciosamente para ambiente indisponível.
- Preparar a candidata em staging privado e conferir integridade, confiança do editor, compatibilidade e regressões. Não alterar um bundle assinado em uso nem desativar Gatekeeper, quarentena ou outras proteções.
- Confirmar, antes da troca, que a instalação ainda corresponde à versão/fingerprint capturada. Mudança concorrente bloqueia a operação para reconciliação; nunca forçar sobrescrita.
- Substituir controladamente o bundle no MESMO destino, com backup e restauração viável. Preservar configurações e dados; não criar banco ou servidor paralelo. Não excluir apps alternativos ou fontes sem autorização específica.
- Testar nativamente abertura, ícone/miniatura, nome, interface, login, rotas e funções previamente operantes. Não basta o navegador abrir: Site Not Found, login quebrado ou perda de função são regressões. Em falha, restaurar a versão anterior sem descartar evidências ou dados.
- Somente após validação e aceite a candidata passa a ser a nova baseline funcional. A linhagem continua a partir do original; não reinstalar indefinidamente a primeira versão congelada nem regredir funcionalidades aprovadas.

Instalações futuras do produto devem usar a última descendente aprovada dessa baseline. Em Mac já existente, o resultado esperado é um único aplicativo principal atualizado, não outra cópia com identidade diferente. Em nova máquina, manter a identidade e o padrão do produto sem copiar credenciais ou dados de outro usuário/cliente. Windows deve preservar continuidade lógica do produto com empacotamento próprio, nunca executar o bundle Mac.

### Gate e estado desta mudança

Sem identificação técnica da baseline e validação nativa da candidata, NÃO publicar nem apresentar um pacote como atualização do Mac. O empacotador HML atual não implementa esse atualizador in-place. Estas instruções registram a regra de engenharia; não são prova de que um bloqueio executável, instalação, atualização automática ou rollback já foi implementado/executado.

Não houve substituição do aplicativo, remoção de pacotes, alteração de ícone/nome, mudança de URL, instalação de serviço ou deploy por esta atualização documental. O PR #38 continua sujeito à revisão e aos gates existentes.

## Registro histórico — clientes HML de 28/09/2026

Os itens seguintes descrevem o experimento `0.1.0-hml.20260928`, NÃO a aplicação original do Mac e NÃO sua atualização aprovada. Preservar esse histórico sem usá-lo para definir a identidade do produto. O pacote `AURORA-NEXUS-Mac-HML.zip` não deve ser recomendado como substituto da versão funcional.

### O que foi implementado no experimento

- Mac: pacote ZIP com `Aurora Nexus HML.app`, instalador `.command`, manifesto SHA-256 e módulo POSIX/macOS de onboarding anterior, preservado e não ativado.
- Windows x64: instalador `.exe` com confirmação nativa, instalação por usuário em LocalAppData, sem sobrescrever versões anteriores e atalho de Internet no menu Iniciar.
- Os clientes abrem o mesmo portal no navegador padrão. Não são uma cópia offline do sistema, não armazenam senhas e não contêm outro backend.
- Destino fixado do experimento: `https://wmgj-hml-jfn-20260927.web.app/`. O projeto vigente `wmgj-ops` não é alterado. A URL configurada não é prova de disponibilidade do serviço nem identifica o destino do aplicativo original.
- Atualizações do web app são recebidas ao abrir novamente o portal. Não há autoexecução de atualizações binárias do cliente.

### Integração HML ao portal

A rota `/downloads` é atendida pela função já existente `auroraNexusAuthGate`. Não foi adicionada outra função de produção nem alterado o inventário esperado pelo smoke test.

O menu privado recebe `Instaladores Mac e Windows` para os papéis `platform_admin`, `org_admin`, `director` ou permissão explícita `downloads.hml.read`. A mesma alçada é repetida no servidor. Cada solicitação de download exige sessão e membership atuais. Links binários anônimos retornam 401; listagem anônima redireciona ao login; arquivos ausentes ou alterados não são anunciados nem servidos.

Os binários são gerados em `firebase-migration/functions/private-downloads`, nunca na pasta pública do Hosting. O preparo `functions.predeploy` valida o projeto HML exato, executa o builder e compila TypeScript. Não substitui os requisitos de billing, WIF, secrets, memberships, MFA, proteção/backup, ambiente protegido e testes pós-deploy existentes. Esse caminho técnico não autoriza distribuir o HML como atualização do original.

### Construção e testes históricos

Builder validado nesse incremento em Linux, com Python 3.13 e Go 1.23.2 local; Windows x64 é compilação cruzada. O workflow `Validate Aurora Installers` faz validação isolada em Ubuntu usando o Go estável resolvido pelo runner; o log do workflow identifica a ferramenta efetivamente usada. Nenhum binário é publicado como GitHub Release por esse workflow.

```sh
python3 desktop/build_installers.py --output /tmp/aurora-hml-installers
node --experimental-strip-types --test firebase-migration/functions/test/aurora-downloads.test.ts
```

Validação local registrada naquele incremento: 5 testes do instalador Windows, 15 testes de autorização/integridade dos downloads, compilação TypeScript do módulo de downloads, ZIP/Info.plist/permissões do bundle Mac, sintaxe e verificação SHA-256 do instalador Mac. Esses testes não demonstram instalação ou execução nativa nos computadores dos clientes, nem compatibilidade com a baseline original.

### Limites históricos mantidos

Os pacotes HML NÃO têm assinatura de editor/Authenticode ou notarização Apple. Não desativar Gatekeeper, SmartScreen, antivírus, quarentena ou política institucional. Um hash de arquivo não substitui a assinatura de editor.

A descoberta local existente é POSIX/macOS e exige Python 3.10+, configuração de raízes explícitas, autorização documentada e expiração. Não é ativada pelo cliente desktop. Não está portada para Windows. Nenhum documento é lido, transmitido, movido ou excluído pela instalação dos clientes.

Na entrega HML anterior: pacotes gerados em ambiente de construção, não instalados no Mac do titular; Desktop Commander retornou lista vazia; não houve deploy Firebase, migração, troca de domínio/DNS/SSL ou alteração de credenciais. A área `/downloads` foi incorporada ao código, não validada como publicada naquela sessão. A configuração remota não foi revalidada por um canal Firebase/Google Cloud autenticado. Não inferir ausência de recursos a partir de checkboxes antigos ou falha de acesso.

Qualquer futura publicação continua exigindo revisão, ambiente autorizado e testes anônimos/autenticados. Para o aplicativo principal, a regra de baseline funcional e atualização do mesmo app, no início deste documento, é pré-requisito adicional e prevalece sobre o procedimento histórico de empacotamento HML.


### Windows beta 0.2.0-beta.3 — pacote completo

O build existente agora inclui `AURORA-NEXUS-Windows-Beta.zip`, com o instalador
por usuário, os dois módulos locais necessários e `INSTALAR-AURORA-NEXUS.cmd`.
Extraia todo o ZIP e execute esse arquivo no Windows com Edge e Python 3.10+.
O cliente conserva o portal HML e o atalho AURORA NEXUS. O Mac instalado não é
substituído pelo launcher HML experimental. iOS e web continuam usando o portal.

O ZIP é reproduzível para o mesmo SHA, possui manifesto com hashes de cada arquivo
e é distribuído na rota autenticada `/downloads`, com verificação de integridade.
Nenhuma credencial, banco, modelo ou serviço é empacotado. O teste de extração
executa o entrypoint de integração com dados sintéticos. CI aprovada comprova o
pacote; instalação e login em cada dispositivo exigem evidência de execução.

O frontend HML com a correção de retentativa de 15 minutos foi publicado no SHA
`354f611f642ce6b62c489d6b06f254587aaef84b` (run `37640768716`). O pacote mantém esse
backend e não declara produção liberada. Rollback: reinstalar o pacote anterior;
os diretórios de versões anteriores são preservados pelo instalador.
