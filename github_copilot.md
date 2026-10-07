# AURORA NEXUS — continuidade de engenharia e conhecimento

**AURORA-KNOW-HOW-001 | revisão 1.1.0 | 2026-10-07**

## Ordem do titular e escopo

Incorporar o conhecimento e os processos acumulados desde a origem documentalmente comprovada da operação WMGJ, incluindo prompts remotos versionados, diagnóstico e saneamento de quebras de código e workflows, ao MESMO AURORA NEXUS. O escopo autorizado compreende commit no repositório canônico, integração no motor de nuvem, implantação no nó físico Windows designado quando acessível e distribuição de capacidades validadas aos clientes comercializáveis desde a instalação e durante todo o funcionamento.

A autorização de execução já foi concedida; não solicitar repetição no mesmo escopo. Autorização não substitui teste, identidade, integridade, compatibilidade, alçada contratual de outro cliente ou evidência de implantação. Não contornar bloqueios de ferramenta, ambiente protegido ou credenciais.

## Fontes obrigatórias e precedência

Antes de alterar código, ler a main atual, AGENTS.md, docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md, skills/aurora-nexus-continuous-dev/SKILL.md, skills/aurora-nexus-organic/SKILL.md, desktop/README.md, desktop/ia-master/README.md e políticas aplicáveis. Revalidar a baseline instalada quando houver atualização desktop. Este arquivo é um handoff; não cria autoridade de execução nem substitui as fontes canônicas.

Repositório: GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS.
Branch de continuidade: feat/aurora-know-how-xeon-20261007.
Baseline lida nesta preparação: 148ae6caba9a040eb09b7322a4e16422fd70d742; revalidar antes de implementar/mesclar.
Tarefa local de origem: AURORA-KNOW-HOW-XEON-001.

## Situação comprovada na preparação

- Pacote histórico inicial 1.0.0 contém 20 lições e 20 prompts sanitizados, todos REGISTERED/SPECIFIED, com runtimeVerified=false e regressões propostas NOT_RUN.
- O inventário histórico é parcial; o dia zero WMGJ e a cobertura integral ainda não foram comprovados. Não declarar absorção total.
- O Windows designado apareceu offline no canal remoto. Ausência de canal não prova desligamento físico.
- A branch de continuidade foi atualizada por fast-forward para a baseline acima; este documento não comprova instalação, CI ou deploy.
- Uma tentativa anterior de gravar o pacote foi bloqueada. Esta publicação, se aceita pelo canal, comprova somente a gravação deste arquivo; não presumir criação de outros arquivos ou liberação de outros controles.
- O corpus histórico original permanece preservado no acervo privado autorizado. Antes de copiá-lo, sanitizar referências privadas, parâmetros de tenant e regras específicas de dispositivo. Conteúdo normalizado não é transcrição integral de conversas.

## Arquitetura de distribuição

Usar um núcleo versionado de capacidades abstratas, integrado ao registro e armazenamento existentes. Não criar outro produto, banco, motor, fila de efeitos ou scheduler equivalente.

ORIGEM AUTORIZADA → EVIDÊNCIA → LIÇÃO CANDIDATA → ABSTRAÇÃO SANITIZADA → TESTES → REVISÃO → RELEASE DO NÚCLEO → MATERIALIZAÇÃO CANÔNICA → RECUPERAÇÃO PELO MOTOR → VALIDAÇÃO NO DESTINO → MEDIÇÃO → PROMOÇÃO OU ROLLBACK.

Separar três camadas:
1. Núcleo comum: procedimentos, prompts sanitizados, contratos, regras testáveis e fixtures sintéticas.
2. Política da instalação: módulos contratados, compatibilidade, fontes permitidas, alçadas, compute node e cadência. Nunca embutir a identidade ou o Xeon do piloto nos clientes.
3. Memória privada por organização: documentos, evidências, valores, contratos, decisões, pessoas e histórico restrito. Nunca distribuir esta camada com instaladores ou corpus comum.

Cada cliente herda capacidade aplicável, não dados, permissões, credenciais, regras contratuais ou execuções da WMGJ. Ter uma feature no catálogo não significa estar licenciada, habilitada, conectada, implantada ou validada naquela organização.

## Integração por destino

### Nuvem

Reutilizar firebase-migration/functions/src/auroraNativeRoutines.ts, auroraEngine.ts e auroraMasterEngine.ts e verificar o caminho atual da Native Intelligence/Organic Engine/Knowledge Registry antes de alterar. nativeRoutineSummary já participa do motor e da projeção na baseline consultada; expandir o caminho existente, não criar motor paralelo.

