# Notion/Slack — retomada operacional verificada em 31/10/2026

## FATO COMPROVADO

- PR281 integrado em 20/10/2026, merge c1db7befa34c56467217590613a97b438933edb6. Não é necessário novo merge desse incremento.
- Main observada nesta retomada: eef855d8ffbfd5ca63d3410bfba1cefd4863a48f.
- Publicação HML existente 41196593478 em execução para esse SHA; o job Validate exact main candidate estava em Validate full Firebase and API contract suite. Nenhum segundo dispatch, aprovação protegida ou alteração cloud foi executado nesta retomada.
- Servidor Windows autorizado acessível pelo canal remoto. Diretórios operacionais incluem componentes de integração 1.0.8. Presença de arquivos não comprova versão carregada ou instalação aceita.
- Inspeção limitada das áreas de integração/cliente não localizou agent-config.json. O recibo integration-setup.json não contém configuração de providers; não é configuração do agente. Consultados somente nomes dos campos, sem exibir valores privados.
- As referências padrão AURORA_NOTION_TOKEN e AURORA_SLACK_TOKEN não estavam definidas nos ambientes Process/User/Machine do processo remoto. Nenhum valor de segredo foi lido ou copiado. Essa consulta não abrange armazenamento protegido, aliases alternativos, outros usuários ou outros destinos.
- O contrato atual continua exigindo página Notion explícita e workspace/canal Slack explícitos por organização. A inscrição/renovação OAuth desses provedores não está implementada no assistente atual; são necessários grants próprios previamente autorizados no armazenamento protegido.

## INFERÊNCIA

A evidência inspecionada é insuficiente para ativar ou declarar conexão real. Não prova inexistência de grants em outras contas ou destinos. Conectores disponíveis no chat não podem ser transferidos ao aplicativo.

## PENDÊNCIA MATERIAL E RETOMADA

1. Conferir resultado terminal do deploy41196593478, manifesto/certificado, smoke e readback exatos antes de declarar publicação. Reutilizar execução existente; não interromper trabalho concorrente.
2. Identificar tenant autenticado e fonte aprovada: UUID da página Notion e workspace/canal Slack, com finalidade e consentimento próprios. Provisionar grants oficiais somente leitura no armazenamento protegido existente, sem tokens no chat/repositório/browser.
3. Usar atualização/reconciliação governada do agente já existente. Conferir ping com orgId esperado, identidade/escopo de cada provedor, primeira exportação canônica autorizada, recibo persistido e replay idempotente. Narrativa/anexos/threads não extraídos permanecem pendentes.

Não foram criados coletor, scheduler, tenant, token ou infraestrutura paralelos. Não houve leitura de conteúdo real Notion/Slack, envio de mensagem ou ativação inferida. O aceite do titular permanece válido no escopo; a lacuna é configuração/prova técnica, não novo consentimento genérico.

## Atualização após autenticação e aceite do titular — 31/10/2026

Conexão interna Notion criada após confirmação explícita do aceite dos termos. Configuração verificada: somente Ler conteúdo habilitado; Atualizar conteúdo e Inserir conteúdo desabilitados; comentários e agentes não habilitados. Acesso a conteúdo permanece vazio. Nenhum token foi revelado, copiado ou instalado no servidor. A conta autenticada no navegador não possui acesso ao hub operacional previamente localizado pelo conector: a página apresenta Sem acesso e identifica outro workspace proprietário. Não foi solicitado acesso nem alterado compartilhamento por inferência.

No Slack, o painel passou a apresentar um aplicativo com o nome planejado, associado ao workspace Novo workspace e sem escopos OAuth. A criação desse aplicativo não foi executada pelas ações desta retomada. O workspace DR JOAO localizado pelo conector não está disponível na seleção do painel; não se presume equivalência entre workspaces. Nenhum escopo, instalação, token ou canal Slack foi concedido nesta passagem.

Próxima ação necessária: autenticar a conta proprietária do hub Notion e o workspace Slack correto, ou indicar explicitamente outra fonte empresarial. Manter conexão Notion sem páginas até vínculo exato; não copiar corpus, criar workspace duplicado, ampliar acesso ou enviar solicitações automáticas. A configuração protegida e a prova de ingestão real continuam pendentes.

## Atualização terminal — login Slack confirmado e instalação preparada — 31/10/2026

### FATO COMPROVADO

- O navegador agora acessa o workspace Slack correto, previamente identificado pelo conector. O canal público existente foi localizado pela interface e confirmado pelo conector. Não se presume que o canal contenha exportações canônicas WMGJ.
- O seletor do painel oficial de desenvolvimento agora inclui o workspace correto. Foi preparado, sem submissão final, o aplicativo AURORA NEXUS WMGJ Leitura nesse workspace, com apenas os bot scopes channels:read e channels:history, zero user scopes e zero eventos. O assistente está na revisão Create and Install. Não houve clique final, instalação, concessão de token ou inclusão do bot em canal nesta passagem.
- A identidade proprietária do hub Notion foi identificada pelo conector. O navegador ainda apresenta outra conta sem acesso. O fluxo normal de login da conta proprietária foi iniciado e o Notion informa envio do código; a conclusão está entregue ao titular na própria aba. Não houve leitura de caixa de entrada, código ou token.
- A execução HML 41196593478 terminou em failure. Validate exact main candidate passou; Deploy with protected environment falhou na etapa Verify public CREDMED form, static PDF/MP4 and anonymous management denial. Publish verified canonical active release foi skipped. Isso não comprova ausência de alterações anteriores no ambiente: o estado publicado exige readback próprio. Nenhum novo dispatch ou cancelamento foi feito por esta passagem.

