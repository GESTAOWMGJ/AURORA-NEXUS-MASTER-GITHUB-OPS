# AURORA NEXUS — progresso até a versão vendável

## Release train

- Produto: **1.0.0-rc.1**
- Política operacional: **2.3.0**
- Motor orgânico: **1.2.0**
- Native Intelligence: **0.1.0**
- Piloto de referência: **WMGJ Operação**
- Baseline de código: `main` pós-PR #39

## O que já é produto

- login-first, sessão e membership;
- Firestore protegido e tenant WMGJ;
- módulos M01–M10 e M03.1;
- dashboard SHADOW;
- ações de auditoria com evidência;
- AURORA-ORG-001 AUDIT/FINANCE;
- deploy HML protegido e smoke autenticado;
- retomada/idempotência do fluxo orgânico;
- Native Intelligence v0 sem provedor externo, neste RC.

## Bloqueios objetivos

### Ingestão real
Não liberar enquanto faltar ensaio real de restore e promoção governada da identidade/keyring de ingestão.

### Desktop
Não tratar launcher HML como sucessor do aplicativo funcional. Inspecionar a baseline instalada e validar atualização in-place/rollback.

### Collective Intelligence
Privacy Gate → Knowledge Capsule → Knowledge Registry → Pattern Matcher permanece o próximo grande módulo de produto; não deve receber dados brutos de outro tenant.

## Definição de avanço por prompt

Toda solicitação relevante deve:
1. gerar ou atualizar patch;
2. adicionar teste;
3. alterar um gate ou explicar por que não altera;
4. manter rollback;
5. reportar SHA/CI/deploy separadamente;
6. escolher o próximo bloqueio de maior impacto.

## Próximos incrementos recomendados

1. fechar recovery gate e liberar amostra operacional real WMGJ;
2. implementar M12 Collective Intelligence em modo PRIVATE/COLLABORATIVE;
3. consolidar a IA nativa com Knowledge Registry e Pattern Matcher;
4. validar atualização do app Mac instalado;
5. hardening comercial, domínio, distribuição e documentação;
6. promover RC aprovada para `1.0.0` GA.


## Candidato desktop — 02/10/2026 — PR #95

Componente `imac-bootstrap-hardening-1`, sem alterar o release train do produto.
Baseline da branch: `06d25eada900f28eb64384623e500344272620db`; main revalidada:
`968c071fa6bd27c44c491af19b0852b8058c1060`.

- Implementado no candidato: dry-run por padrão; apply/host explícitos; staging;
  validação shell/JSON/PLIST; backups; rollback em falha; espelho fast-forward-only.
- Testes: fixtures offline de segurança, idempotência e rollback em
  `tools/imac/tests/test_bootstrap.py`; o workflow de instaladores cobre Ubuntu/macOS.
- CI do SHA final deve ser conferido no PR; checks anteriores não liberam o patch.
- Gate desktop/comercial permanece bloqueado: falta teste autorizado no iMac real,
  Node 16/High Sierra, retorno remoto e rollback nativo comprovado.
- Não é atualização do .app original, instalação realizada, ingestão ou deploy.
  Runbook/limites e responsável sugerido em `tools/imac/README.md`.