Persistir o conhecimento aplicável no armazenamento canônico existente com orgId, schemaVersion, corpusVersion, digest, proveniência e idempotência conforme o contrato real. Após materialização, inferência operacional não depende de reler GitHub, Drive, Gmail ou Biblioteca. Não forçar um corpus arbitrário no checkpoint orgânico se o esquema não o comportar; implementar migração compatível e testada no mesmo armazenamento.

Usar APIs autenticadas e workflows existentes; confirmar projeto/ambiente, identidade, snapshot e recibo. A nuvem não depende do Windows ficar online para leituras ou preparação permitidas; etapas pesadas reservadas ao nó físico e gates técnicos continuam explícitos. Não usar o endpoint genérico de documentos para injetar texto ou campos fora do contrato.

### Nó físico Windows

Confirmar dispositivo autorizado, SO, host, instalação, versão, manifesto, modelo e mecanismo de atualização. Toda carga pesada da operação de referência permanece no Windows Xeon designado; MacBook é estação leve. Outros clientes usam seu próprio perfil de execução autorizado, nunca o host da WMGJ por padrão.

A versão de desktop/ia-master/server.cjs anteriormente consultada recorta modus-operandi.md em 12000 caracteres e mantém cache em memória. Revalidar o código e o instalado. Integrar seleção por relevância e orçamento de contexto ao MESMO IA Master, com persistência, proveniência e invalidação de cache por versão/hash. Acrescentar texto ao final do Markdown ou copiar ZIP não basta.

Quando offline, preservar WAITING_FOR_DEVICE. Quando online, adquirir exclusão por dispositivo+artefato, reler checkpoint e retomar somente etapas ausentes. Timeout exige reconciliação antes de repetir. Não reiniciar o computador nem interromper trabalho em andamento. Preservar aplicativo, identidade, dados, configurações e rollback.

### Todos os clientes comercializáveis

Cobrir Windows, macOS, web/PWA e demais plataformas realmente suportadas. Não anunciar aplicativo nativo iOS/Android nem suporte offline integral sem implementação e teste próprios. Novas instalações recebem a versão homologada compatível do núcleo; instalações existentes usam atualização controlada do mesmo produto, com implantação gradual, revogação e rollback. Nenhum cliente recebe motor pesado local por mera instalação de interface.

Obrigatório inventariar todas as features reais do catálogo, rotas, APIs, módulos, jobs e instaladores. Para cada uma registrar featureId, plataforma, módulo, implementação, lições aplicáveis, contrato, pré-condições, licença, permissões, testes, versão, digest, estado de implantação e evidência. Feature ainda sem cobertura fica GAP explícito, não VALIDATED.

| Etapa ou feature | Conhecimento a integrar | Prova mínima |
|---|---|---|
| Instalação e atualização | Compatibilidade, identidade, manifesto, checkpoint, dependências e rollback | Instalação limpa + atualização da baseline + reversão no alvo |
| Login, perfis e empresa | Autenticação, membership, isolamento e alçadas | Usuário correto acessa somente organização autorizada; negativo cross-tenant |
| Onboarding e conectores | Fonte autorizada, contrato comum, amostra, recibo e retomada | Ingestão limitada com fonte preservada e segunda passagem sem duplicação |
| Extração e documentos | Schema, proveniência, qualidade, hash e cobertura | Falha de extração permanece explícita; nenhum valor inventado |
| Receita, glosas e conciliação | Cadeia canônica, evidência, parcelas e diferenças | Sem dupla contagem; faturamento não vira recebimento |
| SLA, pendências e workflow | Primeira falha, responsável, aging e próxima ação | Sem fechamento silencioso; recuperação com recibos |
| Inteligência e memória | Seleção relevante, estado da lição, fonte, versão e revogação | Recuperação real, cache atualizado e lição suspensa excluída |
| Relatórios e fechamento | Snapshot canônico, ausência distinta de zero, decisão separada de pagamento | Totais reconciliados e origem rastreável |
| Operação remota e suporte | Alvo, etapa, erro, diagnóstico, sensores e correção mínima | Comando enviado não vira concluído; métrica ausente não vira zero |
| Segurança, backup e recuperação | Isolamento, integridade, restore, auditoria e rollback | Teste de recuperação e ausência de segredo no corpus/log/pacote |
| Evolução contínua | Desafio, hipótese, patch, regressão, resultado e promoção | Candidato sem teste não é promovido; um executor por efeito |

