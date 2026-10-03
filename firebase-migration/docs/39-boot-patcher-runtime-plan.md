# AURORA NEXUS — decisão de runtime do boot patcher

Estado em 02/10/2026, America/Sao_Paulo: núcleo de observação IMPLEMENTED;
adaptador de identidade/persistência e ensaio integrado PENDENTES. O incremento
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

## Núcleo implementado e fronteira de confiança

`api/wmgj_api/boot_observer.py` pertence à API existente. `observe_boot` recebe
somente plataforma concreta e versões declaradas pelo cliente. A interface
interna `BootReadPort` fornece autorização, manifesto e evidência independente;
não pode ser construída por desserialização do request. Não há rota HTTP,
cliente Firebase, escrita ou adaptação automática de documento a código.

O futuro adaptador deve verificar sessão revogável, App Check, organização,
membership, permissão e escopo LGPD a partir das fontes autorizadas. Deve ler o
checkpoint EXISTENTE por orgId/clientSkill, vincular evidências e revisão/MFA do
revisor e fornecer uma revisão de snapshot que mude quando qualquer dessas
fontes mudar. A segunda autorização precisa detectar revogação e concorrência;
sem mecanismo consistente de revisão, o adaptador não atende ao contrato.
Booleanos de fixtures não comprovam autenticação real.

O núcleo usa diretamente `schemas/organic-patcher.schema.json` via jsonschema
2020-12. A dependência jsonschema já travada foi movida de dev para runtime, sem
troca de versão. O pacote de runtime deve incluir essa fonte canônica no caminho
esperado; sua ausência bloqueia a observação, sem fallback permissivo nem cópia
de contrato divergente. Esse aceite de empacotamento ainda está pendente.

As restrições adicionais são HML apenas; contexto/evidência com até 60 segundos;
manifesto com até 24 horas e data RFC3339 com fuso; teto de 256 KiB serializados e
256 referências distintas; patchIds únicos; superfície e versões vinculadas ao
servidor. Evidência que expira durante a leitura bloqueia o resultado. O hash do
manifesto usa JSON com chaves ordenadas e ASCII escapado, excluindo `audit.hash`,
e deve coincidir com o ponteiro confiável do servidor. Hash é integridade, não
assinatura nem autorização. Fingerprints de proposta são confrontados com a
fonte independente, sem reescrever hashes orgânicos anteriores.

`public_status` contém somente contagens/estados fixos, READ_ONLY,
activationAllowed=false e patchApplied=false. Não contém tenant, autor, texto
operacional, referências privadas ou manifesto bruto. O transporte futuro deve
serializar **somente** essa projeção, nunca o objeto `BootObservation` inteiro.
`audit_intent` é privado, possui correlação determinística e persisted=false;
retorná-lo não grava auditoria, não é recibo local e não comprova rollback. Cada
repetição revalida autorização/evidência; não existe cache dessas decisões.
Rollback recomendado permanece visível mesmo quando a evidência foi revogada.

Os testes usam exclusivamente fontes sintéticas. Validar web/PWA/macOS/Windows/
iOS/Android como valores de plataforma não executa nenhum desses aplicativos.
Não ligar esse núcleo a uma rota antes de implementar e revisar a fronteira
acima, persistência pelo mecanismo existente e smoke autenticado autorizado.

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
| Runtime do boot | PARCIAL: núcleo de observação implementado na API; integração PENDENTE | cruzamento de tenant, revisão inconsistente ou autoaplicação | plataforma/segurança | adaptar Auth/App Check/checkpoint existentes; comprovar revogação e projeção minimizada em integração | adaptador consistente, empacotamento do schema e revisão técnica |
| Smoke sem produção | PARCIAL: matriz sintética do núcleo; smoke integrado PENDENTE | teste sintético confundido com operação | QA | identidade/emulador + matriz de negações + recibos dos adaptadores | integração não implementada; Mac apenas para ensaio nativo |

Escopo comercial 0–60 dias preservado: Client Operation Skill, Painel Dinheiro
pelo Ralo/Relógio da Perda, Pensar como o Serviço, diagnóstico teste, robô Firebase
de comunicação/saneamento e Gmail/Drive Indexer LGPD. Disponibilidade de contrato
ou módulo não comprova instalação, ingestão, patch aplicado ou ganho financeiro.
