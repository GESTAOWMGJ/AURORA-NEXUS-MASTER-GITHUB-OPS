# AURORA NEXUS — Security Questionnaire | Criptografia

**Uso:** procurement técnico B2B.  
**Importante:** respostas descrevem arquitetura e evidência disponível; não equivalem a certificação.

## Criptografia em trânsito

**Padrão:** TLS 1.3 preferencial, TLS 1.2 mínimo, validação de certificado obrigatória.

## Criptografia em repouso

Google Cloud aplica criptografia server-side por padrão. Para dados sensíveis, o AURORA adiciona criptografia de aplicação AES-256-GCM. CMEK de Firestore é camada adicional quando homologada no projeto.

## Criptografia em aplicação

- AES-256-GCM;
- DEK aleatória de 256 bits por envelope;
- nonce de 96 bits;
- tag de 128 bits;
- AAD tenant-bound;
- DEK envelopada por Cloud KMS.

## Gestão de chaves

KEKs permanecem no Cloud KMS e não são exportadas. O runtime autentica por identidade da workload, sem chave JSON persistente. A rotação interna alvo é 90 dias em HML, sujeita a política contratual mais restritiva.

## Segregação de tenant

A AAD inclui `orgId`, além de entidade, versão de schema e ID lógico. Um envelope transplantado para outro tenant deve falhar na autenticação GCM.

## Logs

Plaintext, DEK, token e segredo HMAC não são registrados. Evidências usam hashes e metadados não secretos.

## MFA

A verificação criptográfica administrativa exige MFA, autorização por papel/permissão e CSRF ligado à sessão.

## Vulnerability management

CI inclui CodeQL e bloqueio de vulnerabilidades high/critical de dependências de produção. Estado de ruleset obrigatório deve ser comprovado separadamente.

## Backup e recuperação

Chaves não devem ser destruídas enquanto houver envelopes dependentes. Restore/rewrap fazem parte do gate de produção.

## Post-quantum

O produto mantém crypto-agility e CBOM. NIST ML-KEM, ML-DSA e SLH-DSA entram no roadmap para key establishment e assinatura quando aplicável. AES-256-GCM permanece o mecanismo de dados em repouso.

## Dados de saúde

CLINICAL_SENSITIVE não é ativado automaticamente. A produção exige controles adicionais, incluindo criptografia homologada, governança LGPD, pentest e avaliação de impacto conforme risco.

## Certificações

ISO/IEC 27001, ISO/IEC 27701 e SOC 2 não são declaradas como existentes sem auditoria independente correspondente.
