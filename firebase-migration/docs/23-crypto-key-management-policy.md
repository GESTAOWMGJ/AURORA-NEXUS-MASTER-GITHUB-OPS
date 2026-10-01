# AURORA NEXUS — Política de Criptografia e Gestão de Chaves

**Código:** AURORA-SEC-001-CRYPTO  
**Versão:** 1.0.0  
**Escopo:** AURORA NEXUS, WMGJ Operação e futuros tenants  
**Estado:** IMPLEMENTED / HML evidence pending

## 1. Objetivo

Definir o uso obrigatório de criptografia, o ciclo de vida de chaves e os critérios mínimos para tratamento de dados RESTRICTED e CLINICAL_SENSITIVE, preservando isolamento por organização, rastreabilidade e rollback.

Esta política não representa certificação ISO, SOC 2, pentest aprovado ou conformidade jurídica integral. Ela define controles técnicos e evidências que devem ser verificados separadamente.

## 2. Baseline criptográfica

| Uso | Padrão |
|---|---|
| Dados sensíveis em aplicação | AES-256-GCM |
| DEK | 256 bits, CSPRNG, uma por envelope |
| Nonce GCM | 96 bits, aleatório e não reutilizado |
| Tag GCM | 128 bits |
| Integridade de ingestão | HMAC-SHA-256 |
| Hash técnico | SHA-256 ou superior |
| Transporte | TLS 1.3 preferencial; TLS 1.2 mínimo |
| KEK | Google Cloud KMS; Cloud HSM quando contrato/risco exigir |
| Segredos | Secret Manager; nunca Git, Firestore ou log |
| Identidade de workload | OIDC/WIF/ADC; sem JSON persistente para o runtime |

Proibidos para novos controles de segurança: MD5, SHA-1 para segurança, DES, 3DES, RC4, AES-ECB e criptografia determinística por padrão.

## 3. Hierarquia de chaves

```text
Cloud KMS CryptoKey (KEK)
        ↓ encrypt/decrypt do DEK
DEK aleatória de 256 bits por envelope
        ↓ AES-256-GCM
ciphertext + nonce + tag
        +
AAD canônica
(orgId + entityType + schemaVersion + logicalId)
```

A KEK não é exportada. A DEK existe em memória apenas durante a operação criptográfica, é envelopada pelo KMS e é zerada após o uso. DEK em claro não pode ser persistida, registrada ou retornada por API.

## 4. Envelope criptográfico

Contrato canônico: `schemas/crypto-envelope.v1.schema.json`.

Campos mínimos:

- versão do envelope;
- algoritmo;
- recurso KMS;
- versão de chave quando retornada pelo KMS;
- DEK envelopada;
- nonce;
- tag de autenticação;
- ciphertext;
- hash SHA-256 da AAD.

A AAD é obrigatória e liga criptograficamente o dado ao tenant, entidade, versão de schema e identificador lógico. Troca de tenant, entidade ou ID deve causar falha de autenticação.

## 5. Classificação e ativação

- PUBLIC: não exige criptografia de aplicação.
- INTERNAL: criptografia de infraestrutura é suficiente salvo regra contratual.
- RESTRICTED: criptografia de aplicação conforme matriz de campos.
- CLINICAL_SENSITIVE: criptografia de aplicação obrigatória antes de persistência em produção.

A presença do motor criptográfico não habilita dados clínicos. `clinicalSensitiveEnabled` permanece bloqueado até HML_VERIFIED, aceite de risco, RIPD/DPIA quando aplicável e autorização formal de produção.

## 6. Criação e custódia

A KEK deve:

1. residir no mesmo requisito de localização dos dados protegidos;
2. ter purpose `encryption`;
3. ter rotação automática;
4. conceder `roles/cloudkms.cryptoKeyEncrypterDecrypter` somente à identidade de runtime necessária;
5. ter logs de auditoria habilitados para uso comercial com dado sensível;
6. nunca conceder exportação do material bruto;
7. separar, quando operacionalmente possível, administração de chave e administração de dados.

## 7. Rotação

Padrão interno inicial: rotação automática da KEK a cada 90 dias.

Rotação extraordinária é obrigatória quando houver:

- suspeita de exposição;
- alteração indevida de IAM;
- comprometimento de identidade;
- fornecedor/contrato exigir período menor;
- mudança de ambiente ou separação de tenant;
- falha relevante de auditoria.

Rotacionar a KEK não exige recriptografar imediatamente todos os ciphertexts antigos porque o KMS mantém versões necessárias para decrypt. Rewrap/re-encryption deve ser planejado por risco, retenção e ciclo de vida.

## 8. Destruição e revogação

Nunca destruir versão KMS enquanto existir dado que dependa dela. Antes de desabilitar ou destruir:

1. inventariar envelopes;
2. confirmar versão/KEK;
3. re-envelopar ou expirar o dado conforme retenção;
4. testar recuperação;
5. registrar aprovação humana;
6. preservar evidência do rollback.

## 9. IAM e segregação

- deploy identity não implica automaticamente decrypt de dados;
- runtime recebe apenas a permissão criptográfica necessária;
- operadores humanos não recebem material de chave;
- ações de verificação criptográfica exigem login, escopo organizacional e MFA;
- o self-test possui rate limit e registra audit event sem plaintext.

## 10. Logs

É proibido registrar:

- plaintext sensível;
- DEK;
- conteúdo de KEK;
- token OAuth;
- ciphertext completo em logs;
- segredo HMAC;
- session cookie.

Permitido registrar: hash do recurso KMS, algoritmo, versão do envelope, hashes de ciphertext/DEK envelopada, estado e identificador de auditoria.

## 11. Testes obrigatórios

Toda release criptográfica cobre:

- round-trip;
- alteração de ciphertext;
- alteração de AAD;
- troca de key resource;
- nonce distinto;
- limite de tamanho;
- KMS adapter sem credencial estática;
- TypeScript build;
- CodeQL;
- dependency audit;
- Security Rules;
- self-test HML com identidade real.

## 12. Referenciais

- LGPD, especialmente art. 46;
- NIST SP 800-38D;
- NIST SP 800-57 Part 1 Rev. 5;
- NIST FIPS 203, 204 e 205 para transição pós-quântica;
- ISO/IEC 27001:2022;
- ISO/IEC 27701:2025;
- OWASP ASVS 5.0;
- práticas de Cloud KMS/CMEK do Google Cloud.

## 13. Evidência e promoção

Estados:

```text
SPECIFIED
→ IMPLEMENTED
→ TESTED
→ CI_VERIFIED
→ HML_VERIFIED
→ PRODUCTION_VERIFIED
→ AUDITED_INDEPENDENTLY
→ CERTIFIED
```

Nenhum estado é inferido a partir do anterior.
