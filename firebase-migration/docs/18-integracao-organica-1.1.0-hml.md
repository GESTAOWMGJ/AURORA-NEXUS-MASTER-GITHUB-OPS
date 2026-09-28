# AURORA NEXUS — integração orgânica 1.1.0-HML

Data: 28/09/2026. Proposta de engenharia executada no mesmo PR #38, a partir do commit 819dad2fc43199838b83643225ff051a59fbb23d. Extensão AURORA-ORG-001 do sistema-mãe JFN-AUD-GOV-001. Não substitui a versão registral nem altera hashes históricos.

## Proposta e escopo executável

Unir a composição de propostas existente ao aplicativo Firebase já desenvolvido, sem novo banco: captura estruturada → evidência verificável → proposta determinística → revisão autenticada → piloto read-only → resultado observado → manutenção ou suspensão. Preservar M01–M10, M03.1/JFN-AUD-FAT-001 e WMGJ Operação.

Implementação: auroraOrganicCore.ts adapta o redutor Python, com paridade testada. auroraOrganicService.ts valida ações e evidências. auroraOrganicRuntime.ts fornece GET/POST /organic na aplicação existente. auroraOrganicView.ts implementa o painel privado com o modus operandi.

O executor deste incremento só conta sinais validados. As denominações checklist, registro de decisões, exceções e inventário são templates declarativos; não significam edição de contratos, cobrança, geração de programas ou execução irrestrita. Promoção para novas operações exige desenvolvimento, testes e governança adicionais. Não há treinamento de modelo nem aprendizagem estatística.

## Armazenamento e continuidade

Usar o banco já configurado em auroraDb. Estado no nó organic de organizations/{orgId}/runtimeCheckpoints/aurora-organic-v1, sem criação de coleção paralela. O checkpoint recebe versão, memória, provas opacas, aprovações e resultados. Escrita na mesma transação que apiIdempotency e auditEvents, ambas estruturas existentes. Checkpoint preexistente incompatível bloqueia, não é sobrescrito.

O catálogo local catalog.json continua derivado e não recebe memória oficial. Uma nova busca documental não apaga o checkpoint orgânico. Não há alteração no scanner, nas fontes nem no coletor instalado por este incremento. O cliente desktop continua sendo acesso ao portal; a atualização do runtime web não comprova atualização do binário.

Limites conservadores do primeiro piloto: 64 sinais, 64 execuções, 180 kB de estado, cinco evidências por ação e 16 setores autorizados. Ao atingir limites, bloquear para revisão; não excluir silenciosamente histórico nem criar armazenamento alternativo.

## Identidade, evidência e ciclo

1. Entrar com sessão Firebase válida, revogação verificada, allowlist, membership individual e escopo organizacional completo. O backend repete a verificação do membership dentro da transação.
2. Registrar REWORK, VALIDATED_DECISION, BILLING_EXCEPTION ou SECTOR_NEED vinculando uma actionItem existente e RESOLVED. O tipo/setor é uma classificação autenticada do usuário, não inferência automática a partir do documento.
3. Revalidar ação, target e sourceDocuments na mesma organização. O autor da resolução deve permanecer ativo/autorizado. As fontes devem ser APPROVED, VALIDATED/CLOSED, PUBLIC/INTERNAL, não revogadas, não excluídas e não expiradas quando houver prazo. Dados clínicos sensíveis não entram neste fluxo.
4. Vincular hashes ao snapshot efetivamente lido e ao evento. Repetição do mesmo caso ou fonte não produz evidência independente. Três casos e três referências geram proposta, não comprovação estatística de eficácia.
5. Aprovar a revisão vigente com usuário autorizado e MFA. A proposta não muda permissões nem inicia execução automaticamente.
6. Executar somente COUNT_VALIDATED_SIGNALS. Revalidar autor, setor, prova e fingerprint antes de cada execução. Persistir apenas resultado sanitizado e auditoria; fontes e finanças não são alteradas.
7. Informar BENEFIT, NO_BENEFIT ou ADVERSE somente para execução registrada. Repetições dos mesmos casos/fingerprint contam como uma observação de eficácia. Resultado adverso suspende o piloto limitado. Não confundir benefício informado com benefício causal ou receita recuperada.
8. Reverter o piloto sem apagar memória, fontes ou registros financeiros.

## API e interface

/organic exibe a página privada; /organic?format=json retorna projeção sanitizada, nunca as provas ou IDs brutos de fontes. POST aceita esquema fechado: OBSERVE, REVALIDATE, APPROVE_PILOT, EXECUTE, ROLLBACK e OUTCOME. Campos extras e comandos desconhecidos são recusados.

Cada mutação exige Content-Type JSON, limite de corpo, verificação de origem, CSRF vinculado à sessão/rota, chave de idempotência escopada por organização/usuário e expectedVersion. Revisão, execução e reversão exigem MFA. Todas as leituras de dependências precedem as escritas na transação. Uma falha de transporte não se converte em aprovação.

GET revalida a projeção sem escrever estado. POST persiste estado, auditoria e idempotência atomicamente. Repetição da mesma chave não duplica a operação; conteúdo diferente na mesma chave é conflito. Controles de concorrência precisam também de ensaio no emulador/ambiente antes do piloto real; testes de domínio não substituem esse ensaio.

## Configuração pendente de liberação real

Nenhuma opção é habilitada pela página nem pela instalação. O administrador deve validar no registro da organização existente: active=true, organicEnabled=true e organicSectors contendo somente setores autorizados; por exemplo AUDIT e FINANCE apenas quando aprovados. Não cadastrar a organização novamente nem provisionar banco para isso.

Antes de liberar: CI verde no SHA final; revisão de segurança; testes de sessão/CSRF/revogação/transação concorrente no emulador e HML; confirmação do projeto aprovado e seus gates; deploy rastreável; smoke anônimo, autenticado e com MFA; piloto sintético reconciliado; só então amostra operacional autorizada.

O plano não autoriza dispensar WIF, secrets, billing/orçamento, proteção de ambiente, backup/recuperação ou login. Resolver o conflito entre gates legados de restore em banco separado e a restrição atual de não criar banco ANTES do deploy, sem improvisar nova infraestrutura.

## Evidência desta fase e limitações

A suíte nova contém 28 cenários de domínio, paridade Python/TypeScript e verificação estática do transporte/UI. Fixtures, leitores e identidades de teste são sintéticos. Não são um teste de login real, Firestore em produção, concorrência real, instalação macOS/Windows ou faturamento da WMGJ.

O resultado do CI deve ser registrado no comentário de entrega com o SHA e os runs finais. Falha/cancelamento não é aprovação. A presença deste documento não comprova execução dos testes nem implantação.

Na rechecagem de acesso desta sessão, Desktop Commander retornou zero dispositivos; TRIGGERcmd aceitou AURORA NEXUS Status no MacBookPro Dr. Joao com Trigger sent, sem retorno de execução. Isso não comprova instalação ou sincronização. Nenhuma proteção do macOS/Windows deve ser desativada.

A versão só pode ser chamada de funcional na WMGJ implantada após retorno verificável do ambiente e dos testes autenticados. Até lá: integração de código para homologação, não produção concluída.
