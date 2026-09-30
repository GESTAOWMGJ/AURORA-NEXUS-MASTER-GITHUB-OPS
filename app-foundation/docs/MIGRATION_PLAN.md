# Plano de migração — Google Sheets para Firestore

**Escopo:** base-mestre administrativa WMGJ/JFN

**Modo:** migração gradual, reversível e validada por pessoa

**Restrição absoluta:** MVP não clínico e sem PHI/dados pessoais de saúde

## 1. Objetivo

Migrar progressivamente a base administrativa atual do Google Sheets para o Firestore sem interromper a operação, sem duplicar registros e sem transformar automaticamente conteúdo de planilha em verdade operacional.

O fluxo obrigatório é:

```text
Sheets somente leitura
  → snapshot e manifesto
  → staging sanitizado
  → validação humana
  → commit idempotente no Firestore
  → reconciliação
  → dashboard/relatório agregado
```

## 2. Não objetivos

Esta migração não abrange:

- prontuário, anamnese, evolução, prescrição ou laudo;
- cadastro de paciente, CPF, CNS ou data de nascimento;
- AIH, APAC, glosa, OPME ou produção em granularidade identificável;
- OCR de documentos clínicos;
- integração automática de qualquer aba não inventariada;
- desligamento imediato do Sheets;
- substituição da validação humana por classificação de IA.

Se uma linha ou coluna puder identificar paciente ou revelar cuidado em saúde, o lote deve ser bloqueado e devolvido à governança, não sanitizado silenciosamente.

## 3. Papéis e segregação

| Papel | Responsabilidade | Vedação |
|---|---|---|
| `MIGRATION_OPERATOR` | extrair snapshot e iniciar lote | não aprova o próprio lote |
| `VALIDATOR` | revisar, corrigir ou rejeitar staging | não altera a origem |
| `AUDITOR` | conferir contagens, hashes e exceções | não executa purge |
| `TENANT_ADMIN` | conceder escopo e aprovar cutover | não recebe PHI por esse fluxo |
| `DEPLOYER` | implantar regras, índices e funções | não valida conteúdo operacional |

Uma mesma pessoa pode acumular funções no laboratório de desenvolvimento, mas o aceite de produção precisa registrar quem extraiu, quem validou e quem autorizou o corte.

## 4. Elegibilidade de dados

### 4.1 Permitido no MVP

- identificador opaco de empresa e unidade;
- competência mensal;
- categoria documental sanitizada;
- contagens e valores empresariais não ligados a pessoa;
- status de fluxo, pendência e revisão;
- referência contratual não pessoal;
- indicador de presença de valor/competência/contrato;
- métricas consolidadas de produção, qualidade e NPS;
- códigos de motivo enumerados;
- hashes e metadados técnicos.

### 4.2 Bloqueio automático ou manual

- cabeçalhos como `paciente`, `nome`, `cpf`, `cns`, `nascimento`, `diagnostico`, `cid`, `prescricao`, `prontuario`, `leito`;
- texto livre proveniente de observação clínica;
- arquivos cujo nome contenha nome ou documento pessoal;
- células com padrões de CPF/CNS ou datas ligadas a pessoa;
- qualquer descrição que permita reidentificação por combinação de campos.

O detector é uma barreira adicional, não uma autorização para processar conteúdo sensível. Falso negativo continua sendo incidente de segurança.

## 5. Origem e chave de idempotência

O Sheets permanece a fonte de origem até F4. A extração usa permissão somente leitura.

Cada lote deve registrar:

```json
{
  "batchId": "uuid",
  "tenantId": "tenant-opaco",
  "spreadsheetRefHash": "hmac",
  "worksheetGidHash": "hmac",
  "sourceRevision": "drive-version-ou-timestamp-controlado",
  "schemaVersion": 1,
  "rowCount": 0,
  "acceptedColumnCount": 0,
  "sourceSnapshotSha256": "hex",
  "createdAt": "serverTimestamp",
  "createdBy": "uid-ou-servico"
}
```

Não persistir URL da planilha, título da aba ou e-mail do proprietário em documentos de domínio. Referências externas usam HMAC com segredo no Secret Manager.

Chave determinística de candidato:

```text
recordKey = HMAC-SHA256(
  migrationSecret,
  tenantId | spreadsheetRefHash | worksheetGidHash | businessKey | schemaVersion
)
```

