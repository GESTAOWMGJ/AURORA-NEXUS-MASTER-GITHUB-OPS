# Aprendizado contínuo supervisionado

## Princípio

Aprendizado contínuo significa observar desempenho, identificar padrões de falha, propor melhoria, testar com dados sintéticos e promover uma versão somente após aprovação. Não significa autoalteração de código, prompt, regra de negócio ou decisão clínica.

## Ciclo controlado

1. `shadow_snapshot` registra estado agregado, SLA e evidência.
2. A política versionada calcula desvios por códigos enumerados.
3. Um desvio cria `learning_observation` com `PENDING_HUMAN_REVIEW`.
4. Auditor e responsável operacional classificam a causa.
5. A melhoria proposta recebe requisito, risco, teste e critério de rollback.
6. A mudança é implementada em branch isolada e validada no CI.
7. A aprovação humana promove nova versão; a observação original permanece imutável.
8. O shadow compara a versão nova com o baseline antes de qualquer expansão.

## Estados permitidos

`PENDING_HUMAN_REVIEW → ACCEPTED_FOR_EXPERIMENT | REJECTED | DUPLICATE → TESTED → APPROVED_FOR_RELEASE | FAILED`

Nenhum estado autoriza deploy automaticamente. `autoApplyAllowed` permanece `false` em todas as observações geradas pelo sistema.

## Métricas iniciais

- idade máxima da fila;
- erros de processamento;
- revisões humanas vencidas;
- cobertura de evidência;
- divergência de reconciliação;
- taxa de reenvio idempotente;
- falhas isoladas da ponte;
- tempo entre observação e decisão humana.

Os limites pertencem a uma política versionada no backend. Alterá-los exige PR, testes e registro de decisão.
