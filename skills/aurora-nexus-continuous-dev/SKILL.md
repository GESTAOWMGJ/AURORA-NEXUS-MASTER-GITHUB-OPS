---
name: aurora-nexus-continuous-dev
description: Desenvolvimento contínuo verificável do AURORA NEXUS até versão final vendável. Cada solicitação relevante vira incremento versionado com patch, testes, evidência, progresso e próximo gate.
version: 1.1.0
code: AURORA-DEV-001
---

# AURORA NEXUS — Desenvolvimento Contínuo Verificável

## Fonte canônica do modus operandi

Antes de qualquer alteração relevante em WMGJ/AURORA, ler `docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md`.

AURORA-MO-001 incorpora os workflows e automações reais da WMGJ como matriz operacional do AURORA NEXUS. WMGJ continua sendo tenant-piloto e fonte de aprendizado; não pode virar dependência estrutural nem conjunto de regras hard-coded do produto.

O ciclo obrigatório é:

`OBSERVAR → INGESTAR → COMPROVAR → CONFRONTAR → DETECTAR → PRIORIZAR → AGIR → VALIDAR → MEDIR → APRENDER → REUTILIZAR`.

A regra de pendências é ativa: divergência, glosa, documento faltante, faturamento, recebimento, repasse ou SLA permanece em ciclo até fechamento comprovado.

## Finalidade

Transformar cada prompt relacionado ao AURORA NEXUS em avanço mensurável do mesmo produto, evitando projetos paralelos, recomeços e melhorias apenas descritivas.

## Regra principal

Para toda solicitação de produto, engenharia, gestão, auditoria, interface, inteligência, integração ou automação:

1. Revalidar a baseline da `main` e a versão funcional instalada quando o trabalho envolver desktop.
2. Classificar a solicitação como correção, capacidade, integração, hardening, experiência, inteligência ou release.
3. Criar o menor patch coerente no mesmo sistema-mãe.
4. Preservar M01–M10, M03.1/JFN-AUD-FAT-001, AURORA-ORG-001, AURORA-SEC-001 e isolamento por organização.
5. Aplicar AURORA-SEC-001 quando houver segurança, criptografia, dados, dependências, deploy ou liberação comercial.
5. Adicionar ou atualizar testes.
6. Atualizar o Release Cockpit quando o patch muda um gate.
7. Separar claramente: especificado, implementado, testado, CI, implantado, publicado e validado com dados reais.
8. Não declarar conclusão por existência de código.
9. Não contornar gates de segurança, recuperação, login, MFA, proveniência ou rollback.
10. Informar o próximo incremento de maior valor para aproximar `1.0.0` GA.
11. Reutilizar primeiro os workflows WMGJ/AURORA existentes; criar fluxo novo somente quando a capacidade não couber na arquitetura atual.
12. Para toda divergência financeira ou operacional, preservar fato, fonte, evidência, impacto, responsável, SLA, aging, próxima ação e residual.
13. Nunca converter produção em receita, faturamento em recebimento, saldo em lucro ou ausência de evidência em zero.
14. Quando uma prática WMGJ provar valor, promovê-la por AURORA-ORG-001: evidência → padrão → teste → revisão humana → piloto → medição → promoção/rollback.

## Estratégia de independência de IA externa

A ordem de preferência é:

1. motor nativo explicável do AURORA;
2. Knowledge Registry e Pattern Matcher internos;
3. modelos privados/locais ou controlados pela plataforma quando tecnicamente homologados;
4. provedores externos opcionais, encapsulados por interface substituível.

Nenhuma regra essencial de faturamento, auditoria, SLA, segurança, autorização ou integridade pode depender exclusivamente de um modelo externo.

## Patch contínuo

Cada patch deve carregar:

- versão do produto;
- módulo afetado;
- baseline SHA;
- diff;
- testes;
- evidência de CI quando disponível;
- impacto no Release Cockpit;
- rollback;
- lacunas restantes.

Mudança sem evidência permanece candidata, não baseline.

## Dados reais

Dados reais só entram no tenant autorizado depois dos gates de recuperação e segurança. Dados clínicos identificáveis permanecem fora da inteligência coletiva. O modo coletivo recebe apenas conhecimento permitido, minimizado e governado.

## Critério de versão vendável

A versão `1.0.0` GA exige, no mínimo:

- acesso privado e isolamento;
- core operacional;
- ingestão operacional autorizada e recuperável;
- auditoria/revenue/SLA funcionais com dados reais;
- inteligência nativa explicável;
- logs e rollback;
- experiência de instalação/atualização validada;
- documentação comercial e operacional;
- smoke e aceite em ambiente de referência.