`businessKey` precisa ser administrativa, estável e previamente aprovada. Número físico da linha não é chave confiável porque muda com inserções e ordenações.

## 6. Modelo de staging

Collection planejada:

```text
tenants/{tenantId}/staging_records/{recordKey}
```

Contrato mínimo:

```json
{
  "tenantId": "tenant-opaco",
  "siteId": null,
  "batchId": "uuid",
  "schemaVersion": 1,
  "dataClass": "INTERNAL",
  "sourceRowHash": "hex",
  "recordKey": "hmac",
  "category": "financeiro|producao_agregada|contrato|qualidade|nps|outro",
  "competence": "YYYY-MM",
  "normalized": {},
  "status": "STAGED",
  "revision": 1,
  "createdAt": "serverTimestamp",
  "createdBy": {
    "kind": "SERVICE",
    "id": "sheets-staging-importer"
  },
  "integrity": {
    "payloadSha256": "hex",
    "schemaVersion": 1
  }
}
```

`normalized` só pode conter campos presentes em schema positivo versionado. Campos extras causam rejeição. Texto livre, fórmulas, comentários, notas de célula e links não são copiados automaticamente.

Estados:

```text
STAGED
  → SCHEMA_VALIDATED
  → PENDING_HUMAN
  → APPROVED | REJECTED | CORRECTION_REQUIRED
  → COMMITTED
```

Transições usam `expectedRevision`. Correção cria nova revisão e decisão; não substitui silenciosamente o snapshot original.

## 7. Validação humana

Cada candidato cria ou referencia `validation_tasks/{taskId}` com:

- `batchId` e `stagingRecordId`;
- categoria e competência;
- prioridade e prazo;
- responsável;
- estado e revisão;
- somente metadados não clínicos.

A decisão planejada em `validation_decisions/{decisionId}` contém:

```json
{
  "decision": "APPROVED|REJECTED|CORRECTED",
  "reasonCodes": ["SCHEMA_OK"],
  "validatorUid": "uid",
  "inputHash": "sha256",
  "approvedPayloadHash": "sha256-ou-null",
  "decidedAt": "serverTimestamp"
}
```

Observação livre deve ser evitada. Motivos são códigos enumerados. O classificador de IA pode sugerir categoria, mas a decisão humana permanece obrigatória para 100% dos registros do primeiro corte.

## 8. Destino Firestore

O commit F3 deve promover somente registros `APPROVED` ou `CORRECTED` com decisão válida.

Destinos do MVP:

- `sources`: metadado sanitizado e origem por hash;
- `action_requests`: comandos administrativos autorizados;
- `processing_runs`: execução técnica determinística;
- `dashboard_snapshots`: projeção agregada posterior;
- `reports`: metadado de relatório não clínico, quando o writer existir;
- `audit_events` e `aggregate_heads`: trilha de toda promoção e correção.

O commit deve ocorrer em transação com:

1. releitura do candidato e sua revisão;
2. releitura da decisão humana;
3. confirmação de hash;
4. verificação de idempotência;
5. criação do documento final;
6. criação de `migration_commits`;
7. evento de auditoria;
8. atualização do status do candidato para `COMMITTED`.

Um rerun do lote deve retornar o commit anterior, nunca criar um segundo documento.

## 9. F0 — governança e fundação

### Objetivo

Impedir que decisões irreversíveis ou dados proibidos entrem no ambiente antes do inventário.

### Atividades

- inventariar planilhas, abas, proprietários, volumes, fórmulas e integrações;
- classificar cada coluna como permitida, derivada, descartada ou proibida;
- selecionar apenas uma aba piloto não clínica;
- registrar decisão de região `southamerica-east1`;
- decidir Google-managed encryption ou CMEK antes da criação do banco;
- separar projetos dev, homologação e produção;
- definir contas de serviço e Secret Manager;
- revisar Rules, índices, App Check, MFA e IAM;
- definir retenção, Audit Logs, PITR, backups, RPO e RTO;
- manter comandos operacionais limitados a `reasonCode` enumerado, sem justificativa livre;
- estabelecer procedimento de incidente caso PHI seja detectado.

### Entregáveis

- inventário assinado;
- dicionário de dados v1;
- matriz de elegibilidade;
- ADR de região e criptografia;
- matriz RBAC;
- checklist de segurança e rollback.

### Critérios de aceite F0

