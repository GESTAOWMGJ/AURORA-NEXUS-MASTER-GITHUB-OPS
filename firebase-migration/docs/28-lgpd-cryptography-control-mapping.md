# AURORA NEXUS — Mapeamento LGPD x Controles Criptográficos

**Código:** AURORA-SEC-001-LGPD  
**Finalidade:** demonstrar vínculo técnico sem converter controles em parecer jurídico.

## Art. 46 — medidas técnicas e administrativas

Controle AURORA:

- criptografia de aplicação para CLINICAL_SENSITIVE;
- KMS e gestão de chaves;
- login individual/MFA;
- segregação por organização;
- audit ledger;
- CI de segurança;
- backup/restore;
- incident response e revisão humana como gates.

## Privacy/Security by design

A criptografia é aplicada na arquitetura desde a concepção do fluxo sensível. O sistema mantém `clinicalSensitiveEnabled=false` até os gates de homologação.

## Minimização

O self-test criptográfico usa apenas material sintético aleatório. Logs guardam hashes e metadados, não conteúdo sensível.

## Controle de acesso

- menor privilégio;
- papéis;
- revalidação backend;
- MFA para ações críticas;
- IAM da chave separado do acesso ao dado.

## Rastreabilidade

Toda verificação HML deve possuir:

- SHA;
- run;
- ator;
- key resource hash;
- algoritmo;
- resultado;
- audit event;
- data/hora.

## Incidente criptográfico

Suspeita de exposição exige:

1. contenção;
2. preservação de evidência;
3. rotação;
4. revisão IAM;
5. inventário de envelopes;
6. rewrap quando necessário;
7. análise de impacto;
8. comunicação regulatória quando aplicável.

## Dados sensíveis de saúde

Por serem dados pessoais sensíveis, exigem tratamento reforçado. Criptografia é um controle técnico importante, mas não substitui base legal, governança, finalidade, minimização, retenção, direitos dos titulares e controles organizacionais.

## Referências normativas/técnicas

- Lei nº 13.709/2018 — LGPD, art. 46;
- orientações de segurança da informação da ANPD;
- NIST SP 800-38D;
- NIST SP 800-57;
- ISO/IEC 27001 e 27701;
- OWASP ASVS.

Este documento não substitui assessoria jurídica nem auditoria de conformidade.
