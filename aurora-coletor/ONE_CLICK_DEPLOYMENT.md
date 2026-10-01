# Aurora Coletor — implantação com um clique

Este pacote consolida a rotina de implantação do Aurora Coletor em um fluxo guiado e seguro.

## Princípio

O processo deve ser simples para o gestor, mas não deve colocar segredos em repositório, linha de comando, prints, logs ou Notion.

## Fluxo embutido

1. Gerar credencial técnica local.
2. Calcular SHA-256 da credencial.
3. Gerar arquivo local de solicitação de cadastro da identidade técnica no servidor.
4. Preparar `collector-config.json` sem segredo.
5. Preparar arquivo de ambiente restrito com `AURORA_COLLECTOR_TOKEN`.
6. Gerar `run.sh` e `run.ps1`.
7. Gerar modelos de serviço do sistema operacional.
8. Gerar comandos TRIGGERcmd dedicados:
   - `AURORA COLETOR Implantar Um Clique`
   - `AURORA COLETOR Validar`
   - `AURORA COLETOR Smoke Test`
   - `AURORA COLETOR Watch`
9. Rodar validação sem transmissão.
10. Rodar `--once` somente quando a identidade estiver ativa no servidor.

## Comando previsto

```sh
python3 one_click_deploy.py --one-click --endpoint https://api.auroranexus.com.br/coletor --org wmgj --facility WMGJ
```

## Smoke test

```sh
/opt/aurora-coletor/run.sh --once
```

## Segurança

- Token nunca é versionado.
- Hash SHA-256 é usado para cadastro administrativo.
- Conta técnica envia lote, mas não revisa nem aprova.
- Usuário humano com MFA confirma o lote em `Aguardando conferência`.


## Conectores plug-and-play

O fluxo `one_click_deploy.py` agora executa o instalador real antes de gerar comandos de suporte. Por padrão, abre o assistente seguro de conectores; use `--without-connectors` somente para instalação deliberadamente sem integrações.

O assistente solicita interativamente, sem aceitar segredos em argv:

- pasta autorizada do Google Drive;
- endpoint de ingestão Firebase/Aurora;
- `keyId` e segredo HMAC do conector Drive → Firebase;
- opcionalmente nome/URL/chave do sistema externo que consumirá ou fornecerá dados;
- gera uma credencial Aurora específica para o sistema externo, com escopo e validade.

`connectors/connectors.json` não contém segredos. `connectors/secrets.env` é criado uma única vez com modo 0600. Para a chave Aurora gerada no instalador, o manifesto contém somente o hash SHA-256 e o payload `REGISTER_HASH`; o registro no servidor exige sessão administrativa, MFA e CSRF. O servidor nunca precisa receber a chave bruta.

No Apps Script, `auroraConfigurarConectoresPlugAndPlay` valida acesso à pasta, grava a configuração privada, liga o trigger consolidado de 15 minutos e torna o mirror Firebase obrigatório somente quando `activate=true`.

Quando o mirror é obrigatório, um documento não recebe fechamento `PROCESSADO` sem resposta `accepted` ou `duplicate` do Firebase. O ledger `17_FIRESTORE_MIRROR` permite backfill idempotente de documentos processados antes da ativação sem duplicar a memória local.

## Troca de chave com sistemas externos

O endpoint autenticado `/api/integration-keys` cria, registra por hash e revoga credenciais por conector. Emissão/registro/revogação exigem administrador da organização com MFA. `/api/integration/ping` permite ao sistema externo validar a chave Aurora usando `Authorization: Bearer <chave>`.

A chave do sistema externo permanece no armazenamento secreto da instalação e não deve ser copiada para manifesto, GitHub, log ou tela administrativa.
