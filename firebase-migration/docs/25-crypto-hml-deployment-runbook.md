# AURORA NEXUS — Runbook de Implantação Criptográfica HML

**Código:** AURORA-SEC-001-HML  
**Objetivo:** implantar KMS + envelope encryption em homologação sem habilitar dado clínico.

## 1. Pré-condições

- branch baseada na ponta real da `main`;
- CodeQL, Firestore, Organic e testes crypto verdes;
- projeto aprovado: `wmgj-hml-jfn-20260927`;
- ambiente: `firebase-homologation`;
- WIF funcional;
- `productionMutation=false`;
- `clinicalSensitiveEnabled=false`.

## 2. Recursos

Baseline HML:

- location: `southamerica-east1`;
- key ring: `aurora-hml`;
- crypto key: `aurora-field-encryption`;
- purpose: `encryption`;
- rotation: 90 dias;
- protection level: software em HML;
- Cloud HSM: avaliar para produção conforme risco/contrato.

## 3. Provisionamento

O workflow `.github/workflows/aurora-crypto-hml.yml` deve:

1. validar request imutável;
2. autenticar por WIF;
3. habilitar/verificar Cloud KMS API;
4. criar key ring apenas se ausente;
5. criar key apenas se ausente;
6. validar purpose e rotação;
7. resolver a service account real do runtime Gen2;
8. conceder somente `roles/cloudkms.cryptoKeyEncrypterDecrypter`;
9. executar round-trip KMS com conteúdo sintético;
10. gravar configuração `crypto` no documento da organização;
11. implantar apenas `auroraNexusCryptoSelfTest` + Hosting HML;
12. preservar evidências sem plaintext.

## 4. Configuração Firestore

O documento `organizations/wmgj` recebe somente metadados não secretos:

```text
crypto.state = HML_READY
crypto.algorithm = AES-256-GCM
crypto.envelopeVersion = 1
crypto.keyResource = projects/.../cryptoKeys/aurora-field-encryption
crypto.rotationDays = 90
crypto.clinicalDataEnabled = false
```

O key resource não é segredo. Material de chave nunca entra no Firestore.

## 5. Teste administrativo

Depois do deploy:

- entrar com usuário autorizado;
- MFA obrigatório;
- executar POST `/api/crypto/self-test` com CSRF válido;
- verificar retorno `HML_VERIFIED`;
- confirmar audit event `CRYPTO_SELF_TEST_VERIFIED`;
- conferir Cloud KMS audit logs;
- confirmar ausência de plaintext/DEK nos logs.

O self-test usa somente bytes aleatórios sintéticos.

## 6. Rollback

Se o deploy falhar:

1. não destruir a chave;
2. revogar a rota/função nova se necessário;
3. manter `clinicalSensitiveEnabled=false`;
4. marcar `crypto.state=BLOCKED`;
5. preservar audit log e run;
6. corrigir em branch;
7. revalidar CI e HML.

Se já existirem envelopes reais, a chave não pode ser desabilitada/destruída antes de rewrap ou expiração comprovada.

## 7. Gate de produção

Produção com dado sensível requer adicionalmente:

- RIPD/DPIA conforme risco;
- DPA/subprocessadores;
- matriz de campos criptografados;
- KMS/HSM/CMEK aprovados;
- restore real;
- pentest independente;
- incident response testado;
- retenção e descarte;
- acesso revisado;
- aceite formal de risco residual.

Este runbook não autoriza automaticamente produção.
