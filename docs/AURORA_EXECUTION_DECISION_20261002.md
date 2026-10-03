# AURORA NEXUS — decisão de execução HML

Estado: PREPARED_NOT_AUTHORIZED. Sistema-mãe AURORA NEXUS; piloto WMGJ Operação.
Baseline verificada: main `ee4d274bf27e36b293f2043fe2d4d818ea965c3d`.

## Sequência concreta

1. Revisar o SHA final do PR #98 e os cinco checks; não reutilizar CI de SHA
   anterior. Os três alertas CodeQL encontrados nesta revisão dizem respeito a
   expressões regulares de URLs em testes estáticos. As verificações foram
   convertidas em comparações literais do código-fonte; aguardar novo scan.
2. Aprovar separadamente a integração da candidata e a publicação HML. Atenção:
   integrar arquivos `src/*.gs` ou `tools/*.sh` na main aciona o workflow
   `Deploy Apps Script WMGJ`. A aprovação de merge precisa incluir essa
   publicação automática HML; não é uma operação apenas documental.
3. Implantar a versão corrigida das Functions pelo fluxo HML protegido e
   comprovar os gates abaixo. O RC1.1 não publica Functions; publicar apenas
   Hosting/Rules não leva as correções de política e cálculo ao backend.
4. Só após comprovar runtime, recuperação, identidade e escopo, finalizar uma
   request v6 em mudança separada. O modelo inativo está em
   `docs/requests/aurora-rc11-v6.candidate.json`, fora dos paths de disparo.
   `approvedBaseSha` deve ser o primeiro pai real do futuro commit da request,
   após a integração/implantação aprovadas; não antecipar esse SHA.
5. Aprovar o run novo no ambiente protegido, com a versão e os efeitos abaixo
   visíveis. O run antigo `37073345505` não valida esta candidata e não deve ser
   aprovado nem reexecutado.

## Escopo da futura execução RC1.1 (não executado)

Restauração real para banco temporário HML e cleanup desse banco; verificação do
runtime existente; deploy Hosting/Rules/indexes; configuração da ponte Apps
Script; eventual cópia autorizada da chave HMAC existente para a ponte (sem
criar/alterar Secret Manager); envio limitado ao par fiscal/bancário já previsto;
reconciliação, projeção SHADOW e kill switch. Cada efeito exige aprovação
específica da request. Nenhum backfill genérico, produção, fonte ou dado clínico.

O modelo mantém todas as aprovações como false, data/SHA ausentes e
`candidateOnly=true`. O executor exige `candidateOnly=false`, confirmação literal,
request v6 nova, SHA do primeiro pai e tentativa inicial. Copiar o modelo sem
revisão não autoriza execução.

## Gates e bloqueadores reais

| Gate | Evidência atual | Próxima ação / aceite | Responsável sugerido |
| --- | --- | --- | --- |
| Código | CI no PR; aprovação humana pendente | cinco checks e revisão no SHA final | mantenedor/revisor |
| Billing/orçamento | desconhecido nesta sessão | comprovar billing e orçamento/alertas sem mutação | administrador HML |
| WIF/service account | execução anterior; configuração atual não revalidada | identidade e menor privilégio confirmados no run protegido | cloud/IAM |
| Secrets/API | desconhecido nesta sessão | existência, versão habilitada e acesso estritamente necessário; allowlist somente metadados nesta revisão | cloud/IAM |
| Usuário/membership/MFA/App Check | não comprovado na candidata | smoke real autorizado; nega anônimo e outro tenant; valida MFA | QA/segurança |
| Rules e runtime | emulador aprovado; deploy da candidata pendente | comprovar backend corrigido e Rules efetivamente publicados | backend |
| Backup/restore | evidência histórica; validade atual pendente | backup READY recente e restore reconciliado antes da amostra | operações |
| Proteção GitHub | main retornou protected=false em leitura | revisão do administrador e required checks antes de promoção; não alterar permissões automaticamente | administrador GitHub |
| DNS/HTTPS/SSL | pendências da issue #32, sem nova inspeção neste patch | evidência atual dos destinos autorizados | infraestrutura |
| iMac | cadastro/despacho não comprovam execução | PR #95 atualizado, diagnóstico local, teste nativo e rollback | desktop/titular |

Não há gcloud autenticado ou API Firebase administrativa disponível neste
ambiente de execução. Isso impede verificar gates cloud atuais por leitura;
não prova falta de recurso. O smoke real e o ensaio Mac precisam devolver
resultado verificável. Não registrar credenciais, e-mails, dados clínicos ou
links privados no PR.

## Limites de aceite

CI, revisão de código, implantação, instalação local, ingestão real e release
comercial são estados separados. Boot patcher multiplataforma, App Check ponta a
ponta e instalação nativa continuam sem comprovação de execução. Não promover
essas capacidades por existência de contrato, documentação ou disparo remoto.
