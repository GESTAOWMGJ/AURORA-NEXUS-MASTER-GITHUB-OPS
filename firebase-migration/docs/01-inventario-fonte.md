# Inventário da fonte WMGJ

## Sistemas-fonte confirmados

- Google Sheets: planilha `WMGJ_BASE_MESTRE_OPERACIONAL_FINANCEIRA`, com 55 abas.
- Google Drive: raiz WMGJ, automação completa, documentos de empresa, produção médica, relatórios, planilhas de controle, logs, código, configurações, processados e backup.
- Gmail: NFS-e PDF/XML, extratos PDF/XLS, produção, escala, contratos, documentos contábeis e pré-fechamentos.
- Apps Script: pipeline V3, extração/OCR, Gemini, parser bancário, parser fiscal, dashboard, relatórios, gatilhos, trava e watchdog.
- GitHub: repositório oficial com `src/`, documentação, testes e deploy CLASP.

## Domínios identificados na planilha

1. Cadastro/indexação documental.
2. Produtividade mensal e por médico.
3. Centro de custos e financeiro mensal.
4. NFS-e e cadeia de substituição.
5. Escala, impostos, extratos e contratos.
6. Conciliação, fechamento e relatórios.
7. Fila, memória-base, extrações e dados formatados.
8. Gmail fiscal/financeiro.
9. Runtime: ciclos, gatilhos, watchdog, logs e checkpoint.
10. Requisitos do aplicativo e roadmap.

## Problemas a sanear na migração

- Estados representados por múltiplas etiquetas Gmail simultâneas.
- Cabeçalhos duplicados e desalinhados na indexação Gmail.
- Mais de um esquema de log na mesma aba.
- JSON operacional armazenado dentro de células.
- Hash atual calculado principalmente por metadados do arquivo.
- Três árvores concorrentes de Apps Script no repositório (`src`, `apps-script`, `appsscript`).
- Deploy e execução operacional acoplados no mesmo workflow.
- Cadeia de NFS-e substituída precisa permanecer histórica e nunca ser sobrescrita.

## Regra de ingestão

Nenhuma linha é copiada cegamente. Cada domínio passa por normalização, chave natural, hash, status único, vínculo de evidência e validação de reconciliação.
