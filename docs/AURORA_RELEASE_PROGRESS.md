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

## Incremento candidato — reconciliação CMEK 02/10/2026

- Baseline: `ee4d274bf27e36b293f2043fe2d4d818ea965c3d`; branch/PR draft, sem merge/deploy/apply.
- Acesso Firestore CMEK HML: EXTERNALLY_CONFIRMED, Gmail `1a0fd2f51798e6ef` (02/10/2026), somente `wmgj-hml-jfn-20260927`.
- CMEK operacional: PENDING_HML_VERIFICATION. Exigir banco `aurora-hml-cmek`, cmekConfig/versões ativas, backup READY, restore/sentinel e falha/recuperação de chave. CLINICAL_SENSITIVE permanece BLOCKED.
- Produção: candidato `aurora-nexus-prod-wmgj`, não reconhecido pelo Google na resposta. Request bloqueado até validação de projeto existente e autorização explícita; workflow somente manual; bootstrap não cria projeto.
- Validação: testes locais e CI devem ser vinculados ao SHA final; nenhum resultado HML ou de produção é inferido.
- Próximo gate: consulta autenticada read-only do banco HML e projeto de produção; depois planejar execução HML separadamente autorizada.
- Rollback: reverter o commit do patch em PR revisado; não remover os bloqueios em operação sem reconciliação da evidência.

### Evidência complementar — 03/10/2026

- Main reconciliada: `5dcaddc88b27b54a7f24f9042b05e9799205fb1a` (PR #109). Nenhuma alteração do request RC1.1 nesta reconciliação.
- Consultas Cloud Shell fornecidas pelo titular, identidade `wmgjltda@gmail.com`: `aurora-hml-cmek` e a CryptoKey prevista retornaram NOT_FOUND; duas listagens KMS em `southamerica-east1` retornaram `[]`. A lista de seis bancos não contém `aurora-hml-cmek` nem apresenta cmekConfig. Acesso ao recurso concedido pelo Google não equivale a provisionamento.
- Cinco backups READY pertencem a `(default)`, snapshots de 29/09 a 03/10/2026. `(default)` tem schedules de backup e PITR habilitados, retenção de 604800s e proteção contra exclusão.
- Quatro destinos de restore listados têm sourceInfo.progress COMPLETED; `rc11-restore-37093409122-4` estava IN_PROGRESS. Conclusão do provedor não comprova reconciliação dos dados ou restore CMEK. Não remover destinos nem alterar proteção contra exclusão neste patch.
- Produção: describe retornou falta de permissão ou possível inexistência; não permite afirmar inexistência atual. ID continua candidato não validado e bloqueado.
- HMAC: job `111225779429` do run `37093409122` falhou no probe com HTTP 401 / RC11_HMAC_INVALIDO (saída 73). PR #109 corrige interpretação da chave hexadecimal para 32 bytes em paridade com o backend; deploy Apps Script `37132639621` foi aprovado. Hipótese de segredo antigo não comprovada. Correção implantada não equivale a probe HML aprovado.
- Na consulta de acompanhamento, job `111230961385` da tentativa 4 estava em restore; probe HMAC, ingestão, reconciliação e inteligência nativa ainda pendentes. Não disparada nova tentativa neste trabalho.
- CMEK permanece PENDING_HML_VERIFICATION; banco, cmekConfig, versões de chave, backup/restore CMEK e falha/recuperação da chave não comprovados. Nenhum apply, recurso cloud, merge ou deploy executado por este patch.

### Correção de provisionamento KMS — 03/10/2026

- Apply autorizado pelo titular iniciou em Cloud Shell; APIs/identidade de serviço avançaram, criação da CryptoKey falhou com INVALID_ARGUMENT: next_rotation_time obrigatório para rotation_schedule. Banco CMEK não comprovado.
- Executor agora fornece primeira rotação em RFC3339 UTC, 90 dias após execução, junto do período de rotação. Compatível com date GNU/BSD. Teste offline captura argumentos reais de criação e interrompe antes de IAM/banco; não chama GCP.
- Retomada somente no SHA corrigido; PENDING_HML_VERIFICATION permanece até provas operacionais completas.
