# AURORA NEXUS — entrega vigente HML AURORA-HML-DELIVERY-20261025-R1

Data do registro: 25/10/2026  
Canal: HML / beta  
Produto: `1.1.0-beta.2`  
Release train: `2026.10`

## Identidade canônica

A referência ativa assinada do produto permanece:

- releaseId: `aurora-1.1.0-beta.2-cd4737ed0421df7ec53fc17d6e16c56443085013`
- sourceSha: `cd4737ed0421df7ec53fc17d6e16c56443085013`
- certificateSha256: `7ab41582c3859d5c33e04c1aa3728e7c5244dad7661774f75f0597d8424838af`
- deploy/release run: `40176332827`
- CI run: `40176039699`
- revisão usada na promoção: PR `#322`, modo `OWNER_DEPLOYMENT_APPROVAL`
- pós-promoção: `POST_PROMOTION_CANONICAL_SMOKE_VERIFIED`
- deviceInstallationVerified: `false`

Essa referência não é substituída pelo registro operacional abaixo. O produto continua `1.1.0-beta.2`.

## Revisão operacional vigente

Identificador: **AURORA-HML-DELIVERY-20261025-R1**

- operationalSourceSha: `602528812bffc443a48a4d52fc115c6ab2af6081`
- correção integrada: PR `#324`
- objetivo: remover falso negativo `PROBE_PUBLISHED_VERSION_MISMATCH` sem afrouxar a verificação de fonte publicada
- Apps Script deploy run: `40193229058` — success
- Apps Script canonical version: `46`
- Apps Script deploymentIdentitySha256: `420af1f0444ef2d4cb7bec67ac12108bf009ce0287498e7232f2226aa702fcf4`
- Apps Script manifestSha256: `4469055628d16e9ba258fc9fece7b0dfd8fb42bc3c3259c9f512c8b8135f1885`
- arquivos Apps Script verificados contra o commit: `30`

## READBACK real associado

Run: `40194120781`  
Job: `121171196410`  
Modo: `DRIVE_TOTAL / READBACK`  
Escopo SHA-256: `d3978b0f743ab22021c586b5d85c731beca34a6c03306609f33e64d512ab19fa`  
Resultado GitHub: `success`  
Resultado Aurora: `READBACK_VERIFIED`

Cobertura:

- total no escopo: **255**
- documentos canônicos: **51**
- aliases: **192**
- pendentes: **12**
- páginas verificadas: **13**
- recibos canônicos verificados: **51**
- alias references verificadas: **192**
- `allReceiptsVerified=true`
- `sourceMutation=false`
- `newSchedulerCreated=false`

Pendências:

- 10 × `AURORA_DRIVE_CONVERSION_FAILED` / `ERRO_REPROCESSAR`
- 2 × `NOT_RECORDED` / `REVISAR_HUMANO`
- mídia: 9 `OTHER`, 1 `GOOGLE_SHEETS`, 1 `ZIP`, 1 `PDF`

Artefato sanitizado:

- GitHub artifact: `aurora-drive-intake-40194120781`
- artifact id: `12598449534`
- artifact digest: `sha256:2f464afa44e7e7bb2fb5be9fb4f41b6e88234580c231374194bccb8003cbb413`

## Estado de entrega

**VIGENTE PARA HOMOLOGAÇÃO CONTROLADA.**

Comprovado:

- produto `1.1.0-beta.2` com referência ativa assinada e smoke pós-promoção;
- Apps Script canônico vinculado ao SHA operacional exato;
- READBACK real do escopo autorizado;
- recibos encontrados e versões imutáveis verificados;
- ausência de mutação de fonte durante o READBACK.

Não comprovado / não liberado:

- `fullSynchronizationVerified=false`;
- `complete=false`;
- `documentReviewRequired=true`;
- 12 itens documentais exigem seguimento;
- produção não está liberada;
- aceite nativo Mac permanece pendente;
- iOS nativo permanece pendente de build/assinatura/distribuição/aceite;
- o READBACK não promove aprovação factual/financeira de documentos.

## Próximo gate

Sanear os 12 itens pendentes e repetir a comprovação de cobertura. Somente depois avaliar processamento adicional e nova promoção de referência ativa, mantendo revisão, CAS, assinatura e smoke no SHA exato.
