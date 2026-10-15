# AURORA CMEK ? autorizacao produtiva e saneamento de recuperacao

Data: 15/10/2026. Baseline: `a27d60628672df2acfffe182df751532e575c3ab`.
Fonte reaproveitada: PR #99, `ea3cc1985d869799d8570f8f3d63b05d2d19e038`.

## Autorizacao

O titular autorizou producao/CMEK e o saneamento autonomo das pendencias validas em 15/10. Registro direto no comentario 6197336877 do PR #99 e na politica `cmek-production-owner-authorization-20261015.json`. Nao repetir pedido de consentimento generico no mesmo escopo. Essa autorizacao nao e review independente, aprovacao de run futuro ou homologacao tecnica.

Preservar `(default)`, dados clinicos, flags, identidades, historico e controle de acesso. Nao destruir chaves nem realizar teste de indisponibilidade em producao. O executor HML continua restrito a `wmgj-hml-jfn-20260927` e `aurora-hml-cmek`; `productionMutation=false` permanece nele. A futura adocao produtiva e `wmgj-prod-jfn-20261005`, em banco novo com chave propria e gates comprovados.

## Evidencia operacional anterior, nao reexecutada por este patch

Coleta de 15/10, 13:23-13:25 Brasilia: CMEK HML existente desde 03/10, versao 1 ENABLED, PITR, protecao contra exclusao, backup diario/14 dias, 11 backups READY, sentinela sintetico HTTP 200 e logs KMS de Encrypt/Decrypt. Producao com `(default)` sem cmekConfig. Registros brutos permanecem privados no tenant autorizado. Nao se usa CI como prova desses recursos.

## Saneamento realizado no codigo candidato

- Reaproveita as correcoes do PR #99 sobre a main corrente, sem arrastar suas alteracoes antigas de governanca nem fechar o historico.
- Corrige o grupo CLI real para `gcloud kms keys versions`: o SDK instalado rejeitou `gcloud kms versions` no help local. Atualiza mocks e controles de operacoes proibidas.
- Exige backup READY do banco fonte com UID correspondente. Restore exige fonte correta, regiao, CMEK, conclusao, delete protection, PITR e campos completos do sentinela iguais.
- Aguarda a conclusao de restore antes de aplicar protecoes exclusivamente ao banco auxiliar novo. Tempo esgotado/readback indisponivel nao vira sucesso.
- Exige erro HTTP 400/FAILED_PRECONDITION especifico de CMEK; auth/rede/JSON invalido nao provam indisponibilidade. Reabilita antes de classificar a falha.
- Reabilitacao deve ter sucesso, versao precisa estar ENABLED e leitura deve recuperar todos os campos. Falha nao e suprimida. Ausencia de propagacao retorna 33; resposta inesperada retorna 35.
- Preserva os payloads finais de falha/recuperacao nos artefatos em vez de remove-los; nao inclui tokens.
- Separa autorizacao produtiva do titular e prova tecnica; nenhuma flag clinica e promovida.

## Validacao e gates ainda abertos

Sintaxe Bash e validador de baseline aprovados no Xeon. A suite estatica inicial teve 6 testes aprovados antes do ajuste final do grupo KMS. Resultados do SHA final e CI devem constar no PR; nao atribuir resultados iniciais automaticamente ao SHA final.

Permanecem gates antes de teste mutavel/cutover: revisao aplicavel do SHA, aprovacao efetiva do ambiente quando exigida, IAM do runner, inventario completo dos dependentes da chave, backup/restore real e recuperacao real. O inventario KMS estava indisponivel (API desabilitada) e ha acesso herdado de decryptor a revisar, sem revogacao cega. A verificacao da lista de bancos no script delimita apenas Firestore no projeto HML e NAO certifica exclusividade global da chave.

Nenhum ensaio de falha deve iniciar enquanto o impacto fora do namespace sintetico nao estiver resolvido. O novo registro de autorizacao nao desabilita essa condicao e nao permite bypass de seguranca do conector.

Nenhum comando cloud mutavel, restore, disable/enable de chave, cutover ou merge foi executado por este patch. Nao habilita um scheduler ou executor autonomo recorrente.

## Retorno e aprendizado

Se a candidata falhar em CI, corrigir na mesma branch. Reverter os arquivos deste incremento apenas por PR controlado, sem apagar evidencias. O aprendizado reutilizavel e: diagnostico deve usar o grupo CLI real, mocks nao podem validar comando inexistente, consentimento nao equivale a prontidao e backup deve estar ligado ao UID. Registro persistido no mesmo repositorio; nenhuma alegacao de treinamento de pesos ou implantacao do motor.