- [ ] Nenhuma coluna de paciente ou dado clínico está no piloto.
- [ ] Região e CMEK foram decididos antes do provisionamento.
- [ ] Conta de extração do Sheets tem somente leitura.
- [ ] Secrets não existem em código, planilha ou Firestore.
- [ ] Rules continuam `deny by default` para staging ainda não implementado.
- [ ] Testes atuais de contrato, regras e build passam.
- [ ] Canary sintético de CPF, CNS, nome e diagnóstico é bloqueado.
- [ ] Responsáveis por extração, validação, auditoria e corte foram nomeados.

## 10. F1 — extração somente leitura e snapshot

### Objetivo

Produzir uma cópia reproduzível da aba piloto sem alterar a origem e sem escrever em collections finais.

### Atividades

- obter metadados da versão da planilha;
- ler apenas o range aprovado;
- remover fórmulas, notas, links e colunas não permitidas;
- normalizar datas, moeda, booleanos e competência;
- validar schema positivo;
- gerar `sourceSnapshotSha256` e hash por linha;
- criar manifesto de lote;
- executar detector de campos/padrões proibidos;
- armazenar snapshot de staging em ambiente restrito de homologação.

### Critérios de aceite F1

- [ ] A planilha não sofreu nenhuma escrita ou alteração de permissão.
- [ ] Contagem extraída coincide com o range aprovado.
- [ ] Hash do mesmo snapshot é idêntico em duas execuções.
- [ ] Repetição do lote não duplica candidatos.
- [ ] Toda coluna tem regra de transformação documentada.
- [ ] Zero campo extra sobrevive ao schema estrito.
- [ ] Zero canary ou padrão proibido aparece no staging, logs ou nomes de arquivo.
- [ ] Divergências são registradas como exceção, não corrigidas silenciosamente.

## 11. F2 — staging persistente e validação humana

### Objetivo

Tornar cada candidato rastreável e submetê-lo à validação antes de qualquer promoção.

### Atividades

- implementar Rules, índices e contratos para `migration_batches`, `staging_records` e `validation_decisions`;
- gravar candidatos pelo backend com App Check e IAM mínimo;
- gerar uma tarefa por candidato ou grupo homogêneo aprovado pela governança;
- exigir `expectedRevision` para claim e decisão;
- registrar aprovação, rejeição ou correção append-only;
- exigir MFA para fechamento da revisão;
- impedir autovalidação do lote em produção quando os papéis estiverem segregados;
- gerar painel de pendências sem conteúdo sensível.

### Critérios de aceite F2

- [ ] Cliente não cria, altera ou exclui staging ou decisão diretamente.
- [ ] Cada candidato está ligado a um lote e a um hash de origem.
- [ ] 100% dos candidatos têm estado de validação explícito.
- [ ] Nenhum candidato chega a `APPROVED` sem `validatorUid`, horário e decisão.
- [ ] Conflito de duas decisões concorrentes permite apenas uma revisão vencedora.
- [ ] Correção preserva o candidato e a decisão anteriores.
- [ ] Ação privilegiada sem MFA é rejeitada.
- [ ] Auditoria registra toda claim, decisão e correção sem payload.

## 12. F3 — commit controlado e dupla operação

### Objetivo

Promover registros aprovados ao Firestore e comparar o resultado com o Sheets sem trocar ainda a fonte oficial.

### Atividades

- implementar comando de commit idempotente;
- promover somente decisão aprovada e hash íntegro;
- executar lote canário pequeno em homologação;
- repetir o mesmo lote para provar idempotência;
- executar piloto em produção com janela e responsável definidos;
- manter Sheets como fonte oficial temporária;
- reconciliar por competência, categoria, contagem e valor agregado;
- classificar divergências em transformação, origem, duplicidade ou operação;
- emitir relatório de reconciliação e decisão go/no-go.

### Critérios de aceite F3

- [ ] Zero registro rejeitado ou pendente foi promovido.
- [ ] Mesmo lote executado vinte vezes produz um único commit por candidato.
- [ ] Mesma chave com payload diferente é rejeitada.
- [ ] Contagem de aprovados coincide com a de commits.
- [ ] Totais agregados reconciliam dentro da tolerância formalmente aprovada.
- [ ] Toda diferença possui responsável, causa e resolução.
- [ ] Nenhum usuário de outro tenant acessa o lote ou destino.
- [ ] Logs contêm somente códigos e IDs opacos.
- [ ] Rollback em homologação restaura o estado anterior sem apagar a trilha.

