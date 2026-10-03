# AURORA NEXUS — Firebase Native Document Intelligence

Status: implementação candidata em PR draft. Não constitui deploy, instalação cliente ou homologação de integração proprietária MV/TASY.

## 1. Decisão arquitetural

A origem documental é camada de aquisição e proveniência. O Firebase é a memória operacional executável.

```text
MV / TASY / ERP / Drive / Gmail
        ↓
captura autorizada
        ↓
extração / contrato estruturado
        ↓
sanitização + hash + versão
        ↓
organizations/{orgId}/sourceDocuments/{documentId}
        ↓
dashboardSnapshots/current
        ↓
Aurora Native Intelligence
        ↓
actionItems / auditFindings
        ↓
resolução humana comprovada
        ↓
AURORA-ORG-001
```

A inferência nativa não relê a origem. O endpoint Native Insight bloqueia sem `dashboardSnapshots/current` ou quando o snapshot não declara `nativeDataPlane.storage=FIRESTORE` e `sourceAccessDuringInference=false`.

## 2. Modos de entrada

### 2.1 DRIVE_FOLDER

Usado para pastas explicitamente autorizadas, inclusive pastas alimentadas por exportações de MV, TASY ou outro ERP.

Cada fonte possui:
- `sourceId`;
- `system`: DRIVE, MV, TASY ou ERP;
- `folderId`;
- `slaMinutes`;
- estado ativo;
- diagnóstico de acessibilidade.

Uma fonte indisponível é isolada e registrada; não interrompe as demais.

### 2.2 AURORA_INTEGRATION_API

Endpoint: `POST /api/integration/documents`.

Autenticação: chave Aurora com escopo `documents.ingest`.

Contrato fechado, sem texto livre. Campos aceitos:
- sistema de origem;
- ID técnico documental;
- versão da origem;
- timestamp;
- tipo documental;
- competência;
- valor em centavos e/ou contagem quando aplicável;
- workflow;
- SLA;
- fragilidade;
- número de campos ausentes;
- `nativeReady`;
- `sourceIndependent`.

O ID externo não é persistido em claro; ele participa apenas da derivação de hash/ID técnico. Campos clínicos, narrativa e extensões arbitrárias são rejeitados.

## 3. Snapshot canônico

O snapshot documental persiste apenas fatos operacionais sanitizados. Campos principais:

- `canonicalSnapshotVersion=1`;
- `canonicalSnapshotHash`;
- `originSystem`;
- `originConnector`;
- `workflowState`;
- `documentFragility`;
- `missingFieldsCount`;
- `slaDueAt`;
- `nativeReady`;
- `sourceIndependent`;
- `externalFetchRequired`;
- `externalAiUsed`;
- categoria/competência;
- valor em centavos/contagem quando aplicável.

`nativeReady=true` exige fatos canônicos suficientes. Campo ausente nunca é convertido silenciosamente em zero.

`sourceIndependent=true` significa que a operação analítica pode continuar com o Firebase. Não autoriza apagar, mover ou invalidar o documento original.

A projeção agregada que consome esses fatos usa `schemaVersion: 3`. Os blocos `documentIntelligence`, `nativeDataPlane` e `organicLoop` são obrigatórios no contrato `dashboard-snapshot.v3.schema.json`; leituras legadas v2 continuam aceitas pelo contrato de leitura versionado, sem interpretar v2 como snapshot nativo.

## 4. Política de IA externa

A classificação documental é native-first.

1. Regras determinísticas tentam classificar e extrair os fatos esperados.
2. Se o documento for resolvido nativamente, nenhuma chamada externa é feita.
3. `AURORA_EXTERNAL_AI_FALLBACK_ENABLED` é falso por padrão.
4. Somente documento não resolvido pelo motor nativo pode alcançar fallback externo, e somente quando habilitado.
5. O snapshot registra `externalAiUsed` para permitir reduzir progressivamente chamadas repetitivas.

A inteligência nativa sobre snapshots Firebase nunca usa Gemini/OpenAI.

## 5. Fragilidade, SLA e fluxo

O motor calcula continuamente:

- documentos nativos;
- documentos independentes da origem;
- documentos ainda dependentes de releitura;
- extração degradada;
- baixa confiança;
- campos canônicos ausentes;
- SLA documental vencido;
- documentos pendentes no fluxo;
- uso residual de IA externa;
- distribuição por origem MV/TASY/ERP.

O watchdog Firebase roda em ciclo de 15 minutos e gera, de forma idempotente:

- `actionItems`;
- `auditFindings`.

Códigos:
- `DOCUMENT_FRAGILITY`;
- `DOCUMENT_SLA_OVERDUE`;
- `FLOW_BOTTLENECK`.

O fingerprint inclui versão/hashes/estado. A mesma condição não cria ações repetidas. Nova versão ou nova condição pode reabrir a pendência.

## 6. Resolução e aprendizagem orgânica

O watchdog não autoencerra pendência material.

A resolução continua exigindo usuário autorizado e evidência. Quando a ação documental governada é resolvida:

1. a ação permanece com prova e ator;
2. o runtime tenta registrar automaticamente uma observação no AURORA-ORG-001;
3. a operação é idempotente;
4. o fechamento da ação não falha caso a aprendizagem orgânica esteja desabilitada ou inelegível;
5. sinais só entram quando a evidência passa as regras existentes.

Além do fluxo legado APPROVED/PUBLIC|INTERNAL, um `sourceDocument` RESTRICTED só é elegível para aprendizagem quando:
- `sanitized=true`;
- `nativeReady=true`;
- `sourceIndependent=true`;
- `externalFetchRequired!=true`;
- `canonicalSnapshotVersion=1`;
- hash canônico válido;
- workflow VALIDATED/CLOSED.

O Organic Engine continua produzindo apenas propostas limitadas/read-only e exige revisão humana para piloto/execução.

## 7. Dados clínicos

O endpoint documental genérico não recebe PHI, prontuário, diagnóstico, paciente ou narrativa clínica.

Conteúdo clínico-sensível continua fora deste plano genérico e depende do caminho criptográfico dedicado sob AURORA-SEC-001, com finalidade, IAM, criptografia e governança próprios.

## 8. Estados de verificação

Separar sempre:

- SPECIFIED;
- IMPLEMENTED;
- TESTED;
- CI_VERIFIED;
- HML_VERIFIED;
- PRODUCTION_VERIFIED.

Código e CI não comprovam que um cliente MV/TASY está integrado nem que uma pasta/endpoint está operacional em produção.

## 9. Resultado esperado

Após ingestão válida, indisponibilidade temporária da origem não derruba a análise dos snapshots já aceitos. Ela afeta apenas cobertura de novos/alterados dados e deve aparecer como exceção de conector.

O objetivo é reduzir:
- dependência operacional de Drive/ERP;
- chamadas repetidas a APIs externas;
- consumo de tokens de IA;
- caminhos de credencial;
- latência de análise;
- inconsistência entre leituras sucessivas da mesma origem.

Sem sacrificar proveniência, revalidação, segurança ou revisão humana.
