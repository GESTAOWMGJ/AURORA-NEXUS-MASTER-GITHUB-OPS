# Provisionamento controlado do Firebase de homologação WMGJ

**Ambiente permitido:** `HOMOLOGATION`  
**Produção:** explicitamente fora do escopo  
**Execução:** terminal local interativo no Mac autorizado

## Objetivo

Criar uma infraestrutura Firebase separada para validar a integração WMGJ sem trocar a fonte oficial, sem alterar a planilha-mestre e sem ativar dual-write ou leitura produtiva.

A operação continua obedecendo à cadeia:

```text
documento-fonte → captura → hash/idempotência → fila → extração →
classificação → validação → projeção Firestore → auditoria → revisão humana
```

## Launcher

Arquivo versionado:

```text
firebase-migration/scripts/PROVISIONAR_FIREBASE_HOMOLOGACAO.command
```

No Mac já preparado pelo instalador WMGJ:

```bash
cd ~/WMGJ_OPERACAO/repo/automacao-gestao-wmgj
git fetch origin main
git checkout main
git merge --ff-only origin/main
chmod 700 firebase-migration/scripts/PROVISIONAR_FIREBASE_HOMOLOGACAO.command
bash firebase-migration/scripts/PROVISIONAR_FIREBASE_HOMOLOGACAO.command
```

O launcher não pode ser usado pelo TRIGGERcmd: exige `stdin` e `stdout` ligados a um TTY local, autenticação no navegador e duas confirmações literais.

## Recursos criados somente no projeto HML

1. Project ID obrigatório com prefixo `wmgj-hml-jfn-`.
2. Labels `environment=homologation`, `system=wmgj`, `data_scope=nonclinical` e `managed_by=jfn`.
3. Vínculo explícito a uma conta de faturamento selecionada localmente.
4. Orçamento mensal de alerta no valor 100, na moeda da conta, com limiares de 50%, 80% e 100%.
5. Cloud Firestore Native `(default)` em `southamerica-east1`, com delete protection habilitada.
6. Security Rules e índices versionados.
7. Functions v2 `ingestWmgjEvent`, `runtimeHealth` e watchdog, conforme a fundação validada.
8. Secret Manager `WMGJ_INGEST_HMAC_KEYRING`, sem imprimir ou versionar o segredo.
9. Documento `organizations/wmgj`, com `environment=HOMOLOGATION` e `clinicalSensitiveEnabled=false`.
10. Política TTL solicitada para `requestNonces.expiresAt`.

O orçamento é alerta, não bloqueio automático de gastos. A conta de faturamento continua responsável por custos gerados no projeto HML.

## Travas fail-closed

O launcher encerra antes de criar infraestrutura quando:

- não está no macOS;
- é executado como root/sudo;
- não existe TTY local;
- Node 22 ou Java 21+ estão ausentes;
- Firebase, gcloud ou ADC não estão autenticados;
- não existe conta de faturamento aberta;
- o Project ID não começa por `wmgj-hml-jfn-`;
- o ID contém `prod`, `production`, `live` ou `principal`;
- a confirmação literal não corresponde;
- testes locais/Emulator Suite falham;
- orçamento, segredo, Functions, organização ou health check não podem ser comprovados.

## Evidências locais

```text
~/WMGJ_OPERACAO/state/firebase-controlled-provisioning.json
~/WMGJ_OPERACAO/state/firebase-cost-controls.json
~/WMGJ_OPERACAO/state/firebase-deploy.json
~/WMGJ_OPERACAO/state/firebase-org-wmgj.json
~/WMGJ_OPERACAO/state/firebase-ttl-policy.json
~/WMGJ_OPERACAO/state/firebase-homologation-verification.json
~/WMGJ_OPERACAO/state/ESTADO_FINAL_WMGJ_FIREBASE.md
```

Nenhum marcador contém token, chave privada ou segredo HMAC.

## Estado após provisionamento

Mesmo com infraestrutura HML validada, permanecem bloqueados:

- dados clínicos identificáveis;
- `WMGJ_FIRESTORE_DRY_RUN=false`;
- migração com escrita;
- dual-write;
- mudança da fonte oficial;
- fechamento automático;
- decisão médica, financeira, jurídica, contratual ou regulatória.

## Próximo gate

Somente depois do `firebase-homologation-verification.json` apresentar `ok=true`:

```javascript
wmgjFirestoreDiagnostico();
wmgjFirestoreMigracaoDryRun(10);
```

O diagnóstico deve confirmar `dryRun=true`, `sourceMutation=false` e `orgId="wmgj"`. O dry run deve planejar dez registros por aba sem avançar checkpoint e sem alterar a planilha-fonte.

## Regra-mãe

> Nada fecha sem evidência. Nada distribui sem validação. Nada automatiza decisão crítica sem humano.