## 13. F4 — corte, estabilização e melhoria contínua

### Objetivo

Transformar o Firestore na fonte operacional para o escopo não clínico aprovado, mantendo reversibilidade e governança.

### Atividades

- congelar escrita humana nas abas migradas;
- manter Sheets como arquivo/read model durante a janela de rollback;
- ativar integrações novas somente contra os endpoints autorizados;
- habilitar Data Access Audit Logs e retenção aprovada;
- habilitar PITR e backups;
- executar e documentar restore em banco novo;
- monitorar falhas, duplicidade, backlog, latência e decisões pendentes;
- revisar acessos e associações expiradas;
- fechar uma competência completa no novo fluxo;
- registrar itens de melhoria em backlog versionado;
- manter bloqueada qualquer expansão clínica.

### Critérios de aceite F4

- [ ] Aprovação formal de cutover e plano de retorno registrados.
- [ ] Uma competência ou ciclo operacional completo foi reconciliado.
- [ ] Não há divergência crítica aberta.
- [ ] PITR e backup estão ativos e um restore foi validado por hash.
- [ ] Data Access Audit Logs chegam ao destino protegido.
- [ ] Cadeias de auditoria não têm lacunas.
- [ ] Revisão de acesso não encontra membro indevido ou expirado.
- [ ] Dashboards exibem apenas agregados não clínicos.
- [ ] Sheets migrado está somente leitura e possui data de encerramento definida.
- [ ] Procedimento de rollback foi testado e ainda está dentro da janela aprovada.

## 14. Reconciliação

Cada lote precisa produzir uma matriz:

| Controle | Sheets | Staging | Aprovado | Firestore | Diferença |
|---|---:|---:|---:|---:|---:|
| linhas válidas |  |  |  |  |  |
| rejeições de schema |  |  |  |  |  |
| rejeições humanas |  |  |  |  |  |
| duplicidades |  |  |  |  |  |
| total financeiro agregado |  |  |  |  |  |
| registros sem unidade |  |  |  |  |  |

Tolerância nunca deve ser implícita. Contagens e duplicidades exigem igualdade exata. Tolerância monetária, se necessária por arredondamento, deve estar versionada no dicionário de dados e aprovada antes da execução.

## 15. Rollback

Rollback não significa apagar auditoria.

Durante F1–F3:

- Sheets permanece a fonte oficial;
- commits recebem `batchId` e `migrationCommitId`;
- o sistema pode desativar a projeção de um lote por evento compensatório;
- documentos append-only permanecem preservados;
- dashboards são regenerados excluindo o lote revertido;
- correções geram nova decisão e novo commit.

Depois de F4, o retorno ao Sheets depende de exportação consistente do Firestore, manifesto de hashes e aprovação do responsável pelo corte. Não se executa cópia inversa ad hoc.

## 16. Condições de parada imediata

Interromper o lote, bloquear promoção e abrir incidente quando ocorrer:

- detecção ou suspeita de PHI/dado de saúde;
- coluna não inventariada;
- quebra de hash ou contagem inexplicada;
- acesso cruzado entre tenants;
- escrita direta do cliente em collection crítica;
- segredo exposto em código, log ou planilha;
- ausência de decisão humana;
- duplicação após repetição idempotente;
- região ou CMEK incompatível com a decisão de governança;
- falha de backup/restore no gate de produção.

## 17. Evidências mínimas por fase

O pacote de auditoria deve conter:

- versão do código e dos schemas;
- manifesto do lote e hashes;
- resultado do detector de campos proibidos;
- contagens por etapa;
- decisões humanas;
- eventos e verificação da cadeia de hash;
- resultado dos testes de Rules/RBAC/idempotência;
- relatório de reconciliação;
- aprovação go/no-go;
- evidência de backup e restore no corte.

Nenhum pacote deve conter o conteúdo integral da planilha ou outro dado fora do escopo aprovado.

## 18. Definição de concluído

A migração do MVP só está concluída quando:

1. o escopo continua comprovadamente não clínico;
2. todos os registros finais têm origem, lote, decisão e hash;
3. reruns são idempotentes;
4. a reconciliação fecha sem divergência crítica;
5. isolamento multiempresa e RBAC foram testados;
6. auditoria, PITR, backup e restore foram verificados;
7. Sheets está somente leitura para o escopo cortado;
8. rollback, responsáveis e melhoria contínua estão documentados.
