# AURORA NEXUS — Especificação Firestore HML Novo com CMEK

**Código:** AURORA-SEC-002-CMEK-HML  
**Versão:** 1.0.0-draft  
**Estado:** PREPARED_NOT_APPLIED  
**Regra:** não altera `(default)`, produção, dados reais ou clinicalSensitiveEnabled.

## 1. Objetivo

Preparar um banco Firestore Native de homologação separado, com CMEK, delete protection, PITR, backup agendado, restore testável e ensaio controlado de indisponibilidade da chave. A execução é manual e protegida; este documento e os scripts não criam recursos por si mesmos.

## 2. Recursos propostos

| Recurso | Valor |
|---|---|
| Project HML | `wmgj-hml-jfn-20260927` |
| Database novo | `aurora-hml-cmek` |
| Location | `southamerica-east1` |
| Edition | Standard |
| Type | Firestore Native |
| Key ring | `aurora-hml-firestore` |
| CMEK | `aurora-firestore-cmek` |
| Rotation | 90 dias |
| Protection level | SOFTWARE em HML |
| Delete protection | ENABLED |
| PITR | ENABLED |
| Backup | diário, retenção 14 dias |
| Restore DB de teste | prefixo `aurora-hml-restore-` |
| Dado real | PROIBIDO |
| CLINICAL_SENSITIVE | DESABILITADO |

A chave CMEK de Firestore é distinta da KEK `aurora-field-encryption` usada pela criptografia de aplicação. Isso evita misturar finalidade de server-side encryption com wrapping de DEKs.

## 3. Premissas técnicas

- Firestore existente com Google default encryption não é convertido in-place para CMEK.
- A CMEK só é selecionada na criação do novo banco.
- A chave Cloud KMS deve estar na mesma localização do banco regional.
- O service agent do Firestore recebe apenas `roles/cloudkms.cryptoKeyEncrypterDecrypter` na chave CMEK.
- Rotação mantém versões antigas disponíveis enquanto o Firestore ainda as reportar em `activeKeyVersion`.
- Desabilitar/destruir key version pode tornar dados inacessíveis; destruição não faz parte dos testes.

## 4. Sequência de provisionamento

```text
PLAN/read-only
→ validar projeto/location/billing/identidade
→ habilitar/verificar Firestore + KMS APIs
→ criar/obter Firestore service identity
→ criar key ring
→ criar CMEK com rotação
→ conceder IAM na chave ao service agent
→ criar aurora-hml-cmek com CMEK + delete protection + PITR
→ verificar cmekConfig + activeKeyVersion
→ criar backup schedule diário
→ escrever somente sentinel sintético
→ aguardar backup READY
→ restore para banco novo
→ ler sentinel e reconciliar
→ teste controlado de key disable/re-enable
→ evidência
```

## 5. Comando canônico de criação

Preparado para uso pelo workflow, não para execução automática:

```bash
gcloud firestore databases create \
  --project="$PROJECT_ID" \
  --database="aurora-hml-cmek" \
  --location="southamerica-east1" \
  --type="firestore-native" \
  --edition="standard" \
  --kms-key-name="$KMS_KEY_RESOURCE" \
  --delete-protection \
  --enable-pitr \
  --quiet
```

## 6. Backup

```bash
gcloud firestore backups schedules create \
  --project="$PROJECT_ID" \
  --database="aurora-hml-cmek" \
  --recurrence=daily \
  --retention=14d
```

O backup não é considerado evidência de recuperação até existir backup `READY` e restore comprovado.

## 7. Restore test

O restore deve usar um database ID novo por execução e nunca substituir o banco fonte:

```bash
gcloud firestore databases restore \
  --project="$PROJECT_ID" \
  --source-backup="$BACKUP_RESOURCE" \
  --destination-database="$RESTORE_DB" \
  --encryption-type=customer-managed-encryption \
  --kms-key-name="$KMS_KEY_RESOURCE"
```

Após conclusão: verificar location, CMEK, documento sentinel, hash/valor sintético e ausência de coleções não autorizadas.

## 8. Teste de falha de chave

Somente HML, somente uma versão ativa identificada, sem destruição.

1. registrar `activeKeyVersion` do banco;
2. garantir que o sentinel sintético é legível;
3. desabilitar temporariamente a versão específica com confirmação manual;
4. observar a perda de acesso/erro esperado durante a janela de propagação;
5. reabilitar a versão em `trap/finally`, mesmo em falha do teste;
6. aguardar recuperação;
7. comprovar leitura do sentinel novamente;
8. preservar Cloud KMS Data Access/Audit Logs e timestamps;
9. se o efeito não propagar dentro da janela do teste, marcar `PENDING_PROPAGATION`, nunca sucesso falso.

Nenhum teste agenda destruição de chave.

## 9. Rollback

- não apagar `(default)`;
- não destruir key ring/key version;
- reabilitar versão desabilitada;
- manter `clinicalSensitiveEnabled=false`;
- impedir cutover;
- preservar logs e artefatos;
- bancos HML auxiliares só podem ser removidos posteriormente por change control separado, após evidência e aprovação.

## 10. Gate para dados pessoais reais

O banco `aurora-hml-cmek` nasce exclusivamente sintético. Dados pessoais reais exigem RoPA preenchido, DPA assinado, risco aprovado, incident response operacional e autorização formal do tenant.

## 11. Gate para CLINICAL_SENSITIVE

Continua bloqueado até: envelope AES-256-GCM HML_VERIFIED, CMEK HML_VERIFIED, restore test, key-failure recovery, RIPD/DPIA quando aplicável, pentest independente, exercício de incidente e aceite formal do risco residual.
