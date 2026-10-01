# AURORA NEXUS — Gate de Liberação de Dados Clínicos Identificáveis

**Código:** AURORA-SEC-002-CLINICAL-GATE  
**Estado inicial:** BLOCKED  
**Regra:** ausência de evidência = bloqueio.

## 1. Condição atual

`CLINICAL_SENSITIVE` permanece proibido na persistência operacional/IA externa enquanto este gate não for formalmente promovido.

## 2. Gates obrigatórios

| Gate | Evidência mínima | Estado inicial |
|---|---|---|
| AES-256-GCM envelope | testes tamper/AAD/round-trip no SHA final | CI_VERIFIED/PENDING_HML |
| Cloud KMS | IAM mínimo, key resource, rotação e audit log | PENDING_HML |
| Firestore CMEK | banco novo CMEK + cmekConfig verificado | PENDING_HML |
| Backup | backup READY do banco CMEK | PENDING |
| Restore | restore em banco novo + reconciliação sentinel | PENDING |
| Key failure | disable/re-enable controlado + recuperação | PENDING |
| Tenant isolation | negative tests + pentest | PARTIAL |
| RoPA | preenchido e aprovado pelo controlador | PENDING_CLIENT |
| DPA | assinado | PENDING_CLIENT |
| RIPD/DPIA | concluído quando aplicável | PENDING_ASSESSMENT |
| Incident Response | plano + tabletop concluído | PENDING_EXERCISE |
| Pentest independente | highs/criticals corrigidos | EXTERNAL_REQUIRED |
| Access review | usuários/roles/MFA revisados | PENDING |
| Subprocessadores | inventário/DPA/localização | PENDING |
| Retenção | tabela por categoria e legal hold | PENDING |
| Risco residual | aceite formal do owner/controlador | PENDING |

## 3. Critério técnico de promoção

Todos os gates devem possuir evidência vinculada a SHA/run/ambiente e nenhum HIGH/CRITICAL aberto sem exceção formal. Um documento ou check verde antigo não promove o gate automaticamente.

## 4. IA

Mesmo após habilitação de persistência clínica, envio para IA externa exige gate separado de provedor, contrato, retenção, localização, minimização, finalidade e revisão humana.

## 5. Mudança de estado

Estados permitidos:

```text
BLOCKED
→ READY_FOR_SYNTHETIC_HML
→ HML_VERIFIED
→ READY_FOR_LIMITED_REAL_PILOT
→ PRODUCTION_APPROVED
```

Somente revisão humana formal pode promover. Qualquer revogação de KMS, falha de restore, incidente relevante, pentest crítico ou quebra de segregação rebaixa imediatamente para `BLOCKED`.
