# AURORA NEXUS — reconciliação CMEK de produção

Código: AURORA-PROD-CMEK-RECON-001. Versão: 1.0.0. Data: 13/10/2026.
Módulos: M08/M09/M10. Estado: AUTHORIZATION_VERIFIED_CONFIGURATION_UNVERIFIED.
Baseline de leitura: `a89d431c42d79210b48867d59a3cf3153e7153fc`.
Este registro é documental: não é request de execução, política habilitadora nem recibo de implantação.

## Evidência oficial e limites

- Projeto: `wmgj-prod-jfn-20261005`; número contratado: `616997609173`.
- Mensagem Gmail `1a13564c23a0bc33`, remetente Travis Cheung, domínio google.com,
  assunto “Firestore CMEK Access Granted - AURORA NEXUS - INSTITUTO JOAO DE FREITAS”.
- Data do cabeçalho: 13/10/2026 09:12:25 -0400 = 10:12:25 America/Sao_Paulo.
- Corpo integral relido: concessão de acesso ao recurso CMEK ao ID correto.
  Cabeçalhos recebidos registram SPF/DKIM/DMARC pass; não foi feita nova validação
  criptográfica independente das assinaturas.
- [Fonte restrita ao titular](https://mail.google.com/mail/u/?authuser=wmgjltda%40gmail.com#all/1a13564c23a0bc33).
  Preservar a mensagem original; não copiar MIME, assinaturas ou dados pessoais para o corpus genérico.
- A menção condicional a allowlisting organizacional em 1–2 semanas não comprova
  concessão para toda a organização ou qualquer outro projeto.
- O histórico de 02/10 para HML e o candidato incorreto é preservado, mas não
  mantém aberta a pendência de autorização do projeto produtivo correto.

| Controle | Estado nesta reconciliação | Evidência de conclusão ainda exigida |
|---|---|---|
| Acesso ao recurso CMEK no projeto correto | CONFIRMED | e-mail oficial acima |
| Configuração efetiva de banco Firestore | UNVERIFIED | describe live do recurso exato |
| KMS e IAM | UNVERIFIED | key, versões habilitadas, IAM efetivo, rotação, logs |
| Backup/PITR | UNVERIFIED | configuração live e backup READY |
| Restore/integridade | PENDING | operação concluída em banco novo e reconciliação |
| Cutover | NOT_EXECUTED | gates, mudança protegida e readback |
| CLINICAL_SENSITIVE | BLOCKED | todos os controles do documento 37 e promoção humana formal |
| Produção homologada | NOT_ESTABLISHED_BY_THIS_RECORD | evidências próprias do ambiente |

## Inspeção administrativa e próxima coleta

Desktop Commander identificou o nó Windows `LuisScarano` offline e o Mac conectado.
Apenas verificações leves de disponibilidade de CLI ocorreram no Mac:
`command -v gcloud` encerrou com código 1; verificação de executáveis nos caminhos
usuais Homebrew, /usr/local e ~/google-cloud-sdk encerrou com código 0 sem encontrar
gcloud. Nenhuma consulta GCP, login, instalação, leitura de documentos clínicos ou
mutação cloud ocorreu. O ambiente scratch também não expôs gcloud/gh.
Esses resultados não demonstram ausência de SDK em qualquer outro caminho,
ausência de sessão administrativa no Console ou inexistência de recursos.

Responsável: Cloud Security/maintainer de produção. Próxima etapa no executor
existente com acesso administrativo válido: identificar conta e escopo autorizados
sem imprimir tokens; repetir contrato de projeto/número, ACTIVE e billing antes
de qualquer efeito. Coletar metadados, não documentos. Se CLI não estiver disponível,
usar Console/API autenticada permitida; não reutilizar credenciais extraídas do browser.
Recusa, timeout ou resposta incompleta permanecem pendência, sem criação/fallback.

Consultas read-only preparadas (não executadas):

```bash
gcloud projects describe wmgj-prod-jfn-20261005 --format=json
gcloud billing projects describe wmgj-prod-jfn-20261005 --format=json
gcloud firestore databases list --project=wmgj-prod-jfn-20261005 --format=json
# Para cada ID retornado, inclusive (default), com argumento exato:
gcloud firestore databases describe --project=wmgj-prod-jfn-20261005 --database=DATABASE_ID --format=json
gcloud kms keyrings list --project=wmgj-prod-jfn-20261005 --location=southamerica-east1 --format=json
# Repetir a coleta na localização real e no projeto KMS declarado pelo cmekConfig:
gcloud kms keys list --project=KMS_PROJECT --location=LOCATION --keyring=KEYRING --format=json
gcloud kms keys describe KEY --project=KMS_PROJECT --location=LOCATION --keyring=KEYRING --format=json
gcloud kms keys versions list --key=KEY --project=KMS_PROJECT --location=LOCATION --keyring=KEYRING --format=json
gcloud kms keys get-iam-policy KEY --project=KMS_PROJECT --location=LOCATION --keyring=KEYRING --format=json
gcloud firestore backups schedules list --project=wmgj-prod-jfn-20261005 --database=DATABASE_ID --format=json
gcloud firestore backups list --project=wmgj-prod-jfn-20261005 --location=LOCATION --format=json
```

Conferir nome do banco, locationId, type/edition, cmekConfig.kmsKeyName,
todas as activeKeyVersion, deleteProtectionState, pointInTimeRecoveryEnablement
e janelas de recuperação. Validar a chave no projeto/localização do recurso completo,
purpose ENCRYPT_DECRYPT, versões usadas ENABLED, rotação e permissões herdadas.
A chave de Firestore deve ser distinta da KEK de envelope da aplicação.
Verificar service agent do projeto correto
`service-616997609173@gcp-sa-firestore.iam.gserviceaccount.com`,
papel encrypter/decrypter no menor escopo da chave, acesso administrativo com MFA,
políticas efetivas e Cloud KMS Data Access/Audit Logs. Não declarar menor privilégio
pela leitura isolada do binding da chave.

Guardar saída sanitizada em trilha restrita com horário, identidade técnica,
resource names, SHA, código de saída/erro, hash e localizador. Nunca tokens,
segredos, ciphertext de paciente ou dumps de dados no GitHub.

## Decisão sobre banco separado

A necessidade concreta depende da inspeção, ainda pendente:

1. Banco existente com Google-managed encryption: **banco novo com CMEK necessário**.
   Não há conversão in-place. Preservar (default) e qualquer banco fonte.
2. Banco CMEK já existente com chave/localização válidas: inspecionar e reutilizar
   se todo o contrato e controles forem comprovados; não criar duplicata por inferência.
3. Nenhum banco existente, comprovado por consulta autorizada completa: preparar
   banco novo CMEK no projeto correto.
4. Permissão recusada, erro ou inventário parcial: UNVERIFIED, nunca “não existe”.

Nome candidato `aurora-prod-cmek` e região contratada `southamerica-east1` são
**PROPOSED**, sujeitos a disponibilidade, compatibilidade e aprovação do contrato
de banco/chave; não são recursos observados. Banco de migração separado pertence
ao mesmo sistema-mãe, não constitui memória/organismo paralelo.
Não executar o script HML com projeto de produção substituído. Não alterar o
request de produção, deploymentStage, limites clínicos ou workflow para disparar recursos.

## Migração controlada — PROPOSED / NOT_EXECUTED

1. **Inventário e contrato:** identificar fonte, conteúdo elegível, orgId/CNPJ
   validado, destino completo, location/edition, chave, versões e dependências
   (SDKs, Rules, índices, triggers, TTL, IAM, jobs e referências ao default).
   Validar suporte ao banco nomeado e Cloud Run functions 2nd gen; inventariar
   escritores e escolher único proprietário do efeito. Fixar SHA e manifesto.
2. **Recuperação antes da cópia:** capturar baseline de configuração e snapshot
   consistente, backup READY da fonte e retenção aprovada; testar recuperação
   da fonte em destino novo. Definir RPO/RTO, janela, responsáveis e critério de aborto.
   Nenhum apagamento ou sobrescrita de fonte.
3. **Destino:** somente em mudança de infraestrutura protegida, criar/validar
   CMEK e banco novo, delete protection, PITR, Rules deny-by-default, índices,
   IAM e logs; readback do cmekConfig e versões. Começar exclusivamente sintético.
4. **Ensaio sintético:** provar envelope AES-256-GCM/AAD por tenant, idempotência,
   negações cross-tenant, integração do banco nomeado, backup READY, restore
   em outro ID e sentinel. Teste de disable/re-enable somente HML, com chave
   exclusiva do ensaio, sem afetar dependências produtivas e sem destruição.
5. **Método de transferência:** revisar export/import, restore ou clone para
   banco novo CMEK conforme recurso suportado. Não executar cópia indiscriminada
   com dado clínico bloqueado. Exportações requerem bucket restrito, proteção,
   localização e retenção aprovadas; CMEK do Firestore não protege automaticamente
   todos os destinos de exportação. Revisar schema, Rules, índices e triggers
   separadamente; cópia de documentos não comprova paridade desses controles.
6. **Cópia elegível após gates específicos:** usar manifesto por tenant/coleção,
   corte consistente ou pausa controlada dos escritores; evitar dupla escrita.
   Conservar IDs, schemaVersion, sourceVersion, idempotencyKey, envelopes e ledger.
   Backfill em lotes retomáveis, checkpoints e recibos; reconciliar efeitos
   desconhecidos antes de retry. Dados reais e clínicos exigem suas autorizações
   e gates próprios, ainda não satisfeitos por esta reconciliação.
7. **Integridade:** comparar contagens por tenant/coleção, conjunto de IDs,
   hashes canônicos dos campos tipados, referências e invariantes de negócio.
   Definir serialização para timestamps/bytes/geo/reference e critérios por tipo;
   contagem ou amostra isolada não basta. Quando envelope/AAD depender do database,
   testar transformação controlada e round-trip sem publicar plaintext.
   Manifestos/hashes sensíveis ficam restritos, não no corpus genérico.
   Exigir zero divergências sem exceção formal, revisão e evidência.
8. **Backup do destino e restore:** backup READY do banco CMEK, restore em
   banco novo com CMEK explicitamente escolhido e verificado; reconciliar
   sentinel e manifesto elegível integral. Registrar operação, duração, hash,
   localização, KMS, versões e RPO/RTO medidos. Backup agendado não basta.
9. **Cutover protegido:** só após gates técnicos e humanos, snapshot final e
   reconciliação do delta, alterar explicitamente a seleção de banco no mesmo
   runtime; manter um escritor, smoke positivo/negativo, audit trail e rollback.
   Nunca promover CLINICAL_SENSITIVE por sucesso de deploy.
10. **Reversão:** antes do cutover, abortar preservando fonte e recursos.
    Após cutover sem novas escritas, restaurar seleção/baseline comprovada.
    Se houver novas escritas, congelar o escritor afetado, preservar ledger,
    reconciliar delta e decidir recuperação/replay antes de retornar; não perder
    eventos nem reproduzi-los cegamente. Dados clínicos nunca retornam para fonte
    Google-managed: manter bloqueados ou restaurar para banco CMEK homologado.
    Conservar versões KMS necessárias ao banco **e aos backups** até expiração
    da retenção; rotação não elimina a dependência dos backups antigos.
    Não apagar banco, desativar proteção ou destruir chave como rollback.

## Critérios de encerramento e aprendizado

Autorização do recurso: OBSERVED/VERIFIED pela fonte oficial.
Procedimento de migração: PROPOSED, sem execução ou adoção de runtime comprovada.
Pendências: inspeção administrativa, contrato de banco/chave, ensaio sintético,
backup/restore/integridade, gates clínicos, cutover e recibos.
Owner Cloud Security/DR; coletar na próxima janela com executor autorizado online,
antes de qualquer provisionamento/cutover clínico. Sem prazo fictício de conclusão.

Aprendizado abstrato incorporado à fonte mestre AURORA-MO-001:
autorização de recurso ≠ configuração observada ≠ recuperação testada ≠ liberação.
Sem novo scheduler, memória paralela, concessão de privilégios ou treinamento
de pesos. A atualização documental no GitHub não prova carga no Xeon/cloud.
Rollback documental: reverter apenas este incremento, mantendo o e-mail e o
histórico de autorização; não restaurar a afirmação vigente de autorização pendente.
O gate clínico permanece BLOCKED durante toda esta reconciliação.

## Referências

- [Contrato produtivo](38-production-project-contract.md)
- [Gate clínico](37-clinical-sensitive-release-gate.md)
- [Especificação HML e ensaio de chave](35-firestore-cmek-hml-spec.md)
- [Google: CMEK e limitações](https://docs.cloud.google.com/firestore/native/docs/cmek)
- [Google: configurar e verificar CMEK](https://docs.cloud.google.com/firestore/native/docs/use-cmek)
