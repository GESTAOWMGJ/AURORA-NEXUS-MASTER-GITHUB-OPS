# AURORA NEXUS — índice da identidade registral

Chave do sistema-mãe: **JFN-AUD-GOV-001**. Data da indexação: **04/10/2026**.
Fonte estruturada: `aurora-nexus-index.json`.

## Vínculo com o projeto-base

O projeto-base `GESTAOWMGJ/automacao-gestao-wmgj` passou a se chamar `GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS`. O ID GitHub **1224492398** é o mesmo. A indexação preserva essa continuidade e o dossiê registral existente no **PR #23**, sem criar outro produto ou depósito.

A main observada na indexação é `5c868deaeafa76dbdcf6cfb093a5a68f19eb5269`. Esse SHA identifica a base de engenharia examinada; não é número de processo INPI nem hash do objeto registral.

## Chaves documentais preservadas

### Base — 1.0.0-RC1

Arquivo: `AURORA_NEXUS_REGISTRATION_SOURCE_v1.0.0-RC1.txt` — **29.405 bytes**.

SHA-512:
```text
cc1ff31d2985acb43b5ba94a3ff3309df8909b71c57ea2ffdd68140050720f3ec52cd01675432428aa99657c0b96cef4113361ac108130b9c553da9f461e3df4
```
SHA-256:
```text
c35ae4857b0b5aa86aa1bb32cb77dd85a96aeda73a680ec41eb0a3957cf2da9d
```

### Adendo — 1.0.1-SCOPE-ADD

Arquivo: `AURORA_NEXUS_REGISTRATION_SOURCE_1.0.1-SCOPE-ADD.txt` — **35.423 bytes**.

SHA-512:
```text
986c1509121c923d4d3b5a3685649ca0099b2191452ca6d69a2b07b4761689ecf83c3f2ccaaaca2dc086e330d2d2fd7b8276000357c23920929f0a4e1561cac6
```
SHA-256:
```text
39688c82dc5ae919f0cae19f0e50673c55cac4864cc3bf99860e975d5c8a2759
```

Os dois arquivos originais foram relidos em bytes. Tamanhos, SHA-512 e SHA-256 conferem com o manifesto preservado. O conteúdo da base está integralmente contido no adendo, byte a byte. Nenhum arquivo registral foi reformatado ou regenerado. O adendo não substitui retroativamente o hash da base. O arquivo efetivamente depositado no INPI só será identificado mediante vínculo com o protocolo/certificado correspondente.

## Titularidade e London Marcas

**JF NETO SERVIÇOS MÉDICOS LTDA** é a titular indicada no dossiê e a outorgante na procuração. **JOÃO DE FREITAS NETO** é o responsável pelo projeto e representante da outorgante identificado no documento. A procuração à **LONDON MARCAS & PATENTES S/S LTDA** está datada de 21/09/2026 e acompanhada de relatório de assinatura de 23/09/2026. O original é restrito; não foi incluído neste repositório público. O relatório foi lido, mas não houve validação criptográfica da assinatura.

A informação do titular de que o projeto-base já está homologado em direito autoral/propriedade intelectual permanece registrada. As fontes consultadas sustentam o dossiê, os hashes e a representação à London. Não foi localizado nelas o número de processo ou certificado INPI. Esses campos permanecem nulos e separados para software e marca, sem afirmar inexistência de registro ou de direitos. A procuração não foi tratada como certificado nem como cessão de autoria.

## Continuidade das versões

Windows, macOS, iOS/PWA e web devem conservar a identidade do mesmo produto, mantendo versões técnicas e hashes de seus próprios artefatos separados das chaves registrais históricas. Esta indexação não prova que uma compilação atual seja o mesmo arquivo que foi ou será depositado; essa equivalência depende da sua própria proveniência.

Nenhum direito de terceiro foi reivindicado, nenhuma titularidade foi transferida e nenhum novo pedido foi enviado ao INPI ou à London. Não houve alteração de runtime, autorização, HML, produção, assinatura de aplicativo ou distribuição.

## Fontes e verificação

- Dossiê registral existente: PR #23, head histórico `006f086e84ddeb337bbc6e6195ca093f50829c10`.
- `AURORA_NEXUS_FORMULARIO_LONDON_MARCAS.txt`.
- `MANIFESTO_AURORA_NEXUS_1.0.1-SCOPE-ADD.json` e os dois arquivos canônicos nele identificados.
- Procuração assinada, referência restrita `LONDON_POA_20260923`.
- `AGENTS.md` e `docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md`, para a chave JFN-AUD-GOV-001.

Verificação de consistência do índice, sem rede, credencial, instalação ou alteração de dados:
```sh
python -m unittest discover -s scripts/tests -p 'test_aurora_registry_index.py' -v
```

A inclusão na main depende da revisão do PR documental. O registro histórico do PR #23 permanece intacto. Rollback: reverter apenas os arquivos deste índice; nunca apagar ou recalcular os objetos registrais originais.
