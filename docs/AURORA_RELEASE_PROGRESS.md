# AURORA NEXUS — progresso até a versão vendável

## Incremento HML documental — 15/10/2026

Na baseline `c7c234cae263a4c2cb4fa854a5fa26a4ab0b3509`, o teste real isolado
extraiu quatro formatos, mas a persistência foi recusada por escopo HMAC.
O titular aprovou somente `sourceDocument` na versão protegida 4 até 00h de
16/10 em Brasília. O candidato exige a transição 3 → 4 ou 4 → 4 no runtime,
preservando IAM, conta e rota; deploy e repetição real seguem pendentes de prova.
[Decisão, testes e recuperação](AURORA_HML_DOCUMENT_SCOPE_20261015.md).
Este incremento não declara ingestão global, ativação de pasta real nem beta completa.

## Release train histórico

- Produto: **1.0.0-rc.1**
- Política operacional: **2.3.0**
- Motor orgânico: **1.2.0**
- Native Intelligence: **0.1.0**
- Piloto de referência: **WMGJ Operação**
- Baseline de código: `main` pós-PR #39

## O que já é produto

- login-first, sessão e membership;
- Firestore protegido e tenant WMGJ;
- módulos M01–M10 e M03.1;
- dashboard SHADOW;
- ações de auditoria com evidência;
- AURORA-ORG-001 AUDIT/FINANCE;
- deploy HML protegido e smoke autenticado;
- retomada/idempotência do fluxo orgânico;
- Native Intelligence v0 sem provedor externo, neste RC.

## Bloqueios objetivos

### Portal canônico e cutover HML — 08/10/2026
`AURORA-CANONICAL-PREFLIGHT-001`: o workflow verifica DNS resolvido, HTTPS com
certificado válido, formulário de login utilizável, negação anônima do bootstrap
e `init.json` ligado ao projeto HML aprovado antes da autenticação de nuvem.
Redirect é recusado, inclusive o loop portal → Firebase técnico → portal.
Os smokes público e autenticado usam `https://auroranexus.com.br`; login,
membership, MFA, CSRF e gates do release assinado continuam na autoridade Firebase.
Patch candidato sobre `de1ae74d88fdec711c6ed89fe29fe1dd755d0bc7`, com regressões
sintéticas; não comprova DNS/TLS emitido, implantação, login real, ingestão ou GA.
Responsável operacional: titular do domínio e maintainer HML. Próximo gate:
concluir DNS/TLS apontando ao roteamento revisado do gateway com o AuthGate
Cloud Run existente, executar preflight real e CI no SHA final antes do deploy HML.
Rollback: reverter o patch e restaurar a revisão conhecida do gateway; preservar
sessão, banco existente e backups, sem publicar redirect técnico antes do cutover.

### Projeto de produção — 05/10/2026
`AURORA-PROD-PROJECT-001`: produção permanece `BLOCKED_PROJECT_NOT_VALIDATED`.
Request v2 e domínio mantêm ID/número nulos; candidato recusado somente histórico.
Bootstrap/workflow exigem contrato explícito e consulta GCP read-only bem-sucedida
antes de provisionar. Criação de projeto e vínculo automático de billing removidos.
Patch baseado em `68467209`; testes sintéticos não constituem produção verificada.
HML e recursos de produção preservados. [Contrato e próximo gate](../firebase-migration/docs/38-production-project-contract.md).

### Ingestão real
Não liberar enquanto faltar ensaio real de restore e promoção governada da identidade/keyring de ingestão.

### Desktop
Não tratar launcher HML como sucessor do aplicativo funcional. Inspecionar a baseline instalada e validar atualização in-place/rollback.

### Collective Intelligence
Privacy Gate → Knowledge Capsule → Knowledge Registry → Pattern Matcher permanece o próximo grande módulo de produto; não deve receber dados brutos de outro tenant.

## Definição de avanço por prompt

Toda solicitação relevante deve:
1. gerar ou atualizar patch;
2. adicionar teste;
3. alterar um gate ou explicar por que não altera;
4. manter rollback;
5. reportar SHA/CI/deploy separadamente;
6. escolher o próximo bloqueio de maior impacto.

## Próximos incrementos recomendados

1. fechar recovery gate e liberar amostra operacional real WMGJ;
2. implementar M12 Collective Intelligence em modo PRIVATE/COLLABORATIVE;
3. consolidar a IA nativa com Knowledge Registry e Pattern Matcher;
4. validar atualização do app Mac instalado;
5. hardening comercial, domínio, distribuição e documentação;
6. promover RC aprovada para `1.0.0` GA.

### 13/10/2026 — importação web: feedback e retomada

Candidata baseada em 86cec72: elimina descarte silencioso durante bootstrap e a
mensagem de fonte ausente para documentos recebidos aguardando validação. Mantém
recibos parciais, idempotência, MFA, tenant e revisão humana. Dezoito regressões
focadas e TypeScript no executor remoto passaram; CI, publicação, smoke e recibos
reais ainda PENDING. Fonte/rollback no adendo de
`docs/AURORA_MASTER_KNOWHOW_TRANSFER_20261013.md`. Não muda gate clínico ou financeiro.


### 13/10/2026 — proveniência dos checks da publicação

Baseline c688f5c: run 38452585771 implantou e verificou o runtime, mas o registro
ativo foi bloqueado por checks de dispatches históricos. Patch restringe a
seleção ao deploy atual comprovado e preserva todos os gates CI/segurança,
aprovação e CAS. Regressões sintéticas verificam a seleção e os bloqueios;
CI/HML do patch pendentes. Evidência, limites e rollback no adendo do
`AURORA_MASTER_KNOWHOW_TRANSFER_20261013.md`.

### 13/10/2026 — candidata de cobertura comum dos componentes

O pin v1 do run `38457139904` é verificável, mas cobre Server/Web e Satellite,
sem pacote local IA Master ou integração Windows. A candidata v2 exige cinco
componentes com bytes reais e leitor privado por `integration.read`, nonce e
runtime coerentes. O registro e o Cockpit mantêm v1 PARCIAL, dispositivos/Mac
UNVERIFIED e `allClientsSynchronized=false`; não criam executor ou auto-instalação.
Esta candidata ainda está NOT_DEPLOYED, sem CI/publicação v2 ou recibo instalado.
Contrato, autoridade existente, testes e rollback em
`AURORA_ACTIVE_RELEASE_COMPONENTS_V2.md`. R029 conserva o escopo original; o titular
renovou expressamente seu prazo até `2026-10-16T03:00:00.000Z`, com revisão até
15/10/2026, sem revisão independente ou extensão automática implícitas.

### 14/10/2026 — alimentação financeira estruturada

Candidata sobre `2bc6e6a`: aliases de cabeçalhos reais, abas 18/19 como evidências
de controle, origem por campo, replay versionado, preservação de null e exclusão
de notas substituídas. Distingue saldo a receber de bruto e prazos a pagar de
emissão/crédito. Não altera fechamentos. CI, publicação e ingestão real possuem
gates independentes. Ver `AURORA_STRUCTURED_FINANCIAL_FEEDING.md`.
