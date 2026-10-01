# Auditoria de Indexação e Duplicidades — WMGJ

Data: 2026-05-13

## Objetivo

Garantir que Google Drive, Apps Script e GitHub estejam organizados para evitar erro de localização, duplicidade semântica e conflito de fonte durante a automação.

## Fonte oficial por camada

| Camada | Fonte canônica | Observação |
|---|---|---|
| Código | GitHub: GESTAOWMGJ/automacao-gestao-wmgj | Única fonte executável |
| Apps Script | apps-script/ no GitHub + deploy via CLASP | Não usar documentos do Drive como código ativo |
| Dados financeiros | WMGJ_BASE_MESTRE_OPERACIONAL_FINANCEIRA | Spreadsheet ID fixo |
| Documentação | Drive | Histórico e evidências |
| Relatórios | Última versão validada no Drive ou planilha mestre | Versões com sufixo são legado |

## Duplicidades confirmadas no Drive

### 1. Relatório mensal automático

Arquivos encontrados:

- WMGJ_Relatorio_Mensal_Automatico_Socios.pdf
- WMGJ_Relatorio_Mensal_Automatico_Socios-1.pdf
- WMGJ_Relatorio_Mensal_Automatico_Socios (1).pdf
- WMGJ_Relatorio_Mensal_Automatico_Socios (2).pdf

Regra de algoritmo:

- Priorizar o arquivo com data de atualização mais recente, salvo marcação manual de versão final.
- Tratar arquivos com sufixos (1), (2), -1 como versões intermediárias.

### 2. QUICK_START_WMGJ_INDEXACAO

Arquivos encontrados:

- QUICK_START_WMGJ_INDEXACAO — versão A
- QUICK_START_WMGJ_INDEXACAO — versão B

Regra de algoritmo:

- Priorizar o mais recente.
- Consolidar ambos em um único guia canônico no GitHub se houver divergência de conteúdo.

### 3. proposta_credito_JFNeto.pdf

Arquivos encontrados:

- proposta_credito_JFNeto.pdf — cópia 1
- proposta_credito_JFNeto.pdf — cópia 2
- proposta_credito_JFNeto.pdf — cópia 3

Regra de algoritmo:

- Considerar duplicidade forte por mesmo título e mesma data de atualização.
- Manter apenas uma referência canônica após validação documental.

### 4. Alias WGMJ

Arquivo identificado:

- planilha_operacional_WGMJ_dez_abr26

Regra de algoritmo:

- WGMJ deve ser tratado como alias legado de WMGJ.
- O padrão canônico é WMGJ.

## Regras permanentes de indexação

1. Sempre priorizar GitHub para código.
2. Sempre priorizar a planilha mestre para dados financeiros.
3. Sempre tratar Drive como histórico/documentação, salvo quando o arquivo estiver em pasta operacional designada.
4. Ignorar documentos antigos de Apps Script no Drive quando houver equivalente em apps-script/.
5. Normalizar WGMJ para WMGJ.
6. Penalizar nomes com sufixos automáticos: (1), (2), -1, copy, cópia.
7. Penalizar arquivos sem nome descritivo, como UUID.pdf.
8. Preferir arquivos com nome canônico e data mais recente.

## Pendências operacionais

- Não foi executada exclusão automática de arquivos, por segurança.
- Recomenda-se mover duplicados para pasta ARQUIVO_LEGADO_DUPLICADO antes de apagar.
- Recomenda-se criar coluna STATUS_CANONICO na memória/base documental.

## Status final

- GitHub: organizado como fonte canônica.
- Apps Script: fonte versionada em apps-script/.
- Sheets: base mestre identificada e validada.
- Drive: duplicidades mapeadas, mas não removidas.
