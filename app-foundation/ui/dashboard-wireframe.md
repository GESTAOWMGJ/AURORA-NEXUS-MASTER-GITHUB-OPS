# Wireframe do Dashboard AURORA NEXUS

## Objetivo

Consolidar a interface operacional do AURORA NEXUS para web app, PWA, desktop e mobile client, preservando login obrigatório, segregação por cliente e leitura executiva centrada em dinheiro, prazo, responsável, evidência e saneamento.

```text
AURORA NEXUS = painel único de decisão.
E-mail, Drive, planilha, Notion, Firebase e integrações viram backend operacional.
```

## Tela inicial autenticada

```text
+--------------------------------------------------------------------------------------------------+
| AURORA NEXUS®                                                                                    |
| Cliente: ORG_NAME | Skill: CLIENT_OPERATION_SKILL | Ambiente: HML/PROD | Modo: TESTE/CONTRATADO |
| Usuário: ROLE | Sessão: VERIFICADA | MFA: OK | Orgânico: PROPOSTA / REVISÃO / BLOQUEADO          |
+--------------------------------------------------------------------------------------------------+
| DINHEIRO PELO RALO AGORA                                                                         |
| R$ em risco       | R$ parado       | R$ recuperável provável | R$ perda provável | R$ confirmada |
| 000.000,00        | 000.000,00      | 000.000,00              | 000.000,00        | 000.000,00    |
| Cada cifra possui valor em centavos + selo próprio de confiabilidade e evidência                    |
+--------------------------------------------------------------------------------------------------+
| RELÓGIO DA PERDA                                                                                 |
| Valor               | Prazo restante | Categoria          | Responsável         | Status         |
| R$ 00.000,00        | 72h            | Glosa reversível   | Auditoria/Fat.      | EM RISCO       |
| R$ 00.000,00        | 5 dias         | Conta parada       | Faturamento         | PEND. EVIDÊNCIA|
+--------------------------------------------------------------------------------------------------+
| PENSAR COMO O SERVIÇO                                                                            |
| Insight técnico-financeiro                                                                       |
| - A operação está deixando receita parada por documento sem dono.                                |
| - O gargalo real é comunicação + evidência + prazo, não falta de produção.                       |
| - Prioridade sugerida: itens com cifra alta + prazo curto + evidência incompleta.                |
+--------------------------------------------------------------------------------------------------+
| FILA DE SANEAMENTO DOCUMENTAL                                                                    |
| ID | Categoria | Valor | Confiabilidade | Origem | Responsável | Prazo | Próxima ação | Evidência |
| 01 | Glosa     | R$    | RECUPERÁVEL    | Gmail  | Auditor     | D+2   | Revisar doc  | Abrir     |
| 02 | NFS-e     | R$    | DIVERGENTE     | Drive  | Financeiro  | D+5   | Conferir NF  | Abrir     |
+--------------------------------------------------------------------------------------------------+
| DIFICULDADE DO CLIENTE NO TESTE                                                                  |
| Tentativas manuais | Resp. acionados | Dias até resposta | Itens sem dono | Vencidos | Resolvido | Travado |
| 000                | 000              | 000               | 000            | 000      | R$ 0,00   | R$ 0,00 |
| Mensagem: O teste revela onde a receita rasga. A contratação entrega saneamento com método.       |
+--------------------------------------------------------------------------------------------------+
| COMUNICAÇÕES E ROBÔ FIREBASE                                                                     |
| Pré-aprovadas: 000 | Aguardando resposta: 000 | Escaladas: 000 | Bloqueadas por regra: 000          |
| [Ver fila] [Ver templates permitidos] [Ver bloqueios de segurança]                               |
+--------------------------------------------------------------------------------------------------+
| PATCHER ORGÂNICO                                                                                 |
| Versão base | Versão cliente | Estado orgânico | Execução  | Ativação | Evidência | Revisão humana |
| 1.0.x       | client-x.y.z   | PROPOSTA/REVISÃO| READ_ONLY | BLOQ.    | Hash      | OBRIGATÓRIA     |
| [Simular patch] [Ver manifesto] [Ver diff permitido] [Solicitar revisão]                         |
+--------------------------------------------------------------------------------------------------+
| AUDITORIA                                                                                        |
| ✓ Login-first preservado                                                                         |
| ✓ Sem segredo no front-end                                                                       |
| ✓ Fonte autorizada por orgId                                                                     |
| ✓ Cifra com status de confiança                                                                  |
| ✓ Encerramento somente com evidência                                                             |
+--------------------------------------------------------------------------------------------------+
```

## Estados principais

### Modo teste 0–60 dias

O cliente recebe visibilidade auditável do problema, mas não recebe o saneamento completo.

```text
Diagnóstico é benefício.
Saneamento completo é produto.
```

Exibir:

- cifras por categoria;
- evidência mínima;
- prazo crítico;
- responsável provável;
- dificuldade de saneamento manual;
- comparativo detectado vs resolvido pelo cliente.

Reservar para contratação:

