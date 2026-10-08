# AURORA NEXUS — progresso até a versão vendável

## Release train

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
