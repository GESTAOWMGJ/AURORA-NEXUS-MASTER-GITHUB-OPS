# Primeiro cliente e ingestão nativa — 13/10/2026

A operação WMGJ é o piloto de referência. Cada cliente mantém organização, autorização, credenciais, pastas e recibos próprios. Reutiliza-se o procedimento validado; documentos e conhecimento privado não são copiados entre empresas.

## Comportamento implementado

No primeiro login, o portal consulta o bootstrap autenticado da organização. Quando há documento canônico recebido, prepara a projeção e conclui a instalação somente com recibo que corresponda à mesma versão, revisão e hash imutáveis. A página Integrações consulta credenciais, prontidão e comunicação relatada do agente. Comunicação não equivale a instalação física comprovada, nem a sincronização completa.

A importação estruturada usa a sessão existente, MFA, permissão administrativa global e CSRF específico. Não entrega chave de integração ao navegador. O transporte por chave permanece compatível; chave inválida não recorre à sessão. Retomada usa idempotência estável e isolamento por organização.

O pacote IA Master inclui o componente leve `AURORA_CLIENT_AGENT` 1.0.0 para PC/macOS, sem iniciar modelo pesado ou substituir a identidade do aplicativo existente. Instalação exige Python disponível, alvo identificado, fontes delimitadas e autorização vigente. Tokens ficam em DPAPI no Windows ou Keychain no macOS; não são colocados nos argumentos. O agente verifica a organização antes de ler fontes, mantém fila de hashes/recibos, rejeita links e varredura ampla, e pode ser desativado preservando credenciais e recibos.

Drive usa pasta explícita; Gmail usa label explícito; Microsoft Mail usa pasta explícita; IMAP usa pasta e OAuth2 em TLS com leitura sem alteração de flags. As exportações JSON seguem o contrato documental administrativo existente. Outros formatos ficam pendentes de extração. Paginação limitada é declarada, sem alegação de cobertura integral.

## Estados e limites da evidência

IMPLEMENTED: fluxo de primeiro login, importação por sessão, readback de Integrações, agente e adaptadores.

TESTED: testes sintéticos locais e compilação devem estar vinculados ao commit/CI deste PR. Não significam instalação em PC/Mac, consentimento OAuth real ou transmissão WMGJ efetiva.

PENDÊNCIA: consentimento e credenciais próprios de cada provedor, renovação OAuth automatizada, extração de formatos não estruturados, disponibilidade e inspeção do destino físico, transmissão real e recibo HML desta revisão. O componente não implementa execução arbitrária de comandos remotos. Cadastro ou instalação sem esses recibos permanece em estado pendente.

## Instalação e reversão do componente

A configuração privada usa `schemaVersion=aurora.client-agent.v1`, `org`, `origin=https://auroranexus.com.br`, `roots` e/ou `providers`, `tokenEnv` iniciado por `AURORA_`, e `authorization` com `approved`, `actorRef`, `documentRef` e `expiresAt`. O instalador gera `instanceId` e `stateDir` próprios.

Executar o script empacotado `install_client_agent.py --target <destino-validado> --config <configuração-privada> --configure-secrets --startup --start-now`. Esse comando deve ocorrer no destino, no contexto do usuário autorizado; não contém segredos. Um destino existente exige reconciliação, não sobrescrita. Reversão: `install_client_agent.py --target <mesmo-destino> --disable`. A saída comprova pedido de desativação; o encerramento do processo exige readback posterior.

## Aprendizado Motor

A rotina existente `AURORA-INSTALL-INTEGRATION-001` absorve o gatilho de login/instalação e o requisito de recibo. Não cria scheduler paralelo. O padrão reutilizável é autorização delimitada → isolamento → envio idempotente → versão processada → recibo. A adoção efetiva no motor local depende de execução e recibo próprios; documentação não é treinamento de pesos.