- automação integral de comunicação;
- playbook completo;
- templates completos;
- estratégia integral de defesa de glosa;
- priorização avançada de reversibilidade;
- diagnóstico institucional profundo.

### Modo contratado

Ativar saneamento completo conforme escopo, incluindo comunicação institucional, escalonamento, automação de pendências, filas por responsável, governança de glosas e relatórios executivos.

## Painel “Dinheiro pelo Ralo”

O gestor pode ignorar e-mail e planilha; não deve ignorar cifra.

Categorias obrigatórias:

```text
RECEITA_EM_RISCO
DINHEIRO_PARADO
RECEITA_RECUPERAVEL
PERDA_EVITAVEL
PERDA_PROVAVEL
PERDA_CONFIRMADA
```

Selo obrigatório de cada cifra:

```text
COMPROVADO
ESTIMADO
EM_RISCO
RECUPERAVEL_PROVAVEL
PENDENTE_DE_EVIDENCIA
DIVERGENTE_ATE_VALIDACAO
PERDA_PROVAVEL
PERDA_CONFIRMADA
```

Cada cifra deve abrir drill-down auditável:

- competência;
- fonte;
- documento;
- e-mail/thread, se aplicável;
- responsável;
- prazo;
- cálculo;
- evidência;
- status;
- próxima ação;
- hash ou trilha de auditoria.

## Ferramenta “Pensar como o Serviço”

A interface deve apresentar insights técnicos sobre a operação real do cliente:

```text
documentos → e-mails → glosas → prazos → contratos → faturamento → repasses → atrasos → retrabalho → dinheiro parado
```

Saída esperada:

```text
insight técnico → insight financeiro → ação de saneamento → valor percebido → argumento comercial
```

O insight deve distinguir:

- fato comprovado;
- estimativa;
- hipótese operacional;
- necessidade de evidência;
- recomendação de painel;
- ação reservada ao modo contratado.

## Client Operation Skill

Cada cliente deve ter uma habilidade operacional própria:

```text
1 cliente = 1 Client Operation Skill
```

A interface deve sempre mostrar:

- `orgId`;
- `clientSkillId`;
- versão base;
- versão do cliente;
- módulos habilitados;
- fontes autorizadas;
- modo de operação: teste ou contratado;
- status do patcher orgânico.

## Patcher orgânico por boot

No estado atual do AURORA-ORG-001, o boot executa somente checagem e projeção governada. Não existe autoaplicação de código, regra financeira ou escrita operacional.

```text
app inicia
↓
valida sessão + App Check + orgId + role
↓
baixa manifesto server-side versionado
↓
compara versão base e versão do cliente
↓
simula/projeta a proposta em READ_ONLY
↓
exige evidência atual + revisão humana/MFA para piloto limitado
↓
registra auditoria e recomendação de rollback
```

O manifesto é contrato server-side em `firebase-migration/schemas/organic-patcher.schema.json`. `activationAllowed` permanece `false` neste contrato.

Superfícies cobertas:

- web app;
- PWA;
- desktop client;
- mobile client;
- wrappers instaláveis.

O patcher não pode:

- expor token;
- executar segredo no front-end;
- alterar regra financeira sem backend;
- ativar módulo sensível sem revisão quando exigida;
- mover, apagar ou sobrescrever fonte documental;
- contornar login, App Check, MFA ou LGPD.

## Interações

### Diagnosticar

Executa diagnóstico operacional permitido, atualiza cards e classifica cifras.

### Processar fila

Solicita processamento server-side do próximo lote autorizado.

### Reprocessar erros

Filtra registros com erro recuperável e solicita nova tentativa.

### Abrir revisão

Abre item em fila humana com fonte, evidência, cálculo e status.

### Simular patch

Calcula diff permitido do patch orgânico, sem aplicar mudança.

### Aprovar piloto / executar leitura limitada

Somente o backend do AURORA-ORG-001 pode aprovar o piloto vigente após revisão humana/MFA. A execução permanece `READ_ONLY`, vinculada à revisão/fingerprint atuais e não autoriza mutação financeira, documental ou de código.

### Ver “O que o AURORA teria feito”

No modo teste, mostra benefício sem entregar a automação completa.

## Estados visuais

- **OK:** operação sem bloqueio crítico.
- **ATENÇÃO:** há itens pendentes, cifra em risco, revisão humana ou patch pendente.
- **ERRO:** falha operacional crítica, credencial ausente, regra de segurança bloqueada ou inconsistência sem fonte.
- **CRÍTICO:** dinheiro em risco com prazo curto.
- **BLOQUEANTE:** impede fechamento, faturamento, recurso ou pagamento.

## Regra de UX

A interface deve tornar óbvio:

- o que é leitura;
- o que é estimativa;
- o que é evidência comprovada;
- o que é ação segura;
- o que exige revisão humana;
- o que existe apenas no modo contratado.

Botão bonito não é autorização para destruir dado. Ação sensível só com escopo, backend, auditoria e rollback.
