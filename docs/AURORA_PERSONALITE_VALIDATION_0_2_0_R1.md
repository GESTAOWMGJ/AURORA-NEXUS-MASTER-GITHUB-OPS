# Personalité 0.2.0 — parecer técnico 0.2.0-r1

Data: 26/10/2026, Brasília. Escopo: revisão do código e reprodução sintética; não é aprovação humana independente, pentest externo, homologação autenticada ou certificação.

## Parecer

O candidato original **não deve ser promovido sem corrigir a revogação** descrita abaixo. A correção 0.2.0-r1 reutiliza o motor existente e passou nos testes locais. É candidato à homologação autenticada com dados operacionais sintéticos, condicionado ao CI do novo SHA, revisão humana independente, reconciliação com a main vigente e autorização nominal do ambiente. Não está liberado para ativação real do consultório.

O backend administrativo continua limitado a HOMOLOGATION + SYNTHETIC. Nenhuma alteração neste incremento libera REAL, produção, dados clínicos, credenciais, envio externo ou integração bancária. A revisão não criou organização real nem alterou WMGJ.

## Proveniência

- Baseline examinada e executada: `e801d893ebaaad94841f9d6104ebd296ce285706`, árvore `beb01247cab21485dd74d1297477d54ea023d885`.
- [PR #325](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/pull/325): aberto, draft, sem APPROVED humano na consulta. Apenas COMMENTED de github-advanced-security.
- [PR #340](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/pull/340): integrado ao ramo `feat/personalite-governance-0.1.0`, não à main; merge e801d89.
- Main observada: `8264dccededd498299d0565414e6b5ebd1aaffd6`. A consulta de branch retornou protected=false. Não foi alterada a proteção; não se presume enforcement de revisão/checks. Antes de promoção, verificar também rulesets aplicáveis.
- Correção isolada sobre a baseline. Não modifica a branch #325 nem integra main. O SHA do commit que contém este parecer identifica a revisão candidata; hashes dos arquivos executáveis/testes estão em [evidence.json](validation/personalite-0.2.0-r1/evidence.json).

## Achado reproduzido — revogação dependia da disponibilidade do Auth

Prioridade alta para promoção. Em `auroraUserProfiles.ts`, `revoke()` chamava `auth.getUser(uid)` antes da transação que desativa a membership. Uma indisponibilidade nessa leitura interrompia o pedido mantendo `active=true` e a operação READY. O teste anterior cobria falha de updateUser, mas não falha da leitura inicial. Isso não prova exploração nem acesso real; demonstra que uma tentativa de revogação podia deixar autorização local válida.

Reprodução no código original: três cenários de indisponibilidade, dois aprovados e um reprovado; no cenário getUser, a asserção recebeu `true` onde exigia `false` para membership.active.

Correção: primeiro revalidar administrador/organização e vínculo local membership–operação; gravar REVOKED e auditoria na mesma transação; depois consultar Auth e conferir UID, organização, versão e operação antes de desabilitar a identidade/revogar refresh tokens. Falha do Auth mantém acesso local fechado. Nova tentativa conclui a etapa do provedor sem duplicar auditoria. Divergência de identidade fecha somente o vínculo local e não altera conta estrangeira.

Regressões acrescentadas: falha getUser; falha revokeRefreshTokens; administrador revogado/organização estrangeira sem acesso ao provedor; identidade Auth de outra organização sem desabilitação indevida. O cenário existente updateUser continua coberto. Alteração no motor compartilhado exige revisão também de seus consumidores, embora não execute nenhuma operação WMGJ.

## Matriz técnica

| Área | Implementação e evidência examinadas | Limite da conclusão |
|---|---|---|
| Isolamento | Tenant extraído da sessão assinada; membership e organização consultadas novamente; claims não conferem permissão isoladamente. Rules negam acesso clínico no Personalité e grants/checkpoints a clientes. Testes de troca de tenant e transplante de ciphertext com AAD reprovam o acesso. | IAM efetivo do Admin SDK e pentest do ambiente não foram homologados. |
| Provisionamento | `createPracticeProvisioner` exige grant server-only, operador ativo com MFA, revisor distinto ativo com practice.validate, prazo, entidade, vínculo e consentimento; recusa WMGJ/origem; revalida grant em transações. | Flags e hashes não comprovam documentos privados. Revogar grant após READY não desativa automaticamente a organização já criada. |
| Identidade | UID determinístico por organização/operação; criação desabilitada sem senha/e-mail verificado; readback; sem buscar/adotar conta pelo e-mail. Conflito exige revisão. | Email real, titularidade e primeiro acesso não demonstrados. |
| Autenticação/MFA | Sessão com verificação de revogação; perfil gerenciado exige email_verified e sign_in_second_factor; Rules também exigem segundo fator. Emulador validou recuperação, confirmação de e-mail e negação com primeiro fator. | A aceitação do segundo fator depende do token do provedor. Cerimônia TOTP real, entrega externa e recuperação real de fatores não testadas aqui. |
| Revogação | Membership revalidada em leituras, mutações e replay; correção torna a revogação local independente da consulta Auth; tentativas ao provedor são retomáveis. | Se o provedor falhar, desabilitação Auth/revogação de refresh tokens permanecem por concluir; não reportar conclusão global. |
| Administração | Titular gerencia equipe, sem criar outro titular/org_admin ou acesso clínico; recepção/financeiro/editor possuem projeções e ações distintas. Privilégio genérico não abre o workspace. | Conteúdo de memória administrativa aprovado é compartilhado entre papéis; não inserir informação restrita por função nessa memória. |
| Idempotência | UID e operação determinísticos, fingerprint, lease, replay com autorização atual; transação de estado/recibo/auditoria; expectedRevision evita sobrescrita concorrente. | Testes sintéticos não equivalem a ensaio de carga; limite de 500 itens/coleção e 500 KB de estado. |
| Proteção | AES-256-GCM e AAD por organização/tipo/versão/id; teste de ciphertext trocado; token de confirmação aleatório, apenas hash persistido, expiração e POST explícito; CSRF por finalidade e origem. | Wrapping local é sintético. Cloud KMS, CMEK, IAM, rotação e restore reais precisam de recibos próprios. |
| Pagamentos | Conta/org/sessão/valor/moeda vinculados; HMAC no corpo original, janela temporal e deduplicação; somente Stripe TEST; conferência manual não marca liquidação. | Sem chamada real Stripe nesta revisão; Open Finance, envio e produção não implementados/homologados. |

## Reprodução e confronto com CI

Ambiente local: Linux, Node 24.22.1, Java 21.0.13, dependências pelos lockfiles. CI usa Node 22; a diferença permanece explícita. Java 17 inicial foi recusado pelo Firebase CLI; testes efetivos foram executados com Java 21, sem mudar dependências do projeto.

| Verificação | Baseline e801d89 | Correção local |
|---|---|---|
| TypeScript build | Aprovado | Aprovado |
| Functions | 1.287/1.287; zero falhas | 1.291/1.291; zero falhas/skips |
| Security Rules | CI: 30/30 | Local: 30/30 |
| Auth/Firestore emulados | CI: PERSONALITE_EMULATOR_OK e operações | Local: ambos marcadores OK |
| FastAPI | CI: 33 testes aprovados | Não repetido localmente; código não alterado |
| Navegador | Registro anterior no PR, não reproduzido nesta revisão | Sem nova alegação de aceite visual |
| CI novo candidato | Não aplicável | Consultar checks do novo SHA; nunca herdar os oito verdes de e801d89 |

Os logs do job [121422007310](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/40277084855/job/121422007310) foram consultados, confirmando os totais da baseline e os marcadores dos emuladores. Os oito workflows associados ao SHA baseline retornaram completed/success:

| Workflow | Run |
|---|---|
| Guardian | 40277084748 |
| Cryptography | 40277084751 |
| Gmail | 40277084784 |
| HML Auth Contract | 40277084747 |
| Organic | 40277084782 |
| CodeQL | 40277084783 |
| Installers | 40277084795 |
| Firestore Migration | 40277084855 |

Reprodução a partir do commit candidato:

```sh
cd firebase-migration/functions
npm ci --ignore-scripts
npm run build
AURORA_TEST_PYTHON=python3 npm test
node --import tsx --test --test-name-pattern='revocation closes membership first' test/aurora-user-profiles.test.ts
cd ../tests
npm ci --ignore-scripts
npm run test:rules
npm run test:practice
```

Python requer PyYAML e o Firebase CLI requer Java 21+. O harness fixa projeto sintético e recusa hosts de emulador não locais. Senhas/códigos efêmeros de teste não integram o parecer ou evidência versionada.

## Comprovações e autorizações ainda exigidas

| Gate | Evidência precisa | Responsável pela comprovação |
|---|---|---|
| Revisão do candidato | Aprovação humana independente vinculada ao SHA com correção; CI próprio; confronto/reconciliação com main vigente e gates de release | Revisor técnico e responsável pela release |
| Piloto autenticado HML | Autorização nominal de ambiente/escopo/prazo, implantação do SHA autorizado, recibo de release, domínio/URLs apontando ao ambiente correto | Responsável HML |
| Entidade e vínculo | Identificação privada PF/PJ responsável, vínculo da titular e registro profissional aplicável; aceite da titular e nome/e-mail confirmados diretamente | Titular e revisor cadastral |
| Grant | actorUid habilitado; verifiedBy distinto, ativo e com practice.validate; expiresAt futuro; orgId independente; entityRef/professionalRef opacos; verificações e consentimento comprovados | Operador autorizado de infraestrutura e revisor cadastral |
| Primeiro acesso | Titular define senha pelo fluxo oficial, recebe/verifica e-mail, cadastra TOTP e realiza novo login com MFA; testar primeiro fator negado, revogação e recuperação sem bypass | Titular e homologador |
| Proteção real | IAM/Rules efetivos, KMS/AAD, logs minimizados, revisão de acesso, backup READY, restore reconciliado, retenção e responsabilidades de tratamento; pacote AURORA-SEC-002 conforme classificação | Segurança e controlador |
| Dados clínicos | Gates específicos CMEK, falha/recuperação de chave, RoPA/DPA, RIPD quando aplicável, pentest, exercício de incidente e aceite de risco residual | Segurança, controlador e revisor independente |
| Operação real | Incremento que implemente/verifique promoção dos gates REAL; este backend 0.2.0 recusa REAL deliberadamente | Engenharia e aprovador de release |
| Integrações opcionais | Conta do próprio consultório comprovada, consentimentos/escopos, segredos protegidos e homologação do provedor/canal; domínio requer registrante e condições aprovadas | Titular da conta e operador autorizado |

Não enviar senhas, segredos, documentos pessoais ou códigos TOTP ao GitHub. O revisor cadastral não substitui o revisor técnico. READY é estado de cadastro, com loginVerified=false; não comprova autenticação ou consultório ativado.

## Estados e rollback

IMPLEMENTED e TESTED: evidenciados no escopo acima. CI_VERIFIED: comprovado para e801d89; candidato requer seus próprios checks. HML_VERIFIED, PRODUCTION_VERIFIED, AUDITED_INDEPENDENTLY e CERTIFIED: não concedidos por este parecer. Sem aprovação humana independente observada, sem ativação real ou publicação realizada.

Release Cockpit: nenhum gate operacional é promovido por esta revisão. A nova evidência é candidata, não confirmação do runtime instalado. Prioridades restantes: (1) integrar correção somente após revisão/checks; (2) homologar autenticação e proteção no ambiente autorizado; (3) comprovar entidade/consentimento e gates de dados reais.

Rollback do código: revert do commit de correção pelo fluxo existente, sem apagar identidades/auditoria e reconhecendo que isso reintroduz o risco de revogação em indisponibilidade. Não usar revert como substituto de bloqueio de acesso. Interrupção do piloto usa desativação nominal da organização/memberships, suspensão das operações e revogação Auth; preservar estado cifrado e trilha. Falha do Auth exige retomada comprovada. Nenhuma dessas ações foi executada em ambiente real nesta revisão.
