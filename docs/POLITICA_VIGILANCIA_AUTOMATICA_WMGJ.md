# Política de Vigilância Automática — WMGJ

## Objetivo

Garantir que qualquer nova alteração estrutural, documental, financeira ou de automação seja validada automaticamente para evitar:

- duplicidade documental;
- conflito semântico;
- leitura incorreta do robô;
- prompts ambíguos;
- múltiplas fontes canônicas;
- regressão operacional;
- colisão WMGJ/WGMJ;
- execução de código legado.

## Regras permanentes

### 1. Fonte oficial de código

Somente:

- GitHub oficial
- pasta apps-script/

podem ser considerados executáveis.

## 2. Fonte oficial de dados

Somente:

- WMGJ_BASE_MESTRE_OPERACIONAL_FINANCEIRA

pode ser utilizada como base financeira oficial.

## 3. Arquivos ignorados

Qualquer arquivo marcado como:

- IGNORAR
- LEGADO
- DUPLICADO
- INTERMEDIARIO

na planilha WMGJ_ARQUIVOS_LEGADOS_DUPLICADOS

deve ser excluído da indexação semântica.

## 4. Regras automáticas futuras

Toda nova implementação deve:

1. verificar nome semelhante;
2. verificar hash/tamanho quando possível;
3. verificar alias WMGJ/WGMJ;
4. verificar versões com (1), (2), -1;
5. impedir criação de múltiplos arquivos equivalentes;
6. impedir múltiplos prompts conflitantes;
7. bloquear uso de código fora do GitHub oficial;
8. registrar evento em log.

## 5. Política de prompts

Novos prompts devem:

- respeitar a arquitetura canônica;
- evitar recriar estruturas existentes;
- evitar gerar múltiplas versões concorrentes;
- validar nomes antes de salvar;
- consultar índice canônico antes de executar.

## 6. Política de quarentena

Arquivos suspeitos devem:

- ser movidos para quarentena;
- ser marcados como IGNORAR;
- não participar da automação.

## 7. Vigilância contínua

Toda alteração futura deve executar:

- auditoria de duplicidade;
- auditoria semântica;
- validação de indexação;
- validação de canonicidade;
- validação de conflito operacional.