### PENDÊNCIA

Concluir a autenticação Notion na conta proprietária; confirmar no momento do ato a criação/instalação Slack com os dois escopos explicitados; configurar credenciais oficiais pelo armazenamento protegido existente; conferir vínculo de tenant, fonte canônica, recibo e replay. A ingestão real permanece não validada. As observações anteriores deste documento são históricas; esta atualização substitui o status anterior de deploy em execução e de workspace Slack indisponível.

## Recuperação Slack/Mac executada — 31/10/2026

### FATO COMPROVADO

- O painel oficial passou a apresentar o aplicativo planejado no workspace correto, já instalado, com bot scopes channels:read e channels:history e sem user scopes. A criação/instalação foi observada após intervenção do titular, não atribuída a esta execução.
- Uma credencial de nível de aplicativo foi exposta pelo titular no relato de erro. Sua correspondência no painel oficial foi conferida sem reproduzir o valor. Essa credencial específica foi revogada e sua ausência na lista foi verificada; nenhuma credencial substituta foi criada. A credencial OAuth do bot não foi copiada nem alterada.
- O aplicativo existente foi adicionado ao único canal de teste explicitado ao titular. O painel mostrou o vínculo e a listagem de membros do conector confirmou a presença do bot. Não houve publicação de mensagens de teste, leitura de documentos empresariais pelo novo bot ou concessão de escopos adicionais.
- No Mac autorizado: Slack CLI 4.12.0 confirmado. O ambiente criado pelo template usava Python 3.9.6/pip 21.2.4, enquanto seu pyproject.toml exige Python >=3.10. A origem do template foi conferida no repositório oficial slack-samples/bolt-python-starter-agent, subdiretório openai-agents-sdk.
- O ambiente anterior foi preservado por renomeação para backup com timestamp. Foi criado no mesmo projeto um ambiente Python 3.12.16/pip 26.2.2. As dependências declaradas, o extra de testes e ruff 0.17.2 foram instalados. Foi exigido pacote binário para dependências, evitando compilação nativa pesada no Mac.
- A instalação editável concluiu com exit 0. Validação: pip check sem inconsistências; ruff check aprovado; ruff format --check com 25 arquivos já formatados; pytest com 7 aprovados em 39,29 s. O backup do ambiente foi excluído da varredura de lint/formatação.
- slack doctor, executado com o ambiente ativado, confirmou runtime Python 3.12.16 e os SDKs. A única falha indicada foi Credentials/not_authed. O exit 0 desse comando não foi interpretado como autenticação concluída.
- Nenhum serviço do template, agente externo, socket ou scheduler foi iniciado. O template de desenvolvimento não foi promovido a componente canônico do AURORA, nem foi criada chave de IA externa.
- Uma inspeção limitada das áreas components/state/onboarding/operations do aplicativo no Mac não localizou agent-config.json, installation.json ou integration-setup.json até a profundidade consultada. Não foi realizada busca geral no disco ou no chaveiro.
- O navegador Notion permaneceu na conta sem acesso ao hub. Um novo fluxo oficial de login da conta proprietária foi preparado, com código enviado pelo Notion e conclusão reservada ao titular na aba. Nenhum código foi consultado em e-mail ou copiado para esta evidência.

### PENDÊNCIA MATERIAL

1. CLI: concluir o desafio oficial de slack login caso a ferramenta de desenvolvimento seja necessária. Token app-level não substitui esse fluxo. O conector canônico de leitura não depende da criação de outro agente/template.
2. Notion: concluir a autenticação da conta proprietária e o vínculo da página autorizada.
3. Aurora: confirmar a configuração efetiva do agente/tenant, cadastrar a credencial OAuth do bot no armazenamento protegido existente e validar aquisição canônica, processamento e replay por recibo. Vínculo Slack e testes do template não comprovam essa operação.
4. Publicação HML: permanece aplicável o resultado terminal do deploy registrado acima; nenhuma publicação ou nova execução cloud ocorreu nesta recuperação.

### Aprendizado verificável para retomada

Separar quatro estados: ferramenta instalada, sessão CLI autorizada, aplicativo instalado no workspace e ingestão canônica comprovada. Conferir a versão mínima de Python antes do hook de instalação editável. Preservar rollback local e exigir wheels quando o Mac funciona apenas como estação leve. As verificações desta passagem não substituem o aceite de runtime/publicação canônicos.
