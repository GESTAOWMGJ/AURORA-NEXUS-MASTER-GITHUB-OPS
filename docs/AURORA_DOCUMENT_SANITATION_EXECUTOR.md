# Saneamento documental — executor integrado, candidato à revisão

Data: 20/10/2026. Produto: 1.1.0-beta.2. Rotina: AURORA-REV-SAN-001.
Baseline da main: `0b6471b7fc83752fd29575342bcfd6b5091a251a`.
Política de origem: PR #278, `0204f576b4f02551f584865fdde74fb1dc2d5aa1`.

## Desafio e mudança

A política v1 registrava as regras sem executar solicitações. A inspeção encontrou
a fila `15_FILA_PROCESSAMENTO`, as pendências `11_PENDENCIAS_SANEAMENTO`, a trava
compartilhada `comTravaIngestaoGmailWMGJ_`, Script Properties privadas e o transporte
Gmail do Apps Script. Não encontrou um outbox transacional de cobranças documentais.
O módulo `src/39_AURORA_DOCUMENT_SANITATION.gs` acrescenta estados/recibos à mesma
fila. Não cria banco, dispatcher, trigger, credencial, autorização ou serviço.

O ciclo consolidado de 15 minutos, a auditoria diária e o orquestrador financeiro
chamam a mesma função privada. A identidade SHA-256 usa a tupla JSON
`[orgId, competence, gapType, ownerId]`, sem incluir a rotina chamadora. Assim, a
mesma lacuna reencontrada em outro fluxo reutiliza a linha e o recibo. Os dois
consumidores documentais ignoram explicitamente `TIPO=DOCUMENT_SANITATION`, mesmo
se alguém alterar indevidamente STATUS para PENDENTE.

A execução permanece `LEGACY_MIRRORED`, integrada ao motor pelo registro nativo.
Não é um novo executor Firebase. O watchdog nativo continua produzindo seus achados;
a transferência desses achados para a fonte privada estruturada precisa do
mapeamento existente de cada organização. Não se infere essa transferência por
existir um registro nativo. O pacote não inventa uma ausência documental a partir
de nome de arquivo, falha de acesso, ausência de extração ou silêncio do responsável.

## Fronteira de confiança e configuração privada

A instalação é opt-in, desativada quando a Script Property
`AURORA_DOCUMENT_SANITATION_CONFIG` está ausente ou `enabled` não é true. Não há
setter público nem comando HTTP para alterar autorizações. Somente o operador
provisionador autorizado, no fluxo protegido existente, deve gravar a configuração.
Uma implantação Apps Script corresponde a **uma organização, uma planilha, um
script e uma identidade efetiva**. Os quatro vínculos são conferidos a cada ciclo.
`WMGJ_FIRESTORE_ORG_ID` deve coincidir com a organização explicitamente validada.
O prefixo legado da propriedade não concede autorização nem define um tenant fixo.

Esquema da propriedade (sem valores reais; o fixture executável usa somente dados
sintéticos em `tools/fixtures/sanitation-runtime.cjs`):

| Campo | Verificação |
| --- | --- |
| schemaVersion | 1 |
| enabled / sendEnabled | booleanos; envio exige ambos true |
| orgId / organizationVerified / organizationEvidenceRef | organização validada e evidência privada |
| spreadsheetId / scriptId / executorEmail | identidade efetiva e destinos existentes exatos |
| historyBaseline | complete=true, reviewedAt, reviewedBy, reviewRef |
| owners[ownerId] | id, orgId, active, verified, email único, verificationRef |
| authorization | id, orgId, actor, scope=DOCUMENT_SANITATION, active, revoked=false |
| authorization — alçada | approvalRef, approvedBy, independentReviewRef, mfaVerified=true |
| authorization — limites | validFrom, expiresAt, ownerIds, gapTypes e competences explícitos |

Esses recibos são declarações do provisionamento protegido, não MFA executado pelo
job nem prova criada pelo próprio software. As propriedades e a planilha devem ser
restritas aos operadores daquele tenant; compartilhar edição com remetentes ou
consumidores não confiáveis invalida essa fronteira. O job usa os escopos Gmail já
concedidos ao Apps Script, sem solicitar credenciais novas. Não lê nomes/endereço
em documentos para obter destinatários. Mudança de contato, concessão ou identidade
após reserva bloqueia o efeito; não migra o histórico silenciosamente.

## Fonte de pendências e histórico pré-existente

A aba existente de pendências deve conter `STATUS` e uma coluna adicional,
explicitamente mapeada pelo provisionamento, `SANITATION_JSON`. Não há migração
cega de cabeçalho ou criação de tabela paralela. Um registro elegível contém:

```json
{
  "orgId": "synthetic-org",
  "competence": "2026-10",
  "gapType": "SCHEDULE_VALIDATION_MISSING",
  "ownerId": "schedule-owner",
  "evidenceRef": "finding-1",
  "coverage": "COMPLETE",
  "history": {
    "reviewedAt": "2026-10-20T11:00:00Z",
    "reviewedBy": "reviewer",
    "reviewRef": "review-1",
    "legacyMessageIds": []
  }
}
```

Somente STATUS OPEN/ACKNOWLEDGED e cobertura COMPLETE são elegíveis. O período
vem do achado verificado, sem fallback para o mês corrente. Os tipos aceitos são
DOCUMENT_MISSING, SCHEDULE_VALIDATION_MISSING e SCHEDULE_EXECUTION_UNVERIFIED.
Eles solicitam evidências distintas; nenhum deles declara validação ou execução.
O campo `history` vem da conferência das comunicações anteriores, não da extração
de instruções presentes em documentos. Registros duplicados somam referências na
mesma chave; nenhuma identidade de cliente é exportada para a política genérica.

