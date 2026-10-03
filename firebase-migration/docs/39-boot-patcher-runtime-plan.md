# AURORA NEXUS — decisão de runtime do boot patcher

Estado: SPECIFIED, implementação e ensaio integrado pendentes. Este documento
não adiciona endpoint, executor, armazenamento, segredo ou ativação.

## Baseline preservada

O PR #43 está fechado como absorvido pelo PR #66; seus contratos permanecem na
main. Não reabrir outro contrato concorrente. O status operacional v1 permanece
estável e o v2 é negociado explicitamente. O manifesto server-side canônico é
`firebase-migration/schemas/organic-patcher.schema.json`, com
`executionMode=READ_ONLY`, `activationAllowed=false` e sem estado `applied`.

Reutilizar AURORA-ORG-001, os checkpoints, a auditoria e a idempotência existentes.
AURORA NEXUS continua sistema-mãe; cada Client Operation Skill pertence ao seu
cliente/organização. WMGJ Operação é o piloto, não regra estrutural do executor.

## Sequência server-side proposta

1. No boot, usar a sessão autenticada existente e a atestação App Check suportada
   pela superfície. Sem atestação tecnicamente homologada, manter o adaptador
   bloqueado; não aceitar um booleano enviado pelo cliente como prova.
2. Revalidar organização ativa, membership e escopo no backend. Resolver
   `orgId/clientSkillId` pela configuração autorizada do servidor. Identificadores
   do request não conferem autorização. Revisão/execução/rollback exigem MFA.
3. Ler o manifesto no escopo do checkpoint existente, validá-lo contra a fonte
   canônica e vincular versão do cliente, plataforma, versão do plano, evidência
   e fingerprint. Mudança/revogação de fonte ou revisor invalida elegibilidade.
4. Retornar somente estado público minimizado e ações explicitamente permitidas.
   Segredos e tokens de integração ficam no servidor; não enviar manifesto bruto,
   actorUid, evidência privada ou credenciais ao frontend. Sem download/execução
   de código indicado por documento, shell arbitrário, eval ou import remoto.
5. Na primeira fase, boot apenas observa disponibilidade. Aprovar piloto não
   equivale a aplicar patch; não mudar `activationAllowed=false` para contornar
   o contrato. O manifesto v1 não autoriza atualização de código ou migração.
6. Quando autorizado um ensaio de runtime, registrar evento e chave idempotente
   nos mecanismos existentes do tenant. Conflito de revisão ou resultado
   desconhecido exige reconciliação, nunca repetir uma mutação às cegas.

## Adaptadores e aceite

| Superfície | Aceite específico | Bloqueador atual |
| --- | --- | --- |
| Web/PWA | sessão/CSRF existentes, App Check validado, cache não reaproveita manifesto de outra organização | adaptador e ensaio integrado não implementados |
| Desktop macOS/Windows | identidade instalada preservada, versão exata, atualização idempotente com backup e rollback nativo | baseline e assinatura/distribuição ainda não homologadas |
| iOS/Android | atualização pelo mecanismo autorizado da plataforma, nenhuma execução de código arbitrário | adaptador, atestação e distribuição não homologados |
| wrapper | mapear explicitamente a superfície real; wrapper não concede permissões adicionais | contrato aceita wrapper no manifesto, mas allowedSurfaces exige uma superfície concreta |

## Auditoria e rollback

READ_ONLY mantém `rollbackPolicy=not_applicable_read_only`. Uma futura atualização
mutante exige contrato separado e revisão, bundle/artefato assinado, compatibilidade
de versão, backup verificável, recibo local, health check e rollback testado.
Não inferir rollback porque existe uma função ou exemplo de LaunchAgent.
Auditoria associa tenant, clientSkill, versão/fingerprint, operação, resultado e
correlação; não inclui payload sensível nem permite autoaprovação pelo patcher.

## Smoke proposto sem deploy produtivo

Fixtures e emulador devem recusar tenant/clientSkill trocados, versão incompatível,
manifesto com activationAllowed=true, ausência de App Check/MFA, evidência ou
autor revogado, replay e proposta modificada após aprovação. Verificar falha de
rede, boot concorrente e cache após logout/troca de tenant. Confirmar que nenhuma
superfície produz estado `applied` ou gravação operacional no contrato v1.

## Fila pronta para implementação

| Pendência | Estado/evidência | Risco | Responsável sugerido | Próxima ação e aceite | Bloqueador real |
| --- | --- | --- | --- | --- | --- |
| Compatibilidade dos schemas | COMPROVADO em código e CI dos contratos existentes | regressão de consumidores legados | backend/QA | preservar testes v1/v2 e manifestos negativos no SHA final | novos adaptadores ainda sem ensaio |
| operational-status v2 separado | COMPROVADO na main, v1 preservado | interpretação silenciosa de v2 como v1 | backend | negociação explícita em cada consumidor | inventário de consumidores/aceite integrado |
| Local do manifesto | COMPROVADO em firebase-migration/schemas | contratos duplicados | plataforma | usar uma fonte canônica | nenhum para localização |
| Runtime do boot | SPECIFIED, ainda PENDENTE de código | cruzamento de tenant ou autoaplicação | plataforma/segurança | implementar primeiro observação server-side autenticada e testes negativos | adaptadores/Auth/App Check e review técnico |
| Smoke sem produção | plano pronto, não executado para o novo runtime | teste sintético confundido com operação | QA | emulador + matriz de negações + recibos dos adaptadores | runtime não implementado; Mac apenas para ensaio nativo |

Escopo comercial 0–60 dias preservado: Client Operation Skill, Painel Dinheiro
pelo Ralo/Relógio da Perda, Pensar como o Serviço, diagnóstico teste, robô Firebase
de comunicação/saneamento e Gmail/Drive Indexer LGPD. Disponibilidade de contrato
ou módulo não comprova instalação, ingestão, patch aplicado ou ganho financeiro.
