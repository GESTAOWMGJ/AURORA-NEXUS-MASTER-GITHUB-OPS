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
