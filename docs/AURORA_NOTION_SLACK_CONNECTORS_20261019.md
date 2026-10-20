# Notion e Slack desde o primeiro login — M01/M08/M09/M10

Baseline reconciliada: main `0b6471b7fc83752fd29575342bcfd6b5091a251a`. Capacidade implementada na mesma aplicação e no agente existente 1.0.5; não cria banco, scheduler, workspace, token ou executor paralelo.

Reconciliação de 19/10/2026 após os PRs #290–#292: preservados a retomada de sessão após MFA, a autorização HML com seus limites e a revalidação canônica após rotação de credencial. O único conflito de rebase foi a expectativa de versões no teste de empacotamento: Windows Integration permanece 1.0.7 da main, enquanto o agente conserva 1.0.5 deste patch. As correções de pendências e recorrência foram reaplicadas sem alteração de comportamento. Os checks do candidato anterior `d9996f141f2912cf92fd84938e5adf229a07a505` são históricos; CI e revisão do novo SHA permanecem gates próprios. Nenhuma instalação, publicação ou fonte real é ativada por este rebase.

Validação local da reconciliação: 49 testes Python (14 workspace, 12 provedores e 23 agente/fechamento) e 22 TypeScript (5 workspace/primeiro login e 17 empacotamento) passaram; `git diff --check` sem erros. TypeScript foi executado com o carregador `tsx` e dependências disponíveis, após uma tentativa direta sem resolução de módulos não conseguir carregar a suíte. Testes sintéticos não comprovam publicação, conexão empresarial ou instalação física.

Revalidação de 19/10/2026: o run HML `39271319938` concluiu com sucesso a reconciliação, projeção nativa, teste da inteligência e verificação final do kill switch. Essa evidência pertence à recuperação existente, não comprova conexão Notion/Slack ou instalação física. O PR #281 foi reconciliado linearmente preservando as correções concorrentes da main. CI do candidato anterior não libera o novo SHA; publicação permanece condicionada aos checks exatos e aos gates canônicos.

## Contrato de operação

O assistente e a página Integrações mostram Notion/Slack desde o primeiro acesso. Administrador autorizado tem readback automático com isolamento pela organização da sessão; o portal reutiliza seu ciclo de consulta. Ausência de relato é NOT_REPORTED, sem inferir que não exista configuração no dispositivo; leitura relatada por agente recente é READ_REPORTED; comunicação antiga é STALE. Nenhum desses estados atesta instalação física ou sincronização integral. Logout e falha de reconfirmação retiram o status anterior.

Cada cliente precisa da credencial própria do aplicativo e de fonte explicitamente autorizada na configuração protegida do agente. Conector do ChatGPT não é inscrição OAuth, token ou autorização herdada pelo AURORA. Não inserir tokens em navegador, chat, repositório ou argumentos. O instalador já usa DPAPI/Keychain e faz conferência/repetição dos recibos; estas capacidades são reutilizadas.

- NOTION: configuração fechada `provider`, `tokenEnv`, `pageId`; UUID exato de uma página compartilhada com a conexão de leitura da empresa. Leitura direta, limitada e paginada de blocos de código JSON canônico, sem busca global, subpáginas ou URLs arbitrárias. Reconfere identidade e última edição da página antes/depois da aquisição. Narrativa e blocos não extraídos permanecem pendentes.
- SLACK: configuração fechada `provider`, `tokenEnv`, `workspaceId`, `channelId`; workspace T… e canal C…/G… explícitos. Confere identidade do workspace e participação do aplicativo antes de ler histórico, limitado a 15 mensagens por página. Exportações JSON canônicas, puras ou em bloco json/aurora-json. DMs, canais compartilhados externos e divergências são rejeitados. Anexos e respostas de threads não são buscados nem considerados adquiridos; ficam pendentes.

