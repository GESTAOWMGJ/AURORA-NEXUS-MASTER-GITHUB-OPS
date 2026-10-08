# AURORA — interrupção e retomada da ingestão em HML — 07/10/2026

## Resultado comprovado

Ensaio executado no Windows físico Xeon e no backend HML existente, via HMAC v2.
Nenhum servidor foi reiniciado: somente subprocessos criados pelo ensaio foram encerrados.
A mesma chave idempotente e o mesmo corpo foram preservados em cada operação lógica,
com nonce HMAC novo em cada tentativa.

1. Encerramento antes do envio: nenhuma entidade persistida.
2. Envio real ao cloud; confirmação independente da gravação no Firestore; encerramento
   abrupto do subprocesso antes de ler a resposta ou salvar recibo local.
3. Retomada com duas tentativas simultâneas da mesma operação: HTTP 200/200,
   ambas com `accepted=false` e `duplicate=true`.
4. Segunda operação sintética, com duas primeiras tentativas simultâneas:
   HTTP 202/200; uma aceitação e uma duplicidade.
5. Em cada uma das duas operações: **uma entidade canônica, um registro de
   idempotência e um evento de auditoria de negócio**. A entidade da operação
   interrompida permaneceu idêntica depois das retentativas, inclusive updateTime.

Isso comprova deduplicação transacional da ingestão HMAC no backend publicado.
Solicitações HTTP concorrentes foram efetivamente executadas; não há prova de
exclusão entre executores cloud/Xeon, transferência de carga ou failover distribuído.

## Evidência vinculada

- Inspeção do código: `cce30d2b8f5c87a0fe2664426df5e0c550ba1400`.
- Projeto HML consultado e confirmado ACTIVE: `wmgj-hml-jfn-20260927`, número `299889357292`.
- Organização confirmou HOMOLOGATION/SHADOW, sourceMutation=false,
  productionMutation=false e clinicalSensitiveEnabled=false.
- Função: `ingestWmgjEvent`, revisão `ingestwmgjevent-00001-viz`.
- Atualização informada pelo provedor: `2026-10-03T15:09:42.124157770Z`.
- Script executado SHA-256: `7c2ca55aabb2c73e9592e03c9c06053c0d87899921ed322a18d6bff90b6966a5`.
- Recibo privado SHA-256: `97e5c174d2897aa82bf4816663ba0b4e4fede8cccda7bf2a1a72e4542e9d594d`.
- [Recibo sanitizado](evidence/AURORA_HML_INTERRUPTION_RESUME_20261007.json).

Horário do recibo no dispositivo: 2026-10-08T00:09:48.444072Z
(07/10, 21:09 de Brasília). Carimbos independentes de gravação no Firestore:
2026-10-08T00:11:03.019496Z e 00:11:06.334845Z (07/10, 21:11 de Brasília).
Os relógios diferem; a ordenação do commit usa os carimbos do servidor,
não uma equivalência presumida entre relógios.

## Divergência de implantação comprovada

O backend publicado não gravou `revision` nem registros `entityVersions` para
as amostras. O código inspecionado na main cria revisão e versão imutável na
transação. Portanto, `currentIngestionContractVerified=false`.

Uma primeira tentativa aplicou o critério estrito de versão atual e registrou
`EXACTLY_ONE_EFFECT_NOT_VERIFIED`. A consulta independente confirmou uma entidade,
um registro de idempotência, uma auditoria e zero versões imutáveis. O código de
erro não significava duplicação comprovada: a lacuna era o contrato de versão.
A ferramenta passou a registrar separadamente deduplicação observada no backend
legado e aceite do contrato atual; não promove o legado a contrato atual.

## Escopo e proteção da operação

A credencial HMAC já configurada na função foi usada no seu escopo existente
`invoice`; não foi emitida/rotacionada chave nem ampliado IAM. Nenhuma credencial
foi gravada em código, artefato, argumento de processo ou log.
O token AURORA_INTEGRATION_TOKEN do transporte moderno continua ausente no Xeon:
o ensaio HMAC não comprova autenticação da API `/api/integration/documents`.

As notas sintéticas têm valor zero, competência 2099-12, `is_test=true`,
`PENDING_EVIDENCE`, classificação INTERNAL e nenhuma pessoa identificada.
O motor exclui registros `is_test` dos indicadores.
Duas operações pertencem ao ensaio concluído; uma amostra da tentativa estrita
anterior foi preservada com sua trilha. Há três amostras de teste distintas,
cada qual com um efeito por chave; isso não é duplicação da mesma operação.
Nenhum pagamento, fechamento, distribuição, deploy ou carga real foi executado.

## Reprodução

Executar no Xeon ou no runner autorizado, com gcloud já autenticado:

```powershell
python scripts/test_hml_interruption_resume.py
python scripts/test_hml_interruption_resume.py --execute --gcloud "<gcloud.cmd configurado>" --output "<novo recibo em diretório privado existente>" --source-sha "<SHA de inspeção de 40 caracteres>"
```

O modo padrão somente imprime o plano. O modo explícito testa duas operações
sintéticas no projeto HML fixo, confere guardrails, consulta a versão do segredo
configurada na função e não segue redirecionamento.
Não repetir para dados reais ou outros ambientes.

Os testes offline do verificador cobrem rejeição de efeito/auditoria duplicada,
segunda revisão, falta de idempotência, ausência do marcador sintético, alteração
por retry, rollout parcial de versão e separação do legado. Incluem encerramento
real de subprocesso próprio antes do envio. Dez testes passaram no Xeon.

## Gates remanescentes e próxima ação verificável

- **Atualização da ingestão HML:** publicar a implementação validada de
  `ingestWmgjEvent` pelo fluxo existente; repetir o ensaio e exigir
  `revision=1`, exatamente uma `entityVersions` e
  `currentIngestionContractVerified=true`.
- **Exclusão cloud/Xeon:** adquirir lease na memória canônica e validar fencing
  no commit. Pausar o dono, permitir expiração/transferência, retomar o dono antigo
  e comprovar sua rejeição, com somente um efeito persistido pelo dono vigente.
  O lease de operações de perfil em `auroraUserProfiles.ts` e o watchdog de
  `runtimeLocks` não comprovam lease de processamento pesado.
- `distributedExecutorLeaseFencingVerified=false`,
  `cloudXeonFailoverExecuted=false`, `fullDistributedAcceptance=false`.
  Nenhuma aprovação de instalação integrada ou produção decorre deste ensaio.

O teste é uma ferramenta de validação, sem executor permanente ou infraestrutura
nova. Reversão do patch: revert do commit. Registros sintéticos e auditoria são
preservados; não reverter removendo fontes ou apagando histórico.
