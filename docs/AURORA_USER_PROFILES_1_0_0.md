# AURORA-USER-PROFILES-001 — perfis de futuros clientes

Versão do incremento: 1.0.0, módulos M09/M10. Baseline: `c7c71a10f796e26f72ac2f1003e1d59bf5476cf2` (main, PR #154), preservando o incremento de domínio/instaladores do PR #153. Produto, dados e projetos existentes são mantidos.

## Problema e comportamento

O primeiro acesso dependia de provisionamento manual de identidade e membership e de lista global de e-mails. O administrador de cada organização poderá criar e revogar perfis no próprio portal, com sessão MFA, sem editar a lista global para cada futuro usuário. A identidade recebe um seletor de organização assinado pelo Firebase; a autorização continua na membership atual do servidor. O caminho `/{empresa}` seleciona a entrada, nunca concede acesso.

Papéis emitidos: consulta, operação, auditoria, financeiro, direção e administração da empresa. Não há emissão de `platform_admin`, permissões livres, escolha de UID ou alteração de outra organização. Unidades restritas devem existir e estar ativas. Empresa ativa, administrador ativo com escopo global e segundo fator são revalidados em cada transação.

A implantação não habilita cadastros automaticamente: `organizations/{orgId}.userProfilesEnabled=true` é o opt-in necessário. A organização e seu primeiro administrador continuam sujeitos ao bootstrap governado já existente; este incremento não cria empresas nem concede acesso inicial a si próprio. Suspender novos cadastros não impede a revogação de perfis existentes.

## Criação retomável e revogação

`POST /api/user-profiles` exige sessão, MIME JSON, origem e CSRF específico desta ação. Um requestId estável reserva operação em `apiIdempotency` da própria organização. Identidade determinística e lease impedem duplicação concorrente; mudanças de payload/autor conflitam. A identidade nasce desabilitada, sem senha, com e-mail não confirmado. Nunca se adota uma conta preexistente por e-mail nem se redefine sua senha.

A membership começa inativa/PENDING. Só passa a READY/ativa após confirmar a identidade e claims, revalidar administrador e unidades, e registrar atomicamente operação e auditoria. Mudança de escopo ou falha parcial mantém o acesso fechado. Repetir o mesmo pedido retoma; não reenviar com requestId novo para mascarar falha. Colisões exigem revisão administrativa.

Revogar fecha membership e operação antes de desabilitar a identidade e invalidar refresh tokens. Se o provedor falhar, o acesso Aurora continua fechado; repetir REVOKE conclui a operação. CREATE não reabre conta revogada nem reabilita identidade desabilitada externamente. Não há exclusão de identidade, histórico ou dados.

## Primeiro acesso e proteção direta do banco

O usuário abre `/{empresa}`, solicita a definição de senha, confirma o e-mail e cadastra seu aplicativo autenticador. O envio de mensagens depende de ação explícita do próprio usuário. Nenhuma senha, link de recuperação ou chave TOTP passa pela API da aplicação. A configuração usa SDK modular Firebase, memória temporária e login posterior com segundo fator; cadastro do autenticador não é confundido com sessão MFA válida.

Novos perfis exigem e-mail confirmado, segundo fator emitido pelo Firebase, marcador de operação correspondente, organização ativa e membership READY/ativa. As mesmas condições são aplicadas nas Security Rules para leituras diretas pelo SDK. Clientes não podem escrever memberships, operação de provisionamento ou auditoria. Contas legadas preservam a política existente; retirar um marcador de um perfil gerenciado não o transforma em conta legada.

## Validação e liberação

Testes sintéticos cobrem autorização/CSRF nos handlers reais, isolamento, colisão de identidade, idempotência, concorrência, lease expirado, revogação, falhas parciais e adulteração durante ativação. O JavaScript emitido é executado em simulação de DOM para primeiro acesso, desafio TOTP e limpeza do segredo. Testes com o emulador validam as regras diretas do banco. Isso não equivale a login ou instalação reais.

Pré-requisitos de homologação: Identity Platform/TOTP habilitado, template/domínio de ações de e-mail conferido, e-mail de teste controlado pelo titular, runtime com permissões estritamente necessárias de administração do Firebase Authentication e Firestore, CI do SHA exato e deploy protegido. Não criar credenciais de serviço em arquivos nem ampliar IAM automaticamente. Verificar o primeiro acesso completo, tentativa entre empresas, revogação e retry com identidade de teste antes de liberar opt-in para clientes.

Em 04/10/2026, a publicação de código anterior e a instalação da integração Windows estão comprovadas separadamente. Login real do titular ainda respondeu acesso não autorizado. O deploy HML permanece bloqueado por IAM; a validação de main com `VALIDATE_ONLY` não implantou este motor. O domínio produtivo segue no projeto original, sem troca de DNS. O Release Cockpit permanece `IMPLEMENTED_PENDING_LIVE_VALIDATION`, sem aumento de GA por inferência.

Rollback: suspender `userProfilesEnabled`, manter listagem/revogação, fechar perfis afetados e revogar sessões; preservar auditoria. Só reverter handlers/regras após verificar que não remove as proteções exigidas pelos perfis já emitidos. Não voltar às regras antigas deixando perfis gerenciados ativos.

## Atualização diária em todas as plataformas

Decisão do titular em 04/10/2026: manter cliente instalado, web e mobile atualizados diariamente com melhorias validadas de segurança e algoritmos; versões futuras estão previamente autorizadas. Não repetir aprovação para o mesmo escopo. Consentimento prévio não substitui resultado técnico de testes, revisão de código, CI, HML e rollback.

A rotina hospedada já existente `6ab950ae61788191a8022421e74ed30a` foi reativada e ampliada para manutenção diária, em America/Sao_Paulo. Ela implementa patches e conduz publicações que atendam aos gates; novos schedulers concorrentes não são criados. No registro nativo, `AURORA-DAILY-UPDATES-001` permanece LEGACY_MIRRORED porque a execução ainda é hospedada externamente.

O atualizador web/PWA agora verifica o service worker na abertura e a cada 24 horas de uso, além da retomada após suspensão/conexão. A verificação ignora cache HTTP; não recarrega formulários nem armazena dados privados. O backend publicado atende os algoritmos do portal; código de página é renovado na navegação seguinte. Navegadores móveis podem suspender tarefas em segundo plano, portanto não há promessa de atualização diária com o app fechado.

Clientes que abrem o portal recebem seu código web quando acessam o destino funcional. Atualização binária de Mac/Windows exige baseline inspecionada, pacote confiável, backup, troca no mesmo destino e teste nativo. O Mac original segue offline; não foi substituído. Não há evidência de aplicação nativa iOS/Android nem validação em dispositivo mobile: a cobertura implementada aqui é PWA e ainda exige teste real nas duas plataformas.

Fontes técnicas: https://firebase.google.com/docs/auth/web/totp-mfa e https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache. Dependências não são atualizadas cegamente; a rotina consulta avisos oficiais e valida compatibilidade antes da promoção.


### Revisão de cadência — 08/10/2026

A manutenção acima descrita historicamente como diária passou a horária na rotina hospedada existente. O ID `AURORA-DAILY-UPDATES-001` é preservado e segue `LEGACY_MIRRORED`. O `webUpdateClient` foi alinhado a uma hora, mantendo pausa, retomada, retry de 15 minutos e preservação do trabalho em andamento. A descrição anterior de 24 horas é histórica; política atual em AURORA-MO-001, seção 24. Isso não constitui instalação ou publicação já verificada por plataforma.
