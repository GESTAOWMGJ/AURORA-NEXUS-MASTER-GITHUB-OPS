# AURORA NEXUS — beta de acesso multiplataforma

Cliente Windows 0.3.0-beta.20261004.1 do produto 1.0.0-rc.1.
O cliente abre o portal HML existente em janela de aplicativo do Edge.
Não é um binário nativo, nem prova de instalação PWA pelo navegador, nem ERP offline.
O login, dados e decisões continuam no aplicativo oficial e no Firestore do tenant.
Nenhuma senha, token, documento ou dado clínico está neste pacote.

## Windows
Instalar pelo PowerShell normal: `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\Install.ps1 -RegisterTrigger`.
Os scripts devem estar extraídos juntos. Respeitar bloqueios de assinatura/SmartScreen/GPO.
O instalador não exige administrador, não muda política permanente e não desativa proteções.
Cria atalhos e dois comandos TRIGGERcmd fixos. Preserva versões e comandos existentes.
Abrir: `Aurora Nexus - BETA HML`. A autenticação deve ser feita na janela do próprio app.
`Client.ps1 -Action Status` testa somente rotas públicas sem autenticação e grava evidência sanitizada.
Um status 401 com AUTH_REQUIRED confirma a barreira de login, não acesso aos dados.

## macOS, iOS e web
O mesmo backend é utilizado por todos os clientes. Não há base financeira independente por plataforma.
macOS: preservar AURORA NEXUS 1.6.0 já instalado. Reconciliar bundle ID, destino e assinatura antes de atualizar.
Não substituir por um aplicativo HML de mesmo nome nem remover a quarentena/Gatekeeper.
iOS: acesso web autenticado e Adicionar à Tela de Início no Safari. Não é uma distribuição IPA/TestFlight.
Web: mesmo portal autenticado. Esta versão não publica alterações no backend.

## Sincronização e base mestre
A leitura autenticada do app deve refletir o snapshot canônico do Firestore.
O SQLite de infraestrutura do gateway não é uma réplica da base mestre.
Migração/sincronização física exige adaptador autenticado, escopo autorizado, checkpoint, auditoria e teste de recuperação.
Este instalador não altera flags de ingestão, não reenvia amostras e não promove produção.

## Reversão
Fechar a janela de acesso. Remover apenas os atalhos desta versão e seus dois comandos novos após conferir seus nomes.
A pasta de versão pode ser preservada para auditoria. Não apagar o banco gateway ou backups.
SHA-256 detecta alterações; não representa assinatura Authenticode de editor.
