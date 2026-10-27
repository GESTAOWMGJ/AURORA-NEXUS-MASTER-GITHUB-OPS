# AURORA NEXUS — progresso até a versão vendável

## Sincronizador do web app 0.1.3 — 26/10/2026

Personalité permanece no fluxo de perfis existente, agora com readback autenticado
e versionado e consulta de cadastro após interrupção. Reconciliado com main
`5a89a766111a2942977198fbdacccbb2c0e8432f`; sem novo tenant real ou ingestão.
Contrato e rollback: [AURORA_WEBAPP_SYNC_0_1_3](AURORA_WEBAPP_SYNC_0_1_3.md).
O gate de primeiro acesso, TOTP real e implantação protegida permanece separado
do resultado de código/CI. Cadastro READY não declara sincronização documental.

## Entrega vigente HML — 25/10/2026

Registro canônico operacional: [AURORA-HML-DELIVERY-20261025-R1](AURORA_HML_DELIVERY_20261025_R1.md), com manifesto legível por máquina em [JSON](AURORA_HML_DELIVERY_20261025_R1.json).

Produto `1.1.0-beta.2`; referência ativa assinada `aurora-1.1.0-beta.2-cd4737ed0421df7ec53fc17d6e16c56443085013` permanece vigente para o produto. A revisão operacional `602528812bffc443a48a4d52fc115c6ab2af6081` publicou Apps Script canônico v46 e concluiu READBACK real no escopo autorizado: 51 documentos canônicos, 192 aliases e 12 pendências, sem mutação de fonte. Estado: `CURRENT_HML_CONTROLLED`, sem produção e sem alegação de sincronização global completa.


## Candidata de revinculação documental de credencial — 19/10/2026

Produto `1.1.0-beta.2`, WindowsIntegration `1.0.7`, módulos M08/M09/M10,
baseline reconciliada `b9fdc1ff9f6882b50c0b1f2f5f0b16a87a15e1da`. Uma chave expirada não pode
continuar autorizando checkpoint por recibo histórico. A candidata permite
revalidação explícita pelo POST documental existente com a nova identidade,
seguida de replay idempotente, sem alterar documento, versão imutável ou fatos
financeiros. O novo recibo vincula a operação atual à mesma tupla canônica e à
proveniência anterior. GET com `documentId` e `receiptId` seleciona somente o
recibo pertencente à chave autenticada e revalida escopos, emissor e automação.
GET isolado e troca local de identificadores não constituem revalidação.

A transição de checkpoint existente usa o pacote Windows da referência ativa e
preserva a âncora IA histórica assinada, seus bytes/metadata/identidade e a cadeia
de `previous/next/proof/commit`. A ativação continua exigindo prova remota fresca,
recibo calculado pela chave atual, configuração e tupla exatas, CAS e pin atual;
nenhuma comparação de `checkpointAuthority` foi dispensada. Este incremento
não instala componente, não amplia escopo e não declara ingestão global.

Código e testes são candidatos; revisão, CI no SHA final, publicação assinada e
adoção real permanecem provas separadas. O gate privado e os gates de instalação,
Mac/iOS e distribuição do Cockpit não são promovidos por essa alteração.
Rollback: reverter o incremento pelo fluxo revisado; preservar os recibos,
documentos, versões, transições e journals anteriores. Conhecimento e limites em
`AURORA_MASTER_KNOWHOW_TRANSFER_20261013.md`.


## Candidata de recuperação da sessão após MFA — 19/10/2026

Produto `1.1.0-beta.2`, módulo M09, baseline
`eaa9e20f537e1bd0ee9c9f9a6b79c35941853008`. O fluxo web existente distingue a
confirmação do segundo fator da posterior troca de sessão. Após MFA aceito, uma
falha dessa troca permite nova tentativa com o usuário SDK somente em memória,
token renovado e as mesmas verificações de revogação, organização e membership
no servidor. A tentativa não resolve novamente a asserção MFA já concluída.
Reentrar e sair da página descartam a retomada. Nenhum cookie é produzido no
cliente e não há mudança de autorização, IAM, duração de sessão ou armazenamento.

Regressões sintéticas cobrem `TEMPORARY`, `CROSS_SITE_LOGIN_REJECTED`,
`INVALID_LOGIN`, resposta HTML 403, negações de acesso, falha real de MFA,
concorrência, retomada e descarte na saída. Em Node 24.19.0, os 58 testes focados
de login, AuthGate, perfis, tenant e recuperação de senha passaram, assim como
`tsc --noEmit`. A validação CI em Node 22 permanece separada.
O gate privado do Release Cockpit
mantém seus critérios; esta correção de recuperação não promove qualquer gate
de CI/HML, distribuição, instalação ou produção. Testes, revisão e CI são
registrados no SHA final da PR; publicação e validação real desta candidata
permanecem pendentes. O acesso observado nesta sessão não prova que o patch
tenha sido implantado. Aprendizado e limites em
`AURORA_MASTER_KNOWHOW_TRANSFER_20261013.md`.