Referências de token têm formato `AURORA_…`; os valores pertencem ao armazenamento protegido já existente. Para instalação nova, incluir as fontes aprovadas em `providers` da configuração privada e usar o instalador existente com a autorização vigente, obtenção protegida dos tokens e verificação da integração. Configuração/credenciais são individuais por empresa. Em instalação existente, usar atualização/reconciliação governada; não editar o manifesto para contornar sua integridade.

O resultado segue a fila existente e só avança cursor após recibos processados. IDs/versões do exportador continuam sujeitos ao contrato canônico; não são inferidos de nomes ou mensagens. Não é extração genérica de texto nem leitura transacional de todo o workspace. Falha/revogação de uma fonte conserva pendência e recibos. A inteligência continua lendo Firebase, não os provedores.

## Aprendizado e Release Cockpit

`cloudIntakePolicy` 1.0.6 representa os dois adaptadores e os limites de leitura no registro nativo; IA Master conhece a capacidade. O Release Cockpit mantém IMPLEMENTED_PENDING_PROVIDER_CREDENTIALS_AND_RUNTIME_RECEIPTS. A regra reutilizável é fonte explícita → identidade conferida → aquisição limitada → exportação canônica → recibo → continuação idempotente. Dados privados não cruzam empresas. Não há alegação de treinamento de pesos ou adoção local comprovada.

## Evidência e pendências

Testes sintéticos cobrem páginas/canais divergentes, escopos inválidos, alteração durante leitura, credencial ausente, paginação, conteúdo não extraído, URLs de escrita rejeitadas, primeiro login, comunicação antiga e limpeza da sessão. CI, publicação e teste real têm recibos separados.

PENDÊNCIA: credenciais/consentimentos próprios e teste real por empresa. Os novos adaptadores usam tokens protegidos previamente autorizados; não implementam inscrição/renovação OAuth Notion/Slack, escrita nos provedores ou envio de alertas. Nenhum workspace real foi lido nesta alteração.

Rollback: reverter o patch pelo fluxo existente, preservando fila/configuração e fontes. Não executar componente antigo com configuração de provedor novo: retirar a fonte pelo procedimento governado ou manter o agente suspenso até reconciliar. Atualização web não prova atualização do agente instalado.

Fontes técnicas consultadas em 19/10/2026: https://developers.notion.com/reference/retrieve-a-page ; https://developers.notion.com/reference/get-block-children ; https://docs.slack.dev/reference/methods/auth.test/ ; https://docs.slack.dev/reference/methods/conversations.info/ ; https://docs.slack.dev/reference/methods/conversations.history/ .

## Correção de pendência por objeto — 19/10/2026

A revisão do candidato 2a349669 encontrou uma barreira permanente no fallback agregado. Os novos adaptadores passam a conservar hash do escopo/objeto e da representação observada no intake existente. Uma correção posterior do mesmo objeto pode substituir a versão pendente somente quando todos os registros canônicos associados possuem recibo de processamento verificado. A resolução conserva a versão anterior, a versão substituta e os recibos, sem apagar histórico. Essa vinculação local não é prova de aquisição cloud nem altera o contrato remoto. Desaparecimento, outro objeto, processamento pendente, anexos ou threads ainda não extraídos não encerram a pendência. Agregados legados não são apagados nem migrados por inferência.

Validação local da correção: 304 testes Python, um skip existente, incluindo ciclos reais do agente com provedores simulados Notion/Slack, persistência SQLite, bloqueio antes do recibo e avanço posterior da paginação. CI do novo SHA é exigida; os 15 checks do candidato anterior não liberam esta alteração. Nenhuma fonte real foi ativada.

## Validação adicional e recorrência de pendências — 19/10/2026

Baseline inspecionada: `45608dc274e42c269f63b5961439c0f328170ede`, main
`eaa9e20f537e1bd0ee9c9f9a6b79c35941853008`. Nove workflows concluídos com sucesso
na baseline. Reviews consultadas: comentários do bot e do proprietário, sem
aprovação humana independente. Esses resultados não liberam o patch posterior.

