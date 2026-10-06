# Registro histórico — PR #167 / checkpoint de produção de 05/10/2026

> **Status:** registro histórico. O PR #167 foi superado pelo PR #168 e não representa o estado operacional corrente. As alterações obsoletas de request e testes do #167 não devem ser mergeadas nem cherry-pickadas.

## Proveniência

- PR de origem: #167 `fix(prod): reconcile validated project request while preserving fail-closed gates`.
- Head histórico: `db15ce3557b26aef90d207cd85d342470266c199`.
- Baseline da `main` usada naquele checkpoint: `67ff80d147c0ea96692becf2adf8f04bc0b3fb8c` (após o PR #160).
- Projeto já identificado no checkpoint: `wmgj-prod-jfn-20261005`.
- Número do projeto: `616997609173`.

## Evidência exclusiva preservada

O #167 registrou um estado **transitório** no qual o ID e o número do projeto foram
preenchidos no request com base na evidência ACTIVE/billing já registrada pelo
PR #160. **Não houve nova consulta GCP** nessa reconciliação.

Naquele momento histórico:

- `confirmation=null`;
- `status=BLOCKED_PROJECT_NOT_VALIDATED`;
- o desired-state ainda mantinha ID/número de produção nulos;
- WIF, service account, secrets próprios e proteção do environment ainda não eram
  declarados prontos por esse patch;
- não foram alterados workflow, validador, bootstrap, IAM, secrets, environment,
  HML, DNS, fallback ou flags operacionais pelo #167;
- nenhum workflow produtivo foi disparado por esse patch.

A validação local registrada no #167 informou **11 testes Python de contrato** e
**9 testes estáticos de provisionamento** aprovados. O teste de contrato utilizou
mocks e verificou zero chamadas externas enquanto o contrato permanecia bloqueado.
PowerShell não estava disponível naquele executor local; portanto esse resultado
não comprovava implantação nem recursos produtivos.

## Superação pelo PR #168

O PR #168 foi posteriormente mergeado como
`1d4721935e75d0000c336e47868194d1bc8439f7` e substituiu legitimamente o estado
transitório acima por:

- `confirmation=PROVISION_EXISTING_PRODUCTION_PROJECT`;
- `status=READY_FOR_PROVISIONING`;
- ID/número promovidos também ao desired-state;
- novo checkpoint documental de bootstrap autorizado.

Por isso, somente esta evidência histórica documental foi preservada. Os trechos
do #167 que alteravam o request e os testes para exigir o estado bloqueado foram
deliberadamente excluídos da integração.

## Estado da main no arquivamento

Este registro foi criado sobre a `main`
`d5ee92b4e482657347b02ac024a0e9174f160f6a` (PR #169 já integrado), sem
reverter ou modificar o contrato produtivo promovido pelo #168.
