# AURORA NEXUS — client único da referência atual

## Decisão do titular e base
Em 15/10/2026, o titular restringiu a entrega a client/patch único e respondeu **“Aprovado”** ao relatório de preparação. Autorização de continuidade registrada no [comentário do PR #271](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/pull/271#issuecomment-6203200665). Não é review independente, aprovação retroativa, extensão de R029 ou comprovante de publicação/instalação.

A base desta alteração é `967d32a493b9930d77cac1030642c6fca28bb1f3`, posterior aos PRs #271 e #272. A preparação A27 anterior foi preservada, não promovida nem aplicada sobre a nova main. OAuth, aquisição documental e CMEK já integrados permanecem intactos. O patch altera distribuição, não instala ou ativa conectores.

## Contrato de entrega
A página privada anuncia somente `/downloads/Aurora-Nexus-Client-Atual.zip`. O pacote inclui `satellite` e `windowsIntegration`, manifestos e certificado público; exclui os payloads dedicados `server`, `web` e `iaMaster`. Os quatro endpoints individuais anteriores continuam restritos para compatibilidade e recuperação. A rota do ZIP completo não é servida por esse patch; o arquivo completo permanece como evidência interna da release.

A referência é resolvida pelo ponteiro assinado vigente, nunca por nome de branch, versão numericamente maior ou arquivo local antigo. Preservam-se sessão, membership, organização, permissões, reautorização final, comparação do runtime e dos cinco manifestos, limite de concorrência, proteção contra troca de ponteiro e respostas sem cache/ETag. A confiança pública vem da configuração independente do ambiente, não da chave incluída no ZIP.

`finalizeClientPatch` primeiro executa a verificação completa existente e depois seleciona os bytes do client. O publicador protegido e o endpoint usam o mesmo finalizador. A opção `--client-only` do CLI existente produz o artefato adicional, sem mudar gates, identidades, predecessor, CAS, assinatura ou ambiente. A saída padrão preserva a evidência completa anterior.

`client-patch-manifest.json` conserva `complete=false`, `installationExecuted=false`, fonte e hash do certificado. SHA-256 do ZIP não é assinatura de editor. Ed25519 do certificado não equivale a Authenticode, notarização Apple, IPA ou aceite nativo. O antigo VERIFY.py exige a release completa e não é incluído no subconjunto.

## Evidências realizadas em 15/10/2026
- TypeScript: compilação aprovada.
- Suíte direcionada no Windows Xeon: 98 testes, 97 aprovados, zero falhas, um symlink ignorado pela plataforma. Abrange CLI/runtime, subset client-only, GET/HEAD, adulteração, revogação, troca de tenant/principal, referência concorrente e preservação dos endpoints individuais.
- `git diff --check`: aprovado antes do commit.
- Artefato oficial do run [38800626389](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/38800626389), ID `12004956645`: 7.541.426 bytes, SHA-256 `07dee54cfbc69a3698a3fb24efbab30b6ae701e4a606334a3df6945bdf5a8a9d`. Reprodução integral dos bytes pelo finalizador confirmada.
- Raiz pública do environment `firebase-homologation`, variável `AURORA_ACTIVE_RELEASE_PUBLIC_KEY`, relida: SPKI SHA-256 `d5194cc457b8a895731387bbfa9129af51ecb8c80d9b7d0f6b520a0f64209f49`.
- Certificado da base: `6a75977b3215c5fae47646e67c9a19a29b334985f5cd258bcf904cc3528efb39`. Produto `1.1.0-beta.2`; Windows Integration `1.0.6`.
- Client preparado dessa base às 22:08:20 UTC: 5.308.617 bytes, 16 entradas, SHA-256 `9140f3f0cf49d01ddd56a7ab08dafa52122d700a0678ce6d33dd2d29a6fcf5a0`. Assinatura do certificado e correspondência dos payloads verificadas. É preparo local por código candidato; não é publicação do novo endpoint. Uma futura publicação em outro SHA terá outro manifesto/hash.

## Gates restantes e recuperação
A CI precisa corresponder ao head final. A consulta da retomada encontrou somente o proprietário como colaborador, nenhum APPROVED independente no PR #271 e a main sem proteção/rulesets. Não fabricar review, conceder acesso a terceiro desconhecido ou usar a aprovação do titular como revisão independente.

Antes de integrar/publicar: revisão independente admissível no head exato, controles administrativos comprovados e fluxo HML protegido vigente. Depois: conferir o artefato client do publisher, GET/HEAD autenticados, negações reais, hashes, assinatura e bytes da fonte atual. Publicação do client, download funcional e instalação efetiva permanecem estados distintos.

Nenhuma instalação, checkpoint, identidade/bundle, atalho, credencial, dado, banco, serviço, DNS ou ponteiro oficial foi alterado por esta preparação. A aplicação de atualização in-place não é implementada por uma nova embalagem. Reversão do código por revert e fluxo protegido existentes; arquivos antigos e linhagem permanecem disponíveis, sem sobrescrita de alterações concorrentes.
