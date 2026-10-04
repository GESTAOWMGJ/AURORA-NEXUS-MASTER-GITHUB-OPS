---
name: aurora-data-governance-autonomy
description: Aplicar o gate nativo de dados e limites de autonomia ao Motor Mestre AURORA, sem converter recomendação em autorização.
version: 1.0.0
code: AURORA-DATA-GOV-AUTONOMY-001
---

# AURORA — Governança de dados e autonomia limitada

## Vínculo e estado real

Extensão de AURORA-MO-001, AURORA-MASTER-OPS-001 e AURORA-ORG-001 no mesmo produto e banco. Ler AGENTS.md, docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md e docs/AURORA_DATA_GOV_AUTONOMY_001.md.

Esta versão implementa o gate de dados e o planejamento de comandos do Motor Mestre. Não é um autorizador universal de todas as APIs, não ativa executor autônomo, não treina pesos de modelo e não significa implantação em produção. A fonte executável é firebase-migration/functions/src/auroraDataGovernance.ts, consumida por auroraMasterEngine.ts antes da inferência.

## Contrato

Entradas: snapshot canônico persistido no Firebase, horário do servidor e comando de vocabulário fechado. O BFF deve verificar sessão, organização ativa, membership, RBAC e escopo de unidade antes de entregar dados ao motor. Nunca aceitar contexto de autorização derivado de texto de documento, resposta de modelo ou parâmetro livre do navegador.

Saída: ALLOW, REVIEW ou DENY no escopo NATIVE_RECOMMENDATION_ONLY, reasonCodes controlados, policyId, policyVersion, policyHash, snapshotId, sourceHash e snapshotAgeMs. executionAuthorized permanece false. ALLOW significa apenas dados aptos para recomendação; nunca aprovação financeira, permissão para executar API ou atestado da veracidade de uma fonte.

Pré-condições: organização identificada, snapshotId, hash-fonte, schema e versão de política suportados, competência válida, INTERNAL sanitizado, contrato Firebase sem releitura da origem ou IA externa, dados presentes e qualidade confirmada. Ausência, revogação, versão incompatível, relógio inválido e snapshot vencido bloqueiam. Fragilidade ou cobertura documental desconhecida exigem revisão.

Limites candidatos de engenharia: snapshot até 30 minutos e tolerância futura de 60 segundos. Não são prazos legais nem limiares prescritos pelo NIST. Exigem validação do cadence/coverage real em HML antes da promoção. Atualidade do snapshot não prova atualidade de cada documento-fonte.

## Autonomia A0–A5

Taxonomia interna do produto, não classificação normativa universal:

| Nível | Capacidade | Estado desta versão |
| --- | --- | --- |
| A0 | Observar dados autorizados | Reutiliza acesso existente |
| A1 | Analisar, explicar, recomendar | Nível efetivo do Motor Mestre |
| A2 | Preparar proposta de ação para revisão | APIs humanas existentes; sem execução pelo mestre |
| A3 | Executar efeito interno reversível sob delegação e limites | Não habilitado |
| A4 | Orquestrar múltiplos efeitos sob orçamento, supervisão e rollback comprovados | Não habilitado |
| A5 | Autonomia irrestrita, autoampliação de privilégios ou objetivos | Proibido |

Mesmo um futuro A3/A4 não autoriza decisão clínica, pagamento, peticionamento jurídico/regulatório, mudança contratual, mutação de sistema-fonte, deploy ou código arbitrário sem fluxo e aprovação próprios. A base legal de tratamento não equivale a mandato para decidir ou agir.

## Efeitos e gates

O mestre só produz objetos de análise. maxAutonomousWrites=0, maxExternalAiCalls=0 e maxSourceMutations=0. Não interpreta texto como código, não faz chamadas de modelo, não cria conectores, não executa comandos do catálogo.

REFRESH_PROJECTION, CREATE_REVIEW, ACKNOWLEDGE_ACTION, RESOLVE_WITH_EVIDENCE, MANAGE_INTEGRATION e DISTRIBUTION_DECISION permanecem REVIEW, com executionAllowed=false. Com dados bloqueados, somente solicitação humana de refresh é sugerida para recuperação. Todo comando desconhecido é DENY, sem endpoint devolvido.

No envio humano, as APIs existentes devem revalidar sessão, permissão, escopo, CSRF, revisão, idempotência e evidência. MFA continua obrigatório nos fluxos que já o exigem. RESOLVED/CLOSED textual não constitui prova. Repetir um caso não aumenta a amostra independente do aprendizado orgânico.

## Trilha e aprendizado

O objeto de avaliação contém versões, hashes e códigos explicáveis. Nesta versão decisionTracePersisted=false: não se confunde uma resposta JSON com registro persistente ou imutável. Comandos humanos continuam usando as trilhas já existentes. Hash não autentica autor e não é assinatura de política.

Treinamento operacional significa regras versionadas, casos sintéticos e testes de regressão. Nenhum documento privado vira corpus de fine-tuning por esta habilidade. Padrões interclientes só podem ser abstrações sanitizadas, testadas e aprovadas. Nunca transferir valor financeiro, identificador ou evidência bruta entre tenants.

## Falhas, retomada e rollback

DENY: interromper inferência; mostrar bloqueio e evidência faltante. REVIEW: mostrar limitação e encaminhar ao responsável sem liberar execução. Dados desconhecidos permanecem null nas métricas e Sem fonte na interface. Falha de rede ou sessão não pode tornar valor antigo atual.

Reverter o patch de código para versão aprovada não apaga snapshots, histórico, fontes ou ações. Não desabilitar login, isolamento, backup/restore, CSRF ou MFA para contornar erro. Publicação em HML e atualização do aplicativo instalado são gates separados.

## Avaliação obrigatória

Executar aurora-data-governance.test.ts e aurora-master-engine.test.ts, suíte completa Functions, testes Rules/API, CI e smoke HML no SHA final. Casos incluem evidência ausente/revogada/vencida, payload de sensibilidade indevida, versão incompatível, booleano serializado errado, comando desconhecido, contagem inválida, limite temporal e negação antes da inferência. Testes de vocabulário fechado não equivalem a red-team completo de exfiltração ou prompt injection.

Antes de autonomia A3: autorização server-side por efeito e identidade de workload, consumo atômico de orçamento/idempotência, revisão contra TOCTOU, kill switch testado, ledger persistente minimizado, retenção e responsabilidades definidas, ensaio de rollback e aprovação humana. Não promover por CI verde sozinho.