**Antes da habilitação, importar na configuração/fonte privada todos os IDs das
solicitações anteriores associadas a cada lacuna e competência.** O caso histórico
já enviado pelo operador deve ser vinculado a todas as lacunas/períodos abrangidos
pelo seu conteúdo. O executor relê cada ID, verifica remetente/destinatário, preserva
thread/messageId e registra SENT ou RESPONSE_REVIEW, sem enviar novamente. IDs e
contatos reais não pertencem a este repositório. Histórico inacessível bloqueia.

A leitura pré-envio consulta threads vinculadas, respostas/anexos e mensagens com
marcador estável. Também procura correspondências manuais recentes com o contato
verificado, posteriores à revisão. Conversa nova não vinculada gera
UNLINKED_CORRESPONDENCE_REVIEW, mesmo se potencialmente irrelevante: o operador
precisa vinculá-la ou atualizar a revisão com evidência. Não inferir ausência a
partir de busca vazia, truncamento ou erro. Limites de leitura são bloqueantes.

## Efeito, recibos e recuperação

1. Trava compartilhada do script cobre reserva, conferência, envio e recibo.
2. O job grava e relê o estado na coluna OBSERVACAO da fila existente.
3. Reserva DRAFT_CREATING antes de criar o rascunho; persiste DRAFT_READY com ID.
4. Repete a consulta de histórico, a leitura do achado e a autorização atual.
5. Persiste SEND_STARTED antes de chamar GmailDraft.send(). Revalida rascunho e
   autorização após a reserva. Só o corpo fixo, sem anexos/CC/BCC, é permitido.
6. O retorno fornece GmailMessage: persistem messageId, threadId, horário, alçada,
   hash do destino e eventos. SENT comprova aceitação pelo Gmail, não leitura,
   entrega final, resposta, validação documental ou encerramento da pendência.
7. Falha ou encerramento entre reserva e recibo mantém SEND_STARTED/UNKNOWN.
   A retomada procura o envio e reconcilia o recibo antes de qualquer efeito.

Uma busca negativa, timeout ou lock expirado **nunca** autoriza repetir um envio
incerto. Quando o provedor não oferece prova conclusiva, a pendência continua
UNKNOWN para revisão. Uma reserva de rascunho sem rascunho localizável também fica
pendente: não cria outro por suposição. Rascunho único recuperável pode continuar,
pois seu estado ainda não atravessou a barreira SEND_STARTED. Recibos antigos não
são apagados. Resposta parcial mantém revisão do residual; este incremento não
envia lembretes nem reabre uma solicitação entregue por passagem do prazo.

Cada passagem trata até cinco chaves, com cursor no armazenamento privado de
checkpoints já utilizado. Linhas terminais não impedem alcançar o restante da fila.
Falhas individuais são códigos sanitizados; erros brutos do Gmail e conteúdos
privados não vão ao log geral. Incapacidade de validar o conjunto de achados bloqueia
o lote. O pipeline documental e o financeiro conservam suas etapas próprias.

## Evidências e limites

- Política v1 preservada byte a byte; contrato executor v2 e registro nativo
  distinguem código de instalação.
- Testes determinísticos de autorização, revogação durante o fluxo, concorrência,
  isolamento, três entradas reais, histórico anterior, resposta parcial, contato
  alterado, draft adulterado, falhas de persistência, envio incerto e retomada.
- Fixture de processo filho encerra abruptamente antes/depois do efeito sintético,
  conserva fila/provedor em disco e retoma com a mesma identidade. Isso testa a
  máquina de estados; não comprova o comportamento de locks Google distribuídos.
- A exclusão mútua de instâncias vivas usa a trava existente, testada com duas
  instâncias isoladas do runtime. Edição manual do Gmail/planilha não participa da
  trava; a revalidação reduz a janela, mas não oferece transação distribuída com Gmail.
- Comandos: `node tools/audit-appscript.js` e
  `node --test tools/test-gmail-ingestion.cjs tools/test-gmail-replay.cjs tools/test-gmail-sanitation.cjs`.
  Registro/Release Cockpit: teste `aurora-native-routines.test.ts` com o runner tsx
  já adotado no repositório. Não houve envio real na validação.
- Resultado local em 20/10/2026: 133 testes de ingestão/envio/recuperação e 15
  testes de registro nativo/Release Cockpit aprovados; auditoria de fontes e
  `git diff --check` aprovados. São 48 testes específicos do novo executor.
- Revisão humana independente, CI do SHA final, configuração/mapeamento privado,
  importação do histórico, homologação Gmail, publicação e recibo de operação
  instalada são gates separados. Nenhum foi fabricado pelo teste local.

Referências de API conferidas: [GmailDraft](https://developers.google.com/apps-script/reference/gmail/gmail-draft),
[GmailApp](https://developers.google.com/apps-script/reference/gmail/gmail-app) e
[Lock](https://developers.google.com/apps-script/reference/lock/lock).

## Rollback e aprendizado

Desativar sendEnabled primeiro; preservar fila, histórico e propriedades privadas.
Reverter os hooks e o módulo por commit revertido após revisão, sem remover
rascunhos ou mensagens. Manter guards de TIPO para que versões documentais antigas
não consumam recibos de comunicação. Não marcar UNKNOWN como QUEUED para destravar.

Aprendizado abstrato incorporado ao registro existente: chave por lacuna e
responsável, importação obrigatória de histórico, verificação de correspondências
manuais e reconciliação antes de retentativa. Estado do código:
IMPLEMENTED_PENDING_RUNTIME_VALIDATION. Adoção pelo motor instalado, sincronização
cloud/Xeon, execução contínua e treinamento de pesos continuam sem recibo próprio.