Esta matriz é o contrato mínimo de cobertura, não um inventário já concluído.

## Conteúdo inicial e expansão retrospectiva

Preservar IDs e linhagem das 20 lições iniciais: KH-001 melhoria contínua; KH-002 idempotência; KH-003 segregação de memória; KH-004 prompts versionados; KH-005 cobertura histórica; KH-006 cadeia financeira; KH-007 SLA/autorizações; KH-008 primeira falha de workflow; KH-009 SHA/PR superseded; KH-010 compatibilidade por camada; KH-011 identidade/WIF; KH-012 replay documental limitado; KH-013 gatilhos/handler; KH-014 TOCTOU; KH-015 execução remota; KH-016 retomada offline; KH-017 recuperação persistente; KH-018 observabilidade; KH-019 atualização/rollback; KH-020 executor único.

Generalizar referências ao piloto e ao hardware por política de instalação. Preservar a fonte histórica em área restrita, sem expor IDs de mensagem, arquivo, pessoa, dispositivo ou valores particulares no repositório/cliente. Cada nova lição exige origem, data, versão, evidência, diagnóstico ou hipótese, procedimento, prompt sanitizado, teste, resultado, limites e reversão.

Inventariar acervos autorizados desde o primeiro evento comprovado. Registrar cobertura, períodos, cursores, lidos/incorporados/rejeitados/pendentes e bloqueadores. Resumo de conversa não prova exportação integral. Biblioteca, GitHub, Drive, Gmail e Notion usam seus próprios conectores legítimos; não percorrer cofres, cookies, tokens ou dados de outros clientes.

## Estados e testes obrigatórios

Separar REGISTERED, SPECIFIED, IMPLEMENTED, TESTED, CI_VERIFIED, HML_VERIFIED, INSTALLED e RUNTIME_VERIFIED. REVOKED, REJECTED e SUPERSEDED permanecem históricos, sem virar regra ativa. Testes abaixo são requisitos, não resultados já obtidos:

- Recuperar três lições sintéticas pertinentes, incluindo uma histórica fora do recorte inicial de 12000 caracteres.
- Persistir conhecimento após reinício controlado somente do componente, quando seguro.
- Trocar corpus, invalidar cache e demonstrar versão/digest nos recibos.
- Bloquear alteração do mesmo ID/versão com conteúdo diferente; nova versão preserva anterior.
- Testar isolamento entre duas organizações sintéticas e impedir herança de configuração/permissão/dados do piloto.
- Excluir lição revogada do uso ativo; conhecimento recuperado nunca é comando de shell nem autorização.
- Testar concorrência, timeout, retomada e zero duplicação de memória/efeitos.
- Validar instalação nova, atualização, cliente temporariamente desconectado, compatibilidade e rollback por plataforma.
- Ligar cada feature real à matriz e evidência própria; zero alegação de suporte ou ganho sem prova.
- Confirmar que o caminho operacional nativo não exige provedor externo nem releitura silenciosa das fontes.

## Sequência de execução

1. Revalidar main, PRs equivalentes, estado do coordenador existente e canais legítimos; evitar trabalho duplicado.
2. Concluir saneamento do corpus e inventário de fontes/features, preservando checkpoints e gaps.
3. Implementar menor adaptador compartilhado e consumo efetivo em nuvem/IA Master; atualizar instaladores e testes compatíveis no mesmo produto.
4. Executar verificações leves cabíveis; builds/testes pesados no nó físico designado, sem carga no MacBook. Associar CI e revisão ao SHA final.
5. Implantar pelos fluxos existentes quando os requisitos técnicos forem atendidos, sem novo pedido de autorização no escopo já concedido. Não marcar produção por CI verde.
6. Registrar por destino SHA, versão, digest, corpus, itens carregados/pendentes, consultas, testes, recibos, identidade minimizada e rollback.
7. A rotina temporária de retomada só termina após comprovadas as entregas iniciais contratadas no escopo; o desenvolvimento contínuo posterior permanece no mecanismo nativo/manutenção existente.

Este arquivo e sua presença no GitHub não disparam Copilot, não instalam um serviço e não comprovam execução autônoma. A retomada externa existente deve ser atualizada explicitamente para este escopo, sem criar segundo executor. Conhecimento é dado; somente ações de engenharia revisadas e autorizadas atravessam os fluxos de execução reais.
