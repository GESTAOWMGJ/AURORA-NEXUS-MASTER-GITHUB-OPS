# Cadastro profissional e acolhimento intrínseco

O motor existente de perfis aceita, opcionalmente, `onboarding` no comando
`CREATE`. O cadastro continua restrito a administrador atual da organização,
com escopo integral e MFA verificado pelo servidor; a organização precisa estar
ativa e habilitar o motor. Cargo e atribuições descrevem o trabalho e não
concedem acesso: `role`, `allFacilities` e `facilityIds` continuam explícitos,
validados pela política existente, sem permissões arbitrárias.

```json
{
  "jobTitle": "Faturista",
  "duties": ["Conferir contas", "Organizar prazos"],
  "managerUid": "UID-do-gestor-na-mesma-organizacao",
  "welcomeDueHours": 24
}
```

O objeto tem exatamente esses quatro campos. Cargo contém de 2 a 80 caracteres;
cada uma das 1 a 20 atribuições contém de 2 a 160 caracteres. Textos são aparados,
espaços internos normalizados e atribuições ordenadas sem duplicatas. Não são
aceitos controles ou marcação HTML. O UID de gestor segue o limite Firebase de
128 caracteres e não admite separadores de caminho ou controles. O prazo é um
inteiro de 1 a 720 horas. O gestor deve ter membro ativo na mesma organização,
verificado novamente durante a criação; um gestor com acolhimento obrigatório
ainda incompleto não pode ser escolhido. UIDs legados, incluindo o Master,
continuam aceitos sem conversão para a identidade gerenciada `anx_`.

## Identidade e acesso

Os metadados normalizados participam do fingerprint idempotente do perfil.
Alterar cargo, atribuições, gestor ou prazo mantendo `requestId` conflita;
alteração no membro armazenado exige revisão, sem adoção ou sobrescrita.

Quando os metadados existem, a primeira transação cria operação e membro
`PENDING`, `active: false`, `onboardingRequired: true`, `onboardingState: INVITED`.
A conta Firebase é inicialmente desabilitada, sem senha definida pelo motor;
seus claims incluem `auroraOnboardingRequired: true` junto dos vínculos de
organização, versão e operação. A conclusão do provisionamento deixa o perfil
`READY` e ativo, mas conserva `INVITED`. Esse estado exige consumo do convite no
fluxo separado e bloqueio nos contratos de sessão, acesso e regras. Não representa
por si só liberação para entrar no Aurora.

O motor de perfis não gera, armazena, recupera ou entrega a credencial de convite.
O módulo separado de convite autentica o principal e realiza a transição
`INVITED → COMPLETE`. O replay de `CREATE` aceita e conserva `COMPLETE` e não
recria convites. A revogação conserva os metadados e a evidência do acolhimento,
fecha o perfil e marca seu acolhimento `REVOKED`. Perfis sem `onboarding` mantêm
o contrato anterior, sem novo claim obrigatório ou tarefa adicional.

## SLA e transações

A ativação final cria, atomicamente com `READY` e a auditoria de provisionamento,
um `actionItems/welcome-{hash-da-operacao}` e o `managerInputs` correspondente.
Usa o contrato existente: alvo `managementInput`, motivo `MANUAL_REVIEW`, risco
`MEDIUM`, estado inicial `OPEN`, revisão 1, competência do primeiro pedido,
sensibilidade `INTERNAL` e texto genérico. `subjectUid`, `assignedToUid` e
`profileOperationId` vinculam profissional, gestor e operação na organização.
Esses vínculos não conferem autorização para atuar na tarefa.

O prazo é `createdAtUtc` da primeira operação mais `welcomeDueHours`, inclusive
quando a criação é retomada depois de uma indisponibilidade. Replay não prolonga
o prazo nem zera reconhecimento ou resolução da tarefa. Par inconsistente,
vínculo adulterado ou tarefa ausente para operação já `READY` bloqueiam para
revisão. Leituras precedem todas as escritas em cada transação. Mudança do gestor,
administrador, organização ou escopo durante chamadas Firebase impede ativação
do membro e não publica tarefa ou auditoria de conclusão.

A resolução segue o ledger existente de ações, com revisão esperada, evidência
verificável e auditoria. O cadastro não resolve automaticamente o acolhimento,
não elimina evidências e não implementa exclusão administrativa destrutiva.

## Evidência e limites

O painel Master emite uma credencial aleatória de cadastro de 256 bits,
exibida uma vez e válida por 24 horas. Só o digest criptográfico vinculado a
organização/UID/operação é persistido. Reemissão invalida a anterior. A pessoa
define sua senha pessoal pelo fluxo Firebase, confirma o e-mail e cadastra MFA;
então resgata a credencial para liberar a sessão Aurora. O Master não conhece
a senha pessoal. Reutilização e resgate por outro UID/organização são recusados.
Saída da sessão limpa a credencial e respostas tardias não a repõem na tela.
O robô pertence ao registro nativo do motor, com execução governada por vínculo
atual e MFA, como as demais rotinas do organismo Aurora Nexus.

`test/aurora-user-profiles.test.ts` usa identidades sintéticas, Auth stub e loja
transacional com rollback e assertiva de leituras antes de escritas. Abrange
compatibilidade legada, esquema fechado, ausência de senha, permissões explícitas,
gestor vivo na mesma organização, interrupção e retomada, conflito, estado
obrigatório, prazo estável, replay após conclusão, colisão da tarefa e revogação.
Passar esses testes comprova o contrato puro; não comprova instalação, deploy,
configuração Auth/MFA, onboarding humano ou homologação de uma identidade real.
