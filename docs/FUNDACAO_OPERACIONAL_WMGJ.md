# Fundação Operacional WMGJ

## Status consolidado

Data-base: 2026-05-19

Status final declarado:

```text
OPERACIONAL SEM PENDÊNCIAS CRÍTICAS
```

## Estado validado

- GitHub Actions funcional.
- Deploy Apps Script funcional via `clasp push`.
- Auditoria estática de Apps Script ativa.
- API protegida por `WMGJ_API_TOKEN`.
- Comandos mutáveis bloqueados sem token.
- `15_STATUS_AUTOMACAO` corrigida com linha real de status.
- `10_LOG_AUTOMACAO` ativo como trilha de auditoria.
- Pipeline V3 mantido como núcleo estável.
- Gatilho operacional instalado a cada 15 minutos.
- Robô Gmail/Dashboard adicionado como camada operacional controlada.

## Núcleo operacional

Função principal acionada por gatilho:

```text
executarAutomacaoOperacionalWMGJ
```

Responsabilidades:

1. Preparar pipeline confiável V3.
2. Processar fila V3.
3. Acionar robô Gmail/Dashboard em modo controlado.
4. Registrar status em `15_STATUS_AUTOMACAO`.
5. Registrar log em `10_LOG_AUTOMACAO`.

## Robô Gmail/Dashboard

Função canônica:

```text
executarRoboGmailDashboardWMGJ
```

Função manual operacional:

```text
rodarRoboGmailDashboardWMGJ
```

Função de teste controlado:

```text
rodarRoboGmailDashboardWMGJ_Teste20
```

Conta operacional esperada:

```text
wmgjltda@gmail.com
```

Observação: o Apps Script só consegue ler o Gmail da conta que autorizou o projeto ou de conta com acesso legítimo configurado. O código não contorna permissões do Google.

## Fluxo esperado

```text
Gmail autorizado
→ busca de anexos financeiros/fiscais/operacionais
→ classificação heurística/Gemini quando configurado
→ cópia para pasta bruta a classificar
→ parser XML fiscal
→ pipeline documental/financeiro
→ relatório executivo
→ dashboard
→ log/status
```

## Abas principais

- `10_LOG_AUTOMACAO`
- `15_STATUS_AUTOMACAO`
- `15_FILA_PROCESSAMENTO`
- `14_MEMORIA_BASE_DOCUMENTOS`
- `16_EXTRACOES_DOCUMENTAIS`
- `17_EXTRACOES_FORMATADAS`
- `18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS`
- `19_RESUMO_FINANCEIRO_MENSAL`
- `20_RELATORIOS_EXECUTIVOS_GERADOS`
- `21_GMAIL_INDEXACAO_FATURAMENTO`
- `22_NOTAS_FISCAIS_EXTRAIDAS`
- `23_CONTROLE_CICLOS_AUTOMATICOS`
- `05_DASHBOARD`
- `09_INDICADORES_DASHBOARD`

## Segurança

Comandos mutáveis da API exigem token:

- `run`
- `runWMGJ`
- `operacao_total`
- `gmail`
- `gmail_bancario`
- `organizar`
- `dashboard`
- `conciliar`

Propriedade obrigatória no Apps Script:

```text
WMGJ_API_TOKEN
```

## Regra de preservação

A partir desta fundação, mudanças devem seguir estas regras:

1. Não duplicar funções globais Apps Script.
2. Não criar nova fonte de `SPREADSHEET_ID` fora de `getConfigWMGJ_()`.
3. Não expor comandos mutáveis sem token.
4. Não apagar abas operacionais sem registrar migração/quarentena.
5. Não substituir o pipeline V3 sem teste controlado.
6. Não processar Gmail sem limite de lote.
7. Não inserir segredos em código versionado.

## Próxima evolução

O projeto WMGJ Operação fica como laboratório operacional de ambulatório de cardiologia.

A evolução futura para auditoria hospitalar deve ser criada em projeto separado, com arquitetura própria para:

- auditoria médica;
- auditoria de contas médicas;
- faturamento hospitalar;
- glosas;
- trilha de auditoria por usuário;
- controle de versões;
- dashboard executivo;
- IA com validação humana.
