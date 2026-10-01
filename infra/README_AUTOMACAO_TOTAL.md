# WMGJ — Automação Total

## Arquitetura

ChatGPT -> Webhook Apps Script -> Google Sheets

## Componentes

- GitHub como source of truth
- CLASP para sincronização
- Apps Script Web App para execução
- Google Sheets como banco operacional

## Domínios e estado desejado

- `infra/domains/drjoaodefreitas.com.br/`: domínio institucional do consultório Dr. João de Freitas.
- `infra/domains/auroranexus.com.br/`: domínio canônico proposto para o produto Aurora Nexus, incluindo subdomínios `app`, `wmgj` e `api`, fallback Firebase atual e checklist de DNS/SSL.

Nenhum arquivo de domínio deve conter senha, token real de verificação, chave DKIM real, segredo de API ou dado sensível. Valores reais emitidos por provedores devem ser aplicados no console/DNS oficial e apenas o estado validado deve ser registrado no GitHub.

## Deploy

### Instalar CLASP

npm install -g @google/clasp

### Login

clasp login

### Clonar script

clasp clone SEU_SCRIPT_ID

### Push

clasp push

## Web App

Deploy:
- Executar como: você
- Acesso: qualquer pessoa com o link

## Endpoint

POST:

{
  "acao":"conciliar_financeiro",
  "competencia":"2026-05"
}

## Fluxos

- atualizar financeiro
- conciliar
- gerar dashboard
- validar NFS
- gerar pendências
