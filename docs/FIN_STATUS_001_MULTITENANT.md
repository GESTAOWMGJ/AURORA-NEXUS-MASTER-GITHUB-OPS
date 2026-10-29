# AURORA NEXUS | FIN-STATUS-001 — Situação Financeira por Empresa
Versão: 0.1.0 (proposta técnica, NÃO implantada) | 2026-10-29

## Objetivo
Página autenticada `/empresas/:tenantId/financeiro` para cada empresa cadastrada e habilitada no AURORA NEXUS, com conciliação de produção, faturamento, contas a receber, pagamentos, repasses e caixa. O front-end deve consumir API do motor autônomo; conversas com ChatGPT não são mecanismo de operação.

## Perfis e isolamento
- `OWNER`: dados completos da própria empresa e permissões de sócios; nunca de outro tenant.
- `PARTNER`: visão consolidada e documentos autorizados da própria empresa; dados sensíveis de colaboradores mascarados.
- `FINANCE`: conciliação, documentos fiscais, lançamento, justificativas e exceções; gravação auditada.
- `AUDITOR`: acesso somente leitura, escopo e prazo definidos.
- `PATIENT`: somente suas próprias cobranças, recibos e pagamentos, *nunca* fluxo de caixa, lucro, remuneração ou faturamento global da empresa.
- Nenhuma informação financeira, de pacientes ou credenciais embutida no repositório público. Exigir tenant_id no token E em cada consulta SQL, com row-level security (RLS); negar por padrão.

## Estados de confiança (por competência)
- `RECEIVED`: produção/documento recebido, sem afirmar elegibilidade.
- `UNDER_REVIEW`: em conciliação, divergências ou glosas ainda sem decisão.
- `INVOICED`: NFS-e validada por número, competência, tomador, valor e XML/protocolo.
- `SENT`: envio ao tomador comprovado com destinatário, horário e evidência.
- `ACKNOWLEDGED`: recepção/aceite comprovada; envio isolado não equivale a aceite.
- `PARTIALLY_PAID`: crédito(s) parcialmente conciliado(s).
- `PAID`: comprovante financeiro conciliado com nota e período.
- `UNKNOWN`: sem evidência; nunca converter em zero nem exibir como pago.
Exibir estado independente por etapa (produção, autorização, emissão, envio, aceite, recebimento, repasse, fechamento), sem supor ordem estrita para lançamentos retroativos.

## Indicadores
Receita faturada = soma das NFS-e válidas da competência (excluídas canceladas e substituídas).
Recebido = créditos conciliados, sem duplicação.
A receber = faturado - recebido - abatimentos formalmente comprovados (não usar estimativas como glosa).
Produção de referência separada da receita elegível e faturada.
Caixa = saldo de contas conectadas com data e hora da última confirmação; dados ausentes => “não verificado”.
Resultado estimado e resultado fechado são métricas distintas. Proibir soma automática de honorários antecipados, NF de fornecedor e pagamento.

## Contrato de dados mínimo
```json
{
  "tenant_id": "UUID",
  "competence": "YYYY-MM",
  "as_of": "ISO-8601",
  "freshness": {"last_sync_at": "ISO-8601|null", "status": "fresh|stale|unknown"},
  "production": {"count": null, "reference_amount": null, "verified": false},
  "invoice": {"number": null, "amount": null, "issued_at": null, "sent_at": null, "acknowledged_at": null},
  "cash": {"received_amount": null, "bank_verified_at": null},
  "reconciliation": {"status": "UNKNOWN", "open_exception_count": null},
  "evidence": []
}
```
Campos desconhecidos são nulos, nunca fabricados. Valores monetários em centavos inteiros na API, BRL e timezone da empresa.

## Integrações
1. Conectores de SPDATA/produção, Drive autorizado, Gmail institucional, NFS-e e banco/ERP, cada um autorizado por empresa, com escopo mínimo e cofre de segredos.
2. Motor agenda ingestão e conciliação por tenant; fila idempotente com `source_id + document_hash + tenant_id`, deduplicação e reprocessamento seguro.
3. Event sourcing de evidências e estados: origem, hash SHA-256, horário, competência, autor e justificativa; exceções não bloqueantes geram resultados parciais claramente sinalizados.
4. Atualização por SSE/WebSocket ou polling autenticado, exibindo “atualizado há X min” e aviso de dados defasados. “Tempo real” significa status conforme último evento recebido, não acesso bancário contínuo garantido.
5. Logs técnicos imutáveis, métricas, backups, retenção, LGPD e controle de acesso com MFA para perfis privilegiados.

## Interface
Cards: “Faturado”, “Recebido”, “A receber”, “Produção em conferência”, “Caixa verificado”, “Pendências”; linha do tempo por competência; documentos vinculados; botão “Copiar STATUS FINANCEIRO” com números, estados, data/hora e ressalvas; visualização simplificada com glossário e acessibilidade.
Portal paciente: “Meus pagamentos e recibos”, separado por RBAC e tenant; NPS é formulário voluntário de satisfação do serviço, jamais exposição de indicadores privados.

## Critérios de aceite antes de marcar operacional
- Testes de isolamento horizontal tenant A vs B e paciente vs sócio.
- Evidência de ponta a ponta: documento -> NFS-e -> envio -> crédito bancário -> reporte; divergência mantida sem bloquear painel.
- Testes negativos: NFS-e ausente, crédito sem vínculo, documento duplicado, fontes offline, documento de outra empresa, reprocessamento.
- Trilha auditável e indicadores sem dupla contagem; aprovação de perfil/consentimento; não publicar dados reais.
- CI aprovado, revisão humana de segurança/LGPD, deploy com URL real, healthcheck e teste do usuário autorizado.
- Registro de `tenantCreated`, `providerWriteEnabled`, `deployVerified` baseado em evidência, nunca inferido.

## Piloto WMGJ
Usar dados reais somente após autenticação nos provedores autorizados. Setembro/2026: relatórios SPDATA recebidos (612 registros), escala corrigida reportada, faturamento/envio e pagamento sem evidência suficiente em 29/10/2026. Não codificar esses dados em front-end público. Agosto/2026: recebimento conciliado, divergência produtiva em auditoria; jamais transportar valores entre competências.

## Distribuição
Disponibilizar como módulo opt-in durante provisionamento de novas empresas, com configuração de fontes, papéis e políticas específicas por cliente. Não habilitar acesso financeiro para paciente por padrão. Nenhuma publicação, provisionamento, sincronização nem autonomia produtiva é comprovada por este documento.
