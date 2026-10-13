# Correção do recibo de recuperação de domínio — 13/10/2026

- Classificação: correção M08/M10, candidata; não altera versão instalada.
- Baseline: `a89d431c42d79210b48867d59a3cf3153e7153fc`.
- Origem: discussão P2 `PRRT_kwDOSPxFbs6rmuU-` no PR #226.
- Problema: espera por reavaliação registrava `mutationPerformed:false` mesmo
  após criação ou undelete aceitos pelo workflow.
- Resolução: derivar o booleano exclusivamente de `CREATE_REQUESTED` e
  `UNDELETE_REQUESTED`, preservando todos os gates, chamadas e códigos de saída.
- Domínio existente com HOST_ACTIVE/CERT_ACTIVE/OWNERSHIP_MISMATCH: somente GET,
  recibo false e saída 84. Criação/undelete autorizados: recibo true e saída 84
  enquanto titularidade permanecer divergente. VALIDATE_ONLY permanece sem mutação.
- Regressão: `scripts/tests/test_custom_domain_repair.py` executa o Bash real
  com curl/gcloud/sleep interceptados, API e credenciais sintéticas, sem rede.
  Inclui reprodução do recibo anterior, comparação de chamadas efetivas,
  titularidade ativa e validação sem reparo.
- CI: integrado ao workflow existente `Validate HML Auth Contract`, por SHA
  do candidato; resultado e URL do run pertencem ao PR. Código/testes não
  demonstram execução de reparo, deploy, estado atual do domínio ou adoção no Xeon.
- Rollback: reverter o commit desta correção pelo fluxo revisado, sem executar
  o workflow de reparo nem alterar DNS, IAM, certificados ou recursos.
- Conhecimento: regra abstrata registrada na fonte mestre AURORA-MO-001;
  carregamento em runtime, promoção entre tenants e implantação não comprovados.
