# Notion e Slack desde o primeiro login — M01/M08/M09/M10

Baseline: main `cbeeb11df5ff0301a1276f5fc72e94199732f8e1`. Capacidade implementada na mesma aplicação e no agente existente 1.0.5; não cria banco, scheduler, workspace, token ou executor paralelo.

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
