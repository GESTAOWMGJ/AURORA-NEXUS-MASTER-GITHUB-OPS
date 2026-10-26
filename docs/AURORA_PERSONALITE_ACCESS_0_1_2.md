# Personalité 0.1.2 — organização e acesso isolados

Candidato de 26/10/2026. Continuação do PR #325 (0.1.1, `5524285c061843709e07b161b9427d3b528e08a6`), reconciliada com main `3440cf6`. A versão instalada do produto não é alterada. Sem implantação, tenant real, convite externo ou paciente.

## Fluxo implementado

O `/api/bootstrap` existente lê o painel; não provisiona organizações. O novo cadastro reutiliza `/api/user-profiles`, sessão Firebase, CSRF, transações, apiIdempotency, auditEvents e o motor `AURORA-USER-PROFILES-001`.

1. Um revisor independente valida privadamente entidade responsável, titular, vínculo profissional e consentimento. Um operador com IAM apropriado registra a autorização server-only descrita abaixo. Não existe botão que autovalide estes fatos.
2. Administrador autenticado com MFA informa somente a referência da validação no formulário de equipe. `CREATE_PRACTICE` rejeita campos adicionais, valida operador e revisor atuais, expiração e organização-alvo.
3. Cria organização independente inicialmente inativa, com referências opacas à entidade/profissional. Não copia membros, fontes, dados, permissões, configuração de ingestão ou integrações. `wmgj` e a organização do operador são recusados como destino.
4. O motor existente provisiona UID determinístico com criação desabilitada, sem senha e sem e-mail verificado, emite claims vinculados à operação e confirma o readback. Nunca busca/adota conta por e-mail. Conflito exige revisão; não transfere conta existente.
5. Só ativa a organização depois do readback da identidade/membership e revalidação transacional da autorização. Repetição converge; falha mantém organização fechada. Alteração ou revogação da autorização interrompe a operação.
6. A titular abre `https://auroranexus.com.br/portal`, solicita o link de definição de senha no fluxo de recuperação existente, define a própria senha, confirma o e-mail e cadastra TOTP. Novo login deve apresentar segundo fator. Nenhuma senha ou link é retornado pela API de provisionamento.
7. O portal entrega uma tela Personalité própria. A titular cadastra recepção, financeiro ou editorial e revoga esses acessos. O backend revalida membership em cada chamada. Revogação fecha membership antes de desabilitar Auth e revogar refresh tokens; falha do provedor não reabre acesso.

## Papéis e limites efetivos

| Papel | Disponível em 0.1.2 | Não disponível |
| --- | --- | --- |
| `practice_owner` | Tela do consultório, cadastro/listagem/revogação da equipe, segurança da própria conta | Criar outro titular, conceder org_admin ou privilégio clínico |
| `practice_reception` | Entrada individual isolada e segurança da própria conta | Agenda ainda não implementada; notas clínicas, financeiro e dados editoriais |
| `practice_finance` | Entrada individual isolada e segurança da própria conta | Lançamentos e conciliação específicos ainda não implementados; conteúdo clínico |
| `practice_editor` | Entrada individual isolada e segurança da própria conta | Editor/adaptadores ainda não implementados; cadastro de pacientes, agenda e conteúdo clínico |

A matriz é de acesso, não prova de módulos assistenciais ou financeiros prontos. Permissions genéricas são descartadas no backend para os quatro papéis e negadas nas Rules. A leitura de clinicalEvidence é bloqueada para qualquer papel em organização Personalité, inclusive administrador genérico. Organização Personalité com papel genérico é recusada pelo resolvedor de sessão. O painel genérico WMGJ não é carregado. Nenhum dado clínico deve ser introduzido.

## Registro privado de validação

Caminho existente: `organizations/{operatorOrg}/runtimeCheckpoints/practice-grant-{grantId}`. Escrita/leitura por clientes são negadas pelas Rules. Somente operador de infraestrutura autorizado pode registrar a revisão; esta versão não fornece API de autoaprovação. Registro é configuração privada, nunca fixture real no GitHub/Notion público.

| Campo | Contrato |
| --- | --- |
| `grantId` | 16–80 caracteres ASCII alfanuméricos, hífen ou underscore; chave idempotente |
| `status` | `APPROVED`; qualquer outro estado bloqueia novas tentativas |
| `actorUid` | UID do administrador operador que executará o cadastro |
| `verifiedBy` | UID diferente do operador; membro ativo da organização operadora, escopo global e permissão explícita `practice.validate` |
| `expiresAt` | Timestamp em milissegundos, futuro |
| `orgId` | Slug próprio; não pode ser WMGJ, origem, reservado ou organização já existente |
| `entityRef`, `professionalRef` | Referências privadas opacas de 16–128 caracteres; não CPF/CNPJ/CRP em texto público |
| `entityVerified`, `professionalVerified`, `ownerConsent` | `true` somente após verificação humana documentada |
| `email`, `displayName` | Endereço confirmado pela titular como seu e nome cadastral; e-mail ainda será confirmado pelo Firebase |