Falha reproduzida em ambos os adaptadores: narrativa pendente → exportação
canônica com recibo → reaparecimento da mesma representação não extraída. O
upsert substituía o recibo, mas conservava `EXTRACTION_RESOLVED`, omitindo a
pendência da contagem. Desaparecimento posterior podia remover a barreira ao
avanço. A correção reabre `PENDING_EXTRACTION` na mesma chave e conserva a
resolução comprovada anterior em `resolutionHistory`. Releituras não duplicam
a pendência nem o histórico; desaparecimento não fecha o item. Nova resolução
continua condicionada à representação completa e aos recibos canônicos.

Regressões executam o ciclo e SQLite reais com transportes sintéticos, para
Notion e Slack: recorrência, repetição, desaparecimento, nova resolução e
preservação do recibo anterior. Outro teste lê versões canônicas 1, 1, 2, 2 do
mesmo objeto e exige dois efeitos, dois recibos e um único documento lógico.
Não se trata de leitura de workspace real nem de prova de escrita em Firestore.

Execução de reserva autorizada no MacBook Pro, em worktree isolada do mesmo
repositório, prioridade reduzida e suites sequenciais. O checkout anterior,
suas alterações locais e a instalação operacional foram preservados. Python
3.9.6/macOS 26.7.1: 67 testes passaram (14 conectores workspace, 23 agente e
fechamento, 18 transporte/recibos, 12 provedores). O teste novo de recorrência
falhou nos dois provedores antes do patch e passou depois. Hashes e logs
permanecem na evidência privada do executor; não incluem credenciais.

Node 22.14.0: mais 32 testes passaram nas suites workspace, documento canônico,
primeira ingestão, prontidão e aceite de instalação; total focado de 99 testes.
Dependências existentes foram reutilizadas com lockfiles idênticos. A primeira
tentativa TypeScript falhou por resolução de módulos/diretório de fixtures;
executar no diretório Functions com a resolução correta concluiu as suites,
sem alterar o produto para compensar o ambiente de teste.

### Autorização e operação real: estado separado

O primeiro login apresenta opções e readback da organização autenticada; não
inscreve nem renova OAuth de Notion/Slack. O agente verifica o tenant no ping
autenticado antes da fonte; a configuração limita página/canal e exige a
autorização vigente. Esse contrato não comprova que um grant real foi emitido
com menor privilégio. Não há herança dos conectores do ChatGPT.

Para a validação real, conferir na conta própria da empresa: Notion com
capacidade `Read content` e compartilhamento somente da página aprovada;
Slack com `channels:read`/`channels:history` para o canal público aprovado,
ou `groups:read`/`groups:history` para o privado, e participação do aplicativo.
Não solicitar scopes de escrita, DMs ou arquivos para esta capacidade.
Referências oficiais de permissões: os endpoints Notion/Slack citados acima.

Não foi localizado `agent-config.json` na árvore de suporte operacional AURORA
inspecionada no Mac, excluídos os checkouts de reserva. Essa inspeção limitada
não comprova ausência em outros destinos. Nenhum segredo foi procurado no
Keychain nem copiado. Sem configuração empresarial autenticada e fonte
explicitamente vinculada, não houve leitura real dos provedores.

O Xeon estava offline no canal remoto; o gateway aceitou o disparo de status
sem recibo de execução. Não atribuir testes ou implantação ao Xeon. Instalação
do agente candidato, OAuth real, recibo canônico remoto, recuperação desse
recibo e adoção pelo Motor Mestre permanecem `PENDING`.

Aprendizado abstrato ligado à rotina existente AURORA-INSTALL-INTEGRATION-001:
reincidência reabre a mesma identidade e preserva a resolução anterior, em vez
de usar prova histórica como conclusão atual. Código/testes sustentam esse
desfecho; revisão humana, CI do candidato e adoção instalada têm gates próprios.
PR permanece draft nesta validação. Sem merge, deploy, publicação ou segundo
executor. Rollback do patch preserva configuração, filas e histórico; a reversão
restaura a limitação de recorrência aqui documentada e exige reconciliação.
