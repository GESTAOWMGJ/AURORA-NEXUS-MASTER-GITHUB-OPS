# AURORA NEXUS — clientes instaláveis e downloads privados

Incremento de 28/09/2026 no PR #38. Componente desktop: `0.1.0-hml.20260928`.

## O que está implementado

- Mac: pacote ZIP com `Aurora Nexus HML.app`, instalador `.command`, manifesto SHA-256 e módulo POSIX/macOS de onboarding anterior, preservado e não ativado.
- Windows x64: instalador `.exe` com confirmação nativa, instalação por usuário em LocalAppData, sem sobrescrever versões anteriores e atalho de Internet no menu Iniciar.
- Os clientes abrem o mesmo portal no navegador padrão. Não são uma cópia offline do sistema, não armazenam senhas e não contêm outro backend.
- Destino fixado: `https://wmgj-hml-jfn-20260927.web.app/`. O projeto vigente `wmgj-ops` não é alterado. A URL configurada não é prova de disponibilidade do serviço.
- Atualizações do web app são recebidas ao abrir novamente o portal. Não há autoexecução de atualizações binárias do cliente.

## Integração ao portal existente

A rota `/downloads` é atendida pela função já existente `auroraNexusAuthGate`. Não foi adicionada outra função de produção nem alterado o inventário esperado pelo smoke test.

O menu privado recebe `Instaladores Mac e Windows` para os papéis `platform_admin`, `org_admin`, `director` ou permissão explícita `downloads.hml.read`. A mesma alçada é repetida no servidor. Cada solicitação de download exige sessão e membership atuais. Links binários anônimos retornam 401; listagem anônima redireciona ao login; arquivos ausentes ou alterados não são anunciados nem servidos.

Os binários são gerados em `firebase-migration/functions/private-downloads`, nunca na pasta pública do Hosting. O preparo `functions.predeploy` valida o projeto HML exato, executa o builder e compila TypeScript. Não substitui os requisitos de billing, WIF, secrets, memberships, MFA, proteção/backup, ambiente protegido e testes pós-deploy existentes.

## Construção e testes

Builder validado neste incremento em Linux, com Python 3.13 e Go 1.23.2 local; Windows x64 é compilação cruzada. O workflow `Validate Aurora Installers` faz validação isolada em Ubuntu usando o Go estável resolvido pelo runner; o log do workflow identifica a ferramenta efetivamente usada. Nenhum binário é publicado como GitHub Release por esse workflow.

```sh
python3 desktop/build_installers.py --output /tmp/aurora-hml-installers
node --experimental-strip-types --test firebase-migration/functions/test/aurora-downloads.test.ts
```

Validação local realizada: 5 testes do instalador Windows, 15 testes de autorização/integridade dos downloads, compilação TypeScript do módulo de downloads, ZIP/Info.plist/permissões do bundle Mac, sintaxe e verificação SHA-256 do instalador Mac. Esses testes não demonstram instalação ou execução nativa nos computadores dos clientes.

## Limites de liberação

Os pacotes atuais são de homologação e NÃO têm assinatura de editor/Authenticode ou notarização Apple. Não desativar Gatekeeper, SmartScreen, antivírus, quarentena ou política institucional. A liberação comercial depende de certificados, assinatura, testes nativos e aceite de homologação. Um hash de arquivo não substitui a assinatura de editor.

A descoberta local existente é POSIX/macOS e exige Python 3.10+, configuração de raízes explícitas, autorização documentada e expiração. Não é ativada pelo cliente desktop. Não está portado para Windows. Nenhum documento é lido, transmitido, movido ou excluído pela instalação dos clientes.

## Estado da execução desta entrega

- Pacotes gerados em ambiente de construção, não instalados no Mac do titular.
- Desktop Commander retornou lista vazia de dispositivos na verificação desta sessão.
- Não houve deploy Firebase, migração, troca de domínio/DNS/SSL ou alteração de credenciais nesta entrega.
- A área `/downloads` está incorporada ao código; não foi validada como publicada em um servidor nesta sessão.
- A configuração atual do projeto remoto não foi revalidada por um canal Firebase/Google Cloud autenticado. Não inferir ausência de recursos a partir de checkboxes antigos ou falha de acesso.

Para liberar: reconectar o ambiente autorizado, revalidar os requisitos existentes, concluir a revisão do PR, publicar pelo workflow de homologação protegido e executar testes anônimos/autenticados, inclusive listagem, downloads, hashes e logout. Só então registrar URL e release efetivamente disponíveis. Produção continua separada da homologação.
