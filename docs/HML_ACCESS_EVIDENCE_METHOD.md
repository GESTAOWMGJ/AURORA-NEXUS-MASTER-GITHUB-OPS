# Evidências de acesso HML e seleção do alvo de build

Complemento metodológico ao diagnóstico read-only. Nenhuma alteração de IAM,
infraestrutura, release, instalação ou execução cloud é autorizada por este documento.

## Identidades e estados independentes

| Evidência | O que demonstra | O que não demonstra |
| --- | --- | --- |
| Perfil local configurado | Conta e projeto selecionados no SDK | Autenticação válida ou acesso efetivo |
| Metadata lida | Aquela identidade realizou aquela leitura | Permissão de assinar JWT ou autorização da aplicação |
| Binding presente | Configuração observada para o principal do binding | Acesso de outro principal ou sucesso de todas as operações |
| Permissão testada | Permissão retornada para o chamador no recurso consultado | Autorização de release ou sucesso de uma operação diferente |
| Smoke autenticado aprovado | Operações verificadas na identidade, SHA e horário da execução | Validação automática de um SHA posterior |
| Release autorizada | Decisão vinculada a candidato e ambiente | Substituição das evidências técnicas |

O mínimo IAM do smoke de autenticação existente inclui:
- `firebase.clients.list` no projeto para descobrir a WebApp;
- `firebase.clients.get` para obter sua configuração;
- `iam.serviceAccounts.signJwt` na service account usada para assinar o custom JWT.

Essas permissões devem ser avaliadas com a identidade executora do workflow.
`testIamPermissions` retorna permissões do chamador; consultar com uma conta
local não avalia automaticamente a service account usada pelo GitHub.

Falha de impersonação local não demonstra que a identidade executora falhe
pelo caminho WIF. Não conceder acesso ao PC apenas para obter essa prova.
Usar o caminho de autenticação existente e conservar `UNKNOWN` quando não for
possível avaliar a identidade correta. Não habilitar APIs de diagnóstico
automaticamente. Falha de consulta também não equivale a permissão ausente.

Verificações read-only não devem assinar JWTs, criar sessões da aplicação,
ler payloads de secrets nem acionar ingestão. Mantêm `releaseApproved=false`.
Logs históricos podem fornecer evidência de execução, sempre com SHA e horário
separados da coleta atual. UID, membership/RBAC e sessão têm contrato próprio.

## Reconciliar PRs já incorporados

Consultar estado, head, commit de incorporação e main antes de alterar a branch.
Após squash, divergência histórica pode coexistir com conteúdo idêntico.
Comparar os blobs dos arquivos modificados antes de reaplicar qualquer patch.
Um PR já mergeado não pode ser tratado como draft aberto; eventual acompanhamento
deve ser um novo draft sobre a main corrente, preservando a história anterior.

## Confrontar diretório de build e componente

A raiz deste repositório reúne vários componentes. O portal é descrito por
`firebase-migration/firebase.json` e usa Hosting + Functions. A API Python
fica em `firebase-migration/api`; sua entrada declarada em `pyproject.toml`
é `wmgj_api.app:app`.

Buildpacks devem receber o diretório do componente escolhido e um entrypoint
compatível. Para a API ASGI, a configuração a revisar é:
- contexto: `firebase-migration/api`;
- entrypoint: `uvicorn wmgj_api.app:app --host 0.0.0.0 --port $PORT`.

Essa API não substitui o portal Firebase. Um entrypoint artificial na raiz não
corrige a seleção de componente. Se o build usa configuração inline de um trigger,
um arquivo novo no repositório não altera essa configuração por si só.

Falha de detecção ou de entrypoint é distinta de falha IAM. O texto genérico do
lifecycle sobre builder não deve substituir a causa fatal explícita do log.

## Validação e incorporação ao método

Reutilizar os testes de contrato em `scripts/tests/test_hml*.py` e o workflow
`validate-hml-auth-contract.yml`. Rodar apenas as verificações necessárias aos
arquivos alterados; não repetir deploy para coletar evidência de leitura.

Aprendizado AURORA-MO-001/M08/M09/M10: associar a cada conclusão identidade,
recurso, operação, SHA, horário e limite de evidência. Diagnóstico documental
não promove o estado do runtime, do Release Cockpit ou da release.

Rollback desta alteração: reverter somente este documento.

Fontes oficiais:
- https://firebase.google.com/docs/projects/cloud-audit-logs
- https://docs.cloud.google.com/resource-manager/reference/rest/v1/projects/testIamPermissions
- https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/testIamPermissions
- https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt
- https://docs.cloud.google.com/docs/buildpacks/python