A integridade do registro é vinculada por hash; hash não prova identidade nem substitui a revisão. Os documentos comprobatórios permanecem no ambiente privado autorizado. O revisor da entidade não substitui o revisor técnico do commit.

## Teste reproduzível e estado da evidência

- Compilação/typecheck e suíte Functions: `npm run build` e `AURORA_TEST_PYTHON=python3 npm test` em functions (Python com PyYAML).
- Regras: `npm run test:rules` em tests, Node 22+ e Java 21+.
- Integração real com Firestore/Auth emulados: `npm run test:practice` em tests, após build. O harness recusa hosts não locais e fixa projeto sintético. Exercita organização, UID, transações, idempotência, recuperação/definição de senha, confirmação de e-mail, bloqueio de acesso só com primeiro fator e revogação. Credenciais efêmeras são exclusivamente sintéticas e não persistidas no repositório.
- Testes de handlers executam sessão, CSRF e renderização do portal com adaptadores sintéticos; testes do cliente existente cobrem recuperação e MFA. Um emulador não comprova entrega de e-mail externo nem cerimônia TOTP do provedor real.
- CI existente inclui agora a integração de provisionamento em emuladores. Consultar o SHA final do PR, não reutilizar os seis checks de 0.1.1.
- HML real, TOTP real, envio/recebimento de e-mail externo, revisão humana independente e produção: PENDENTES. Os flags nativos tenantCreated/credentialsCreated continuam falsos porque não houve ativação de cliente real.

Resultado local: **1.256 testes Functions aprovados**, **30 testes Security Rules aprovados** e `PERSONALITE_EMULATOR_OK` no harness de integração Auth/Firestore. Node local 24.22.1; CI usa Node 22. Java 21 foi usado nos emuladores.

## Dados e autorizações indispensáveis para ativar o piloto

1. Entidade responsável efetiva (PF/PJ conforme contratação), identificação e documentos em canal privado, vínculo da titular, registro profissional aplicável e evidência de consentimento. Não pressupor que empresa JFN ou WMGJ responde pelo consultório de Psicologia.
2. Nome e e-mail de acesso confirmados diretamente pela titular; slug escolhido; referências privadas às verificações. Conta Auth preexistente com o mesmo e-mail exige resolver a titularidade em procedimento separado, sem reassociar automaticamente.
3. UID do operador e revisor independente com atribuição `practice.validate`; autorização nominal de piloto HML e prazo. A pré-validação de continuidade não é essa aprovação técnica nem uma concessão produtiva.
4. Revisão técnica humana no SHA exato, CI verde, autorização e execução de implantação HML. Confirmar domínio canônico ligado ao ambiente autorizado, Firebase Auth com e-mail/senha e TOTP habilitados, URLs de ação de e-mail, entregabilidade e teste de primeiro acesso/recuperação pela titular. Nenhum segredo deve ser enviado no chat.
5. Antes de dados pessoais reais: finalidade, responsabilidade de tratamento, contrato/retencão, proteção de campos, backup/restore e autorização de acesso adequados aos gates existentes. Nenhum prontuário é necessário para testar o cadastro.

## Recuperação, revogação e rollback

Redefinição de senha usa SDK Firebase e preserva MFA. Troca de autenticador reutiliza segurança de conta com reautenticação, mantendo fator substituto confirmado. Perda de todos os fatores continua dependendo de verificação administrativa de identidade: não há bypass de MFA neste incremento.

Para interromper o piloto: desativar a organização e memberships no servidor autorizado, desabilitar usuários gerenciados e revogar tokens; preservar eventos/evidências. Revogar autorização interrompe provisionamento, mas não equivale a desativar organização já concluída. Só depois considerar revert deste incremento; revert de código não desfaz identidades nem dados. Não apagar fontes ou reverter alterações concorrentes.

## Integração das habilidades solicitadas

Cuidado Clínico Integral JFN orienta a separação assistencial/administrativa e revisão humana; não confere competência médica à Psicologia. Marketing Institucional JFN e AURORA Marketing orientam comunicação fiel ao estado comprovado e sem conteúdo de pacientes. Notion mantém referências de planejamento, sem tornar memória comercial autoridade de provisionamento. A matriz acima explicita capacidades e pendências, sem percentuais inventados. PixVerse permanece ferramenta de produção editorial sob briefing e autorização próprios; nenhum vídeo, gasto, publicação ou transmissão de dados foi iniciado por este incremento.
