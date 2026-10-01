# Arquitetura futura do aplicativo WMGJ

## Visão geral

A aplicação WMGJ deve separar claramente:

1. Núcleo operacional: Apps Script e pipeline atual.
2. Camada de contrato: JSON estável para estado e ações.
3. Interface humana: dashboard clicável.
4. Camada de segurança: credenciais, permissões e auditoria.

## Camadas

### 1. Motor operacional

Responsável por:

- ler arquivos de entrada;
- enfileirar documentos;
- processar fila;
- validar JSON;
- registrar memória-base;
- registrar status;
- registrar logs;
- instalar e validar gatilhos.

Tecnologia atual: Google Apps Script.

### 2. Contrato operacional

Responsável por transformar abas e logs em JSON previsível para o app.

- v1: `contracts/operational-status.schema.json`, preservado para compatibilidade;
- v2: `contracts/operational-status.v2.schema.json`, com `schemaVersion: 2`;
- manifesto orgânico server-side: `firebase-migration/schemas/organic-patcher.schema.json`.

Mudanças incompatíveis não reutilizam silenciosamente o mesmo contrato. O app não deve depender diretamente da estrutura bruta da planilha.

### 3. API de integração

Fase inicial:

- Apps Script Web App retornando JSON operacional.

Fase posterior:

- API Node/TypeScript intermediária;
- autenticação própria;
- controle granular de permissões;
- cache e histórico.

### 4. Interface

React + TypeScript.

Componentes mínimos:

- cards de status;
- gráfico de fila;
- tabela de documentos;
- painel de auditoria;
- painel de logs;
- botões de ação controlada.

### 5. Empacotamento

Desktop:

- Tauri para Windows/macOS.

Mobile:

- PWA ou app nativo futuro reaproveitando componentes React.

## Ações humanas permitidas

Toda ação humana deve gerar log.

Ações iniciais:

- diagnosticar automação;
- processar fila;
- reprocessar erros;
- auditar código;
- validar status;
- abrir item para revisão;
- marcar item como revisado.

## Restrições

- Nenhum botão deve executar ação destrutiva sem confirmação.
- Nenhuma credencial deve ficar embutida no app.
- Nenhum ID sensível deve ser duplicado em múltiplas fontes.
- Nenhuma função global duplicada deve ser aceita no Apps Script.
- Nenhuma pasta legada deve ser publicada no deploy.

## Primeira entrega recomendada

Consumidores legados podem continuar lendo `contracts/operational-status.schema.json`. Novas superfícies AURORA NEXUS devem negociar/validar explicitamente `schemaVersion: 2` contra `contracts/operational-status.v2.schema.json`.

Depois, substituir o mock por endpoint controlado sem remover o suporte ao v1 antes de migração explícita dos consumidores.
