# WMGJ — Índice Canônico Operacional

Última revisão: 2026-05-13

## Fonte canônica de código

- GitHub oficial: GESTAOWMGJ/automacao-gestao-wmgj
- Pasta de código Apps Script: apps-script/
- Webhook principal: apps-script/WebhookWMGJ.gs
- Configuração central: apps-script/00_Config.gs
- Deploy automático: .github/workflows/deploy-appscript.yml

## Fonte canônica de dados

- Planilha mestre: WMGJ_BASE_MESTRE_OPERACIONAL_FINANCEIRA
- Spreadsheet ID: 15LgI2U2dtM7vnrxFsiQMPTvBapBDg5ftgGttx7Pw0Cw

## Abas operacionais existentes na planilha mestre

- 00_INSTRUCOES
- 05_DASHBOARD
- 10_LOG_AUTOMACAO
- 01_EXTRATO_BRUTO
- 02_EXTRATO_CLASSIFICADO
- 06_REGRAS_CLASSIFICACAO
- 01_CADASTRO_ARQUIVOS
- 02_PRODUTIVIDADE_MENSAL
- 03_PRODUTIVIDADE_MEDICO
- 04_PACIENTES_FLUXO
- 05_FINANCEIRO_MENSAL
- 06_NFS_E
- 07_ESCALA
- 08_CONTRATOS_E_ATAS
- 09_INDICADORES_DASHBOARD
- 10_AUTOMACOES_REGRAS
- 11_PENDENCIAS_SANEAMENTO
- 12_RESULTADO_PDF_CONSOLIDADO

## Abas previstas por automação

Estas devem ser criadas pelo Apps Script, não manualmente:

- 08_PRODUCAO_MEDICA
- 09_NFS_REPASSES
- 10_CONCILIACAO_COMPLETA
- 11_PENDENCIAS_CONCILIACAO

## Regra de indexação

1. Código fica no GitHub.
2. Dados operacionais ficam na planilha mestre.
3. Documentos soltos do Drive são referência histórica, não fonte executável.
4. Arquivos com WGMJ no nome devem ser tratados como legado ou alias de WMGJ.
5. Relatórios com sufixo (1), (2) ou nomes genéricos devem ser considerados versões antigas, salvo indicação expressa.

## Nomes canônicos

- Projeto: WMGJ OPERAÇÃO
- Repositório: GESTAOWMGJ/automacao-gestao-wmgj
- Planilha mestre: WMGJ_BASE_MESTRE_OPERACIONAL_FINANCEIRA
- Apps Script: versão sincronizada pela pasta apps-script/

## Risco de duplicidade identificado

- QUICK_START_WMGJ_INDEXACAO possui mais de uma versão no Drive.
- WMGJ_Relatorio_Mensal_Automatico_Socios possui versões com sufixo numérico.
- proposta_credito_JFNeto.pdf possui múltiplas cópias.
- Existem documentos antigos de Apps Script no Drive que não devem substituir o GitHub.
