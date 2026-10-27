# Sincronizador do web app 0.1.3 — Personalité

Incremento de 26/10/2026 no PR #325, reconciliado com main `5a89a766111a2942977198fbdacccbb2c0e8432f`.
Reutiliza o motor de perfis, Auth, Firestore, registros idempotentes e autorização
de consultório do Personalité 0.1.2. A versão do sincronizador é 0.1.3;
o schema de identidades e os registros existentes não sofrem migração.

O administrador usa o cadastro existente para iniciar um negócio independente e
criar sua titular. A titular cadastra operadores de recepção, financeiro e editorial
no próprio negócio. A interface permite **Conferir cadastro**: consulta somente
leitura, incluindo após uma resposta de criação interrompida. Não executa novo POST
automaticamente. Retomar usa a mesma referência validada e o mesmo UID determinístico.

`GET /api/user-profiles?practiceGrantId=<referência>` retorna
`aurora.webapp-sync.v1`, `engineVersion: 0.1.3`, organização, versão do perfil,
data da consulta e um estado explícito:

| Estado | Resultado |
| --- | --- |
| NOT_STARTED | Ainda não há organização vinculada à autorização. |
| IN_PROGRESS | Organização reservada; repetir com a mesma referência retoma. |
| READY | Organização ativa e membership da titular coerente com a operação. |
| REQUIRES_REVIEW | Organização existente sem membership coerente e ativo. |

A leitura revalida organização operadora, administrador com MFA, revisor
independente, autorização vigente e binding transacional. Nenhum dado de outro
negócio ou credencial é copiado. A ausência de um cadastro não impede consultar os
demais. `READY` não comprova primeiro login, entrega de e-mail ou TOTP real;
`loginVerified` permanece falso nesta resposta. Não há habilitação clínica.

O gateway Sites recebe correções separadas: rota GET de leitura da release ativa,
nonce preservado somente nessa rota e caminho de segurança da conta encaminhado
ao AuthGate existente. Bearer e sessão mantêm fronteiras separadas; criação de
perfis conserva CSRF. Publicação do gateway não implanta Functions automaticamente.

Testes determinísticos cobrem leitura antes/durante/depois, retomada sem segunda
identidade, ausência de escrita/provider calls no readback, isolamento, revogação,
expiração, MFA, membership inconsistente e contrato HTTP. Executar o CI do SHA
candidato e a integração Auth/Firestore já presentes no workflow; testes antigos
não são prova deste incremento.

Ativação real do Personalité depende da autorização privada da entidade e titular,
nome/e-mail confirmados, operador/revisor habilitados, implantação protegida e
primeiro acesso. Nenhum desses fatos é inferido da publicação do código.
Rollback: reverter este incremento preservando grants, identidades, memberships,
documentos e histórico. Não criar agendamento ou executor paralelo.