Rollback: reverter somente os arquivos deste incremento pelo fluxo revisado;
preservar contas, MFA, memberships, sessões existentes, documentos e recibos.

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


## 15/10/2026 ? CMEK autorizado para producao; recuperacao candidata

Autorizacao direta do titular registrada (comentario 6197336877, PR #99). Correcao reaproveitada em nova branch sobre a27d606, com grupo CLI KMS valido, backup por UID, restore concluido, reativacao obrigatoria e erros sem falso positivo. `IMPLEMENTED_PENDING_RECOVERY_VERIFICATION`: nao equivale a restore/deploy/cutover. Mantem `(default)` e CLINICAL_SENSITIVE inalterados. Documento: `docs/AURORA_CMEK_PRODUCTION_AUTHORIZATION_20261015.md`. SHA/testes/CI finais no PR.

### 19/10/2026 — renovação HML/R029 expressa

Decisão direta do titular renova o mesmo escopo HML de publicação da beta e testes
sintéticos Windows/nuvem até `2026-10-22T03:00:00.000Z`, com revisão até 21/10.
Histórico e 11 riscos residuais preservados; produção, dados clínicos e pasta real
continuam excluídos. Registro de autorização não comprova CI, deploy, ingestão ou
convergência dos dispositivos. Gates e revisão independente permanecem inalterados.
### 22/10/2026 — regularização restrita da configuração documental

Candidata baseada em `226a7f101f4bf1e0680afca2459132f01ebaf71d`: uma janela
separada de 24 horas permite ao proprietário conferir/remover exclusivamente o
gatilho de captura cujo handler desapareceu e registrar a fonte existente como
inativa. O piloto histórico continua expirado; HML/R029, publicação, ativação,
dados reais e critérios do Release Cockpit não são renovados nem promovidos.
Estado: `IMPLEMENTED_LOCAL_TESTED_PENDING_CI_REVIEW_DEPLOYMENT`.
Validação local: 62 testes sintéticos (38 de onboarding/configuração e 24 de
status/sanitização/prévia histórica). Nenhum gatilho real foi removido e nenhuma
fonte foi ativada por estes testes. Contrato, evidência e próximos gates em
[AURORA_WMGJ_CONNECTOR_REGULARIZATION_20261022.md](AURORA_WMGJ_CONNECTOR_REGULARIZATION_20261022.md).


### 22/10/2026 — renovação HML/R029 para publicar a regularização

Confirmação direta do titular após apresentação do PR #299 e dos seis workflows
aprovados: publicação em homologação e renovação até `2026-10-23T23:00:00.000Z`
(23/10 às 20h de Brasília). Decisão `AURORA-HML-OWNER-RENEWAL-20261022`,
com os mesmos 11 riscos residuais e registro de predecessor. O cadastro permanece
inativo; fonte real, produção e dados clínicos não são ativados. A autorização
não comprova review independente, aprovação de run, deploy ou ingestão.

### 22/10/2026 — renovação HML/R029 até 26/10

Resposta explícita “Renovar nesse escopo até 26/10” registrada na decisão
`AURORA-HML-OWNER-RENEWAL-20261022-TO-20261026`, posterior ao aceite específico do
PR #299, sem reescrever seus termos. Novo corte `2026-10-26T03:00:00.000Z`,
revisão até 25/10 e os mesmos 11 riscos das ferramentas de teste HML. Probe e
readback sintéticos usam o mesmo limite e continuam bloqueados no instante do
vencimento. Credenciais, escopo documental, piloto real e janela de regularização
da fonte não são prorrogados; produção, dados clínicos e ativação da pasta real
permanecem excluídos. Estado: `IMPLEMENTED_PENDING_CI_REVIEW_DEPLOYMENT`, sem
alegação de review independente, publicação, ingestão real ou instalação concluídas.


## 26/10/2026 — Personalité 0.1.2, candidato de acesso isolado

Cadastro de organização independente e titular, papéis administrativos restritos e tela própria no portal canônico. Reutiliza motor de perfis, CSRF, identidade, idempotência e auditoria. Nenhum tenant real ou gate produtivo promovido. Evidência local: 1.256 testes Functions, 30 Security Rules e integração Auth/Firestore emulados aprovados. Revisão técnica independente, CI no SHA final e HML com TOTP real permanecem gates distintos. Ver `AURORA_PERSONALITE_ACCESS_0_1_2.md` para fluxo, dados privados indispensáveis e rollback.
