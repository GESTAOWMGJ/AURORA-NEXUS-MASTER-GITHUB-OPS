# AURORA NEXUS — Plano de Resposta a Incidentes

**Código:** AURORA-SEC-002-IRP  
**Versão:** 1.0.0-draft  
**Escopo:** segurança cibernética, privacidade, disponibilidade, integridade, supply chain e IA.

## 1. Objetivo

Conter, investigar, recuperar e documentar incidentes com mínimo impacto, preservando evidência e permitindo ao controlador cumprir suas obrigações regulatórias. Este plano precisa ser exercitado; sua existência documental não prova prontidão.

## 2. Severidade

| Nível | Critério | Ação |
|---|---|---|
| SEV0 | dado clínico/segredo/chave exposto em escala, cross-tenant, perda de controle KMS, produção comprometida | war room imediato; congelar mudanças; direção/DPO/jurídico |
| SEV1 | acesso indevido confirmado, ransomware, key compromise, indisponibilidade crítica prolongada | resposta imediata e contenção prioritária |
| SEV2 | vulnerabilidade explorável sem evidência de abuso, exposição limitada, falha relevante de backup | tratar em prioridade alta |
| SEV3 | evento suspeito ou falha sem impacto material comprovado | investigar e corrigir |
| SEV4 | alerta falso/baixo risco | registrar e encerrar com evidência |

## 3. RACI funcional

- Incident Commander: coordena decisão e timeline.
- Security Lead: investigação, contenção, IAM/KMS, evidência.
- Privacy/DPO: avaliação LGPD, titulares e ANPD.
- Engineering Lead: correção técnica e rollback.
- Operations/Customer Lead: continuidade e comunicação contratual.
- Legal: obrigações, privilégio e comunicação externa.
- Executive Owner: aceita risco residual e decisões críticas.

Nomes e contatos reais devem ser preenchidos fora de documentação pública do repositório.

## 4. Fluxo

```text
DETECTAR → TRIAR → CLASSIFICAR → CONTER → PRESERVAR EVIDÊNCIA
→ ERRADICAR → RECUPERAR → VALIDAR → COMUNICAR QUANDO APLICÁVEL
→ POST-MORTEM → AÇÃO PREVENTIVA → ENCERRAR COM EVIDÊNCIA
```

## 5. Primeiros 60 minutos

1. abrir incident ID e relógio único;
2. registrar fonte, hora, ator e ambiente;
3. classificar SEV sem apagar evidência;
4. impedir deploy/mudança não relacionada;
5. preservar logs, auditEvents, workflow runs e hashes;
6. revogar sessão/credencial claramente comprometida;
7. se houver risco de chave: restringir IAM e preparar rotação; não destruir key version;
8. preservar sistemas-fonte e backups;
9. envolver Privacy/DPO se houver dado pessoal;
10. registrar o que é fato, hipótese e pendência.

## 6. Playbooks

### 6.1 Credencial ou sessão comprometida

- revogar sessão/token;
- desabilitar conta se necessário;
- revisar membership/claims/IAM;
- rotacionar segredo afetado;
- pesquisar uso anômalo;
- preservar logs;
- reemitir acesso somente após validação.

### 6.2 KMS/CMEK indisponível ou comprometida

- identificar key resource e activeKeyVersion;
- confirmar se o evento é IAM, disable ou falha de serviço;
- não destruir nenhuma versão;
- reabilitar versão quando a indisponibilidade for acidental e autorizado;
- se houver comprometimento: criar nova versão/KEK conforme runbook, rewrap quando necessário e revisar IAM;
- verificar Firestore, backups e restore;
- registrar todos os recursos dependentes.

### 6.3 Cross-tenant / dado exposto

- bloquear rota/consulta;
- invalidar sessões quando necessário;
- congelar exportações;
- determinar tenants, titulares, campos e intervalo;
- preservar query/log/evidência;
- corrigir regra/serviço e adicionar teste negativo;
- avaliar comunicação LGPD/contratual.

### 6.4 Segredo no Git/release/log

- tratar como comprometido mesmo que posteriormente removido;
- revogar/rotacionar;
- remover acesso ao artefato;
- secret scan histórico;
- verificar uso indevido;
- não confiar apenas em reescrever histórico.

### 6.5 Supply chain

- identificar package/action/artefato;
- bloquear builds/releases afetados;
- comparar lockfile/SBOM/provenance;
- corrigir versão e regenerar artefatos;
- reexecutar CodeQL/dependency scan;
- invalidar release se integridade não puder ser comprovada.

### 6.6 Prompt injection / IA

- impedir tool execution derivada do conteúdo;
- preservar prompt/input hash/output hash/model version;
- desabilitar integração quando necessário;
- validar se houve acesso a dados ou ação externa;
- adicionar caso adversarial aos evals.

## 7. Comunicação regulatória LGPD

O controlador avalia se o incidente pode acarretar risco ou dano relevante aos titulares. Nos casos comunicáveis, a Resolução CD/ANPD nº 15/2024 estabelece, como regra geral, comunicação à ANPD e aos titulares pelo controlador em até três dias úteis contados do conhecimento de que o incidente afetou dados pessoais, ressalvada legislação específica e regras de prazo diferenciado aplicáveis. O processo interno do AURORA deve produzir informação suficiente sem demora.

**SLA interno do operador:** notificar o controlador de incidente material confirmado ou razoavelmente suspeito em até 24 horas da ciência, salvo prazo contratual menor, para não consumir o prazo regulatório do controlador.

Manter registro de incidentes com dados pessoais pelo período regulatório aplicável; o RCIS da ANPD determina registro por pelo menos cinco anos.

## 8. Evidência mínima

- incident ID;
- timestamps;
- atores;
- sistemas/tenants;
- categorias de dados;
- indicadores de comprometimento;
- SHA/versão/release;
- logs e hashes preservados;
- ações de contenção;
- decisão de comunicação e fundamento;
- recuperação validada;
- risco residual;
- post-mortem e owners.

## 9. Recuperação e encerramento

Um incidente não encerra porque o serviço voltou. Exigir: causa provável/confirmada, controle restaurado, credenciais/chaves tratadas, dados reconciliados, monitoramento ativo, comunicação concluída quando aplicável, teste de regressão, owner e prazo para ações preventivas.

## 10. Exercícios

- tabletop trimestral SEV0/SEV1;
- restore real conforme programa de DR;
- teste de chave CMEK desabilitada exclusivamente em HML;
- simulação de credential leak;
- simulação cross-tenant sem dado real;
- pós-exercício com plano e prazos.
