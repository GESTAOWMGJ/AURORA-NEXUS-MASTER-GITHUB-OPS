# PR #124 — reconciliação e compatibilidade com ingestão versionada

## Candidato e base

- Head observado: `1d1d25ceb63819cc69c4facb5c2e4cce6959d5e9`, sucessor de `dcf1a0f74566f4b6523fab510aed961bfd2b9ba3`.
- O head observado já incorporava o PR #123 (`4542ce89d202add403c62cd50f3b8679d80ebcdc`) e o #125 pela base `52fb02862e31920d558733d99356e627b4109fd7`.
- Base desta reconciliação: `a345c361ef2ac09d3c9bfe8c9a47dab6186d098b`, incluindo #126, #127 e #131. O #131 atualizou somente o request HML existente.
- Integração sem conflitos textuais; preservar histórico da branch, sem reescrita forçada.
- Manter draft. Esta alteração não autoriza nem executa merge do PR, deploy, ingestão real ou aprovação de ambiente.

## Contrato semântico verificado

| Fronteira | Evidência e comportamento |
| --- | --- |
| Ingestão → entidade corrente | `index.ts` mantém revisão canônica monotônica independente de `sourceVersion`; atualização Sheets pode manter `sourceVersion: 1` e avançar `revision`. |
| Entidade → histórico | `entityVersions` usa ID por entidade/revisão, `tx.create`, hashes e snapshot; histórico permanece backend-only. Código de ingestão, idempotência e Rules idênticos à main reconciliada. |
| Entidades → projeção | `readProjectionSource` lê apenas sete coleções correntes. `entityVersions` não entra nos agregados financeiros. `sourceHash` cobre também revisão e metadados da fonte. |
| Projeção → mestre | Envelope persistido mantém `schemaVersion: 2`, versão de política, `snapshotId` e `sourceHash`. A versão 1 do documento ingerido não é confundida com a versão do snapshot agregado. |
| Correção → recomendação | Projeção nova usa o valor corrigido uma vez; snapshot anterior permanece no histórico. O motor conserva a proveniência da projeção consumida. |
| Governança | Snapshot revogado/vencido bloqueia inferência. Nenhum comando do mestre autoriza escrita ou distribuição. |
| Hosting | A rota do mestre permanece no deploy protegido existente. As correções de inventário e reparo dinâmico do #126/#127 são preservadas. |

Não foi necessária mudança adicional no algoritmo de ingestão ou no planejador. A reconciliação acrescenta teste comportamental da fronteira entre ambos.

## Regressão adicionada

`aurora-master-versioned-projection.test.ts` executa o leitor/gravador real de projeção e o planejador real, substituindo apenas o SDK Firestore por um double local que restringe caminhos e escritas. Fixtures exclusivamente sintéticas.

1. Envelope persistido é aceito pela governança e mantém os identificadores de proveniência.
2. Correção de 10.000 para 6.000 centavos na revisão 2 elimina a diferença de 4.000 centavos sem somar versões.
3. Fonte canônica inalterada mantém hash e recomendações.
4. Mudança de revisão/proveniência com mesmo valor altera o hash.
5. Snapshot revogado ou vencido não chega à inferência financeira.

O double não comprova atomicidade ou IAM reais, nem simula a aceitação HTTP/HMAC da ingestão. Os testes existentes de ingestão, idempotência, Rules e criptografia continuam gates independentes.

## Verificação local

- Build TypeScript completo: aprovado.
- Suíte Functions: 348 testes, 346 aprovados; dois testes de parser YAML não executaram por ausência do binário Ruby no ambiente local (`spawnSync`, status nulo). Não foram pulados nem alterados para produzir aprovação.
- Nova regressão: seis testes aprovados, incluindo o teste pai.
- Contrato HML: 12 testes aprovados, com 21 workflows, 105 blocos shell e 12 passos críticos únicos.
- Contrato Hosting: sete testes aprovados.
- YAML e shell dos dois workflows afetados também cobertos pelo validador Python acima.
- `git diff --check`: aprovado.

CI deve ser consultado no commit publicado desta reconciliação; checks do head anterior não são evidência para o novo candidato. Quando o checkout usar o merge ref do PR, conferir sua árvore contra a do head final.

## Limites e rollback

Esta tarefa não alterou requests HML em relação à main, dados cloud, segredos, permissões ou ambientes. Os requests incorporados são histórico da main, não novas solicitações desta branch. Nenhum gate HML foi liberado.

Enquanto draft, rollback é retornar ao head anterior por um novo commit revisado, preservando histórico. A base implantada permanece independente desta reconciliação. Não apagar versões, snapshots ou auditoria.
