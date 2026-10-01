# AURORA NEXUS — Registro de Evidências Criptográficas

**Código:** AURORA-SEC-001-CRYPTO-EVIDENCE  
**Regra:** documentação não eleva automaticamente um controle a HML_VERIFIED ou PRODUCTION_VERIFIED.

| Controle | Estado inicial desta release | Evidência versionada | Próximo gate |
|---|---|---|---|
| AES-256-GCM | IMPLEMENTED | `functions/src/auroraCryptoEnvelope.ts` | HML KMS round-trip |
| DEK 256-bit CSPRNG | IMPLEMENTED | `auroraCryptoEnvelope.ts` + testes | HML |
| nonce GCM 96-bit | TESTED | `aurora-crypto-envelope.test.ts` | HML |
| AAD tenant-bound | TESTED | teste de mismatch sem unwrap | HML |
| tamper detection | TESTED | teste ciphertext adulterado | HML |
| zeroização de DEK | IMPLEMENTED | `finally { dek.fill(0) }` | revisão independente |
| KMS wrapping | IMPLEMENTED | `GoogleKmsEnvelopeKey` | HML real |
| autenticação KMS sem JSON | IMPLEMENTED | Metadata/ADC token provider | HML real |
| IAM mínimo | SPECIFIED | runbook + workflow HML | verificar binding real |
| rotação 90 dias | SPECIFIED | workflow HML | verificar key metadata |
| KMS audit log | SPECIFIED | política | verificar log real |
| Firestore CMEK | SPECIFIED | arquitetura | confirmar acesso + banco HML separado |
| Secret Manager CMEK | SPECIFIED | arquitetura | avaliação por risco |
| CodeQL | CI_VERIFIED | workflow `Security - CodeQL` | manter required check |
| dependency high/critical gate | CI_VERIFIED | `Validate Firestore Migration` | manter required check |
| self-test com MFA/CSRF | IMPLEMENTED | `auroraCryptoRuntime.ts` | HML endpoint |
| audit event criptográfico | IMPLEMENTED | `CRYPTO_SELF_TEST_VERIFIED` | evidência Firestore |
| CBOM | SPECIFIED | arquitetura/PQC | gerar por release |
| PQC inventory | SPECIFIED | roadmap | CBOM + priorização |
| ML-KEM/ML-DSA/SLH-DSA | AVAILABLE_TARGET | NIST/Cloud KMS roadmap | homologar caso de uso |
| pentest independente | EXTERNAL_REQUIRED | — | antes de dado sensível em escala |
| ISO/IEC 27001/27701 | EXTERNAL_REQUIRED | — | programa de certificação separado |

## Evidência mínima HML

A promoção para HML_VERIFIED exige registrar:

- SHA da `main`;
- run de CI;
- run de provisionamento;
- projeto/região;
- hash do key resource;
- algoritmo e rotação;
- service account runtime;
- binding IAM;
- round-trip KMS sintético;
- deploy da função;
- self-test MFA;
- audit event;
- ausência de dados clínicos.

## Evidência mínima produção

Além do HML:

- chave/protection level aprovados;
- CMEK quando aplicável;
- matriz de campos;
- migração/rewrap;
- backup/restore;
- pentest;
- RIPD/DPIA quando aplicável;
- DPA;
- incident response;
- aceite de risco residual.
