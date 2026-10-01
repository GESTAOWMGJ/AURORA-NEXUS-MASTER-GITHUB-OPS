# AURORA NEXUS — Arquitetura Criptográfica e Roadmap Pós-Quântico

**Código:** AURORA-SEC-001-ARCH  
**Versão:** 1.0.0

## 1. Arquitetura

```text
Cliente autenticado
      │ TLS
      ▼
Firebase Hosting / Functions
      │ sessão + MFA + CSRF
      ▼
AURORA backend
      │
      ├─ CSPRNG → DEK 256 bits
      │            │
      │            └─ AES-256-GCM + AAD → ciphertext
      │
      └─ workload identity → Cloud KMS KEK
                               │
                               └─ encrypt(DEK, AAD) → wrapped DEK

Firestore
  ├─ envelope criptográfico de aplicação
  └─ server-side encryption; CMEK adicional quando homologado
```

Não existe chave mestre em código, repositório, browser, app mobile ou documento Firestore.

## 2. Trust boundaries

1. browser/cliente → Hosting;
2. Hosting → Function autenticada;
3. Function → Firestore;
4. Function → Metadata Server/ADC;
5. workload identity → Cloud KMS;
6. administração do projeto → IAM/KMS;
7. pipeline CI/CD → WIF.

Cada boundary deve ser autenticada, minimizada e auditável.

## 3. Envelope encryption

O AURORA usa uma DEK independente para cada envelope. A DEK é usada apenas para AES-256-GCM e envelopada por uma KEK do Cloud KMS.

AAD canônica:

```json
{
  "orgId": "...",
  "entityType": "...",
  "schemaVersion": "...",
  "logicalId": "..."
}
```

Isso reduz o risco de ciphertext válido ser transplantado entre tenants ou objetos.

## 4. Defesa contra classes de ataque

| Risco | Controle |
|---|---|
| leitura do Firestore fora da aplicação | ciphertext no campo sensível |
| cópia entre tenants | AAD com orgId |
| adulteração | tag GCM |
| nonce reuse | CSPRNG 96-bit por envelope |
| exfiltração de DB | DEK não armazenada em claro |
| vazamento de código | KEK ausente do código |
| credential file theft | workload identity/metadata token |
| replay de ingestão | HMAC v2 + nonce + timestamp + idempotência |
| abuso do self-test | MFA + role + CSRF + 60 s rate limit |
| log leakage | retorno e logging sem plaintext/DEK |
| key compromise | rotação + IAM + audit log + rollback |

## 5. Firestore CMEK

CMEK é uma camada de server-side encryption controlada pelo cliente e complementa, não substitui, a criptografia de aplicação.

O rollout segue:

1. confirmar disponibilidade CMEK no projeto/região;
2. criar banco HML separado protegido por CMEK;
3. validar IAM, backup, restore e indisponibilidade de chave;
4. reconciliar dados;
5. somente depois avaliar migração controlada.

Banco existente com criptografia Google-managed não deve ser considerado automaticamente convertido em CMEK.

## 6. Post-Quantum Cryptography

O objetivo não é substituir AES-256-GCM por um KEM ou assinatura PQC. A transição pós-quântica é aplicada aos componentes assimétricos e à longevidade de integridade.

Baseline de crypto-agility:

- inventário de algoritmos e dependências;
- identificar dados com risco `harvest now, decrypt later`;
- manter API de envelope desacoplada do provedor KMS;
- preparar key establishment para ML-KEM quando o canal/plataforma suportar;
- preparar artefatos e assinaturas de longa duração para ML-DSA ou SLH-DSA quando requerido;
- manter AES-256-GCM para dados em repouso;
- versionar envelope para permitir migração futura sem reescrever silenciosamente dados antigos.

Em 2026, o Google Cloud KMS disponibiliza primitivas pós-quânticas padronizadas pelo NIST. A adoção operacional exige homologação por caso de uso e não deve ser ativada apenas por disponibilidade do algoritmo.

## 7. Cryptographic Bill of Materials — CBOM mínimo

Por release comercial registrar:

- algoritmo;
- finalidade;
- biblioteca/runtime;
- tamanho de chave/nonce/tag;
- provedor;
- localização;
- recurso KMS ou hash dele;
- versão do envelope;
- dependências;
- data de revisão;
- status PQC;
- owner;
- exceções.

## 8. Critério de mercado

A arquitetura fornece capacidade técnica compatível com procurement de saúde/B2B, mas a declaração comercial deve separar:

- controle implementado;
- CI verificado;
- HML verificado;
- produção verificada;
- pentest independente;
- certificação de terceira parte.

Nenhuma certificação é inferida.
