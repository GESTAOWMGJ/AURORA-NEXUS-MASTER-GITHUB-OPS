# PR #276 — risco residual das dependências

Data de referência: **19/10/2026**. Escopo: ferramentas de validação Firebase, caminhos transitivos e separação entre testes, implantação e runtime. Este relatório registra uma candidata de correção; não constitui aprovação de integração ou publicação.

## 1. Resultado e três prioridades

A atualização do Firebase CLI para `15.34.0` reduziu alertas, mas conservou duas causas distintas: recursão sem limite de profundidade em `braces` e processamento de baggage sem limites no OpenTelemetry Core. O patch incremental desta revisão corrige a segunda causa na árvore dos testes. **Permanecem três agregações HIGH associadas a `braces`, sem versão corrigida conhecida na consulta atual.** As contagens do npm incluem dependentes afetados; não representam necessariamente falhas independentes.

| Prioridade | Fato e impacto | Próximo passo verificável |
|---|---|---|
| 1. Dependências residuais | Override exclusivo dos testes, com verificação de consumidores, corrige Core; auditoria passa de 3 HIGH/2 MODERATE para 3 HIGH/0 MODERATE. `braces` permanece vulnerável. | Concluir revisão e CI do novo SHA; conservar o risco sem supressão e acompanhar correção upstream. |
| 2. Ferramenta de implantação | HML e produção executam CLI `14.17.0` fora do lockfile dos testes, após autenticação. Há também reparo HML com `15.32.1`. | Inventariar a árvore realmente instalada nesses jobs e validar atualização própria, sem estender o resultado deste patch aos deploys. |
| 3. Governança | PR sem revisão humana registrada; proteção de `main` não comprovada como ativa; exceção R029 expirada. | Exigir proteção efetiva, revisão humana independente e gates aplicáveis antes de integrar ou publicar. |

Baseline examinada: cabeça original do [PR #276][pr] `ba6d083a11481045a62f2903f86893a198227bc5`; base original em `main` `967d32a493b9930d77cac1030642c6fca28bb1f3`. A referência de `main` avançou durante a investigação; esta base identifica o material auditado, não certifica o estado futuro da branch. Os resultados históricos daquele PR não validam automaticamente o novo commit, que exige nova CI e conferência de compatibilidade com a base vigente antes da integração.

## 2. Avisos e caminhos transitivos

### `braces`: indisponibilidade por recursão

O aviso [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687][braces-advisory] afeta versões até `3.0.3`, inclusive, e informa ausência de versão corrigida. Padrões profundamente aninhados podem esgotar a pilha dos caminhadores da árvore sintática, terminando o processo Node com `RangeError`. Um limite apenas de caracteres não garante limite de profundidade.

Caminho identificado no [lockfile original dos testes][tests-lock]:

`firebase-tools 15.34.0 → chokidar 3.6.0 → braces 3.0.3`.

As entradas HIGH de `braces`, `chokidar` e `firebase-tools` refletem propagação desse risco na árvore. Para exploração operacional, uma entrada controlada pelo atacante precisa alcançar o processamento vulnerável. A presença do pacote não comprova esse percurso em uma requisição do aplicativo. Também não autoriza declarar a falha irrelevante: os componentes são executáveis no ambiente de ferramentas. Não foi demonstrado caminho entre dados de cliente e esse parser no runtime examinado.

Não foi aplicado override para versão fictícia, atualização major de `chokidar` nem downgrade do CLI. Uma substituição desse tipo exigiria compatibilidade própria e poderia manter a causa original. O risco de indisponibilidade permanece aberto, sem alegação de execução arbitrária ou vazamento de dados.

No código publicado de [Chokidar 3.6.0][chokidar-source], `getDirParts()` só chama `braces.expand()` quando há glob e abertura de chaves. O [Firestore Emulator do CLI 15.34.0][firestore-watcher] observa `args.rules`; a configuração examinada usa o caminho literal `firestore/firestore.rules`. Assim, não foi identificado encaminhamento de documentos ou requisições Firestore à expansão de chaves nessa rotina. A conclusão depende de configuração e caminho resolvido confiáveis, inclusive diretório de trabalho. Padrões arbitrários e caminhos descobertos sob um watcher com glob exigem outra avaliação.

### OpenTelemetry: baggage sem limites de entrada

O aviso [GHSA-8988-4f7v-96qf / CVE-2026-54285][otel-advisory] afeta `@opentelemetry/core <2.8.0`. A correção publicada é `2.8.0`: o extrator de baggage passa a limitar quantidade de entradas, tamanho individual e orçamento total. O problema é consumo excessivo de recursos; limites de transporte HTTP podem reduzir a exposição, mas não devem ser presumidos para mensageria ou extratores personalizados.

Caminho original:

`firebase-tools 15.34.0 → @google-cloud/pubsub 5.3.1 → @opentelemetry/core 1.30.1`.

A inspeção de `telemetry-tracing.js` do Pub/Sub identificou `W3CTraceContextPropagator`, que propaga contexto de trace. Não identificou uso do `W3CBaggagePropagator` vulnerável nesse caminho. Portanto, o pacote afetado estava instalado, mas a exploração pelo consumidor inspecionado **não foi demonstrada**. Essa distinção sustenta a avaliação de alcance; não elimina o benefício de retirar a versão vulnerável.

Os [manifestos publicados do CLI][cli-manifest] e do [Pub/Sub][pubsub-manifest] explicam a resolução: Pub/Sub pede Core `^1.30.1`; o próprio CLI declara override `^2.8.0`. Contudo, overrides de uma dependência não são herdados pelo projeto que a instala: o npm considera os overrides da raiz, conforme sua [documentação][npm-overrides].

### Versões disponíveis na consulta de 19/10/2026

| Pacote | Versões verificadas no registry npm | Decisão de compatibilidade |
|---|---|---|
| Firebase CLI | `latest = 15.34.0` | Preservar a versão já proposta no PR. |
| `braces` | `latest = 3.0.3`; aviso sem versão corrigida | Não há atualização corretiva publicada para aplicar. |
| `chokidar` | `latest = 5.0.0`; consumidor usa `3.6.0` | v4 remove globs; v5 acrescenta ESM e Node >=20.19. A [migração][chokidar-changelog] altera o contrato de filtros usado pelo CLI. |
| Pub/Sub | `latest = 6.3.0`; linha `legacy-18 = 5.3.1` | v6 sai de `^5.2.0` e altera majors de `google-gax` e autenticação; não é a menor correção compatível demonstrada. |
| OpenTelemetry Core | `latest = 2.12.0`; mínimo corrigido `2.8.0` | Fixar `2.8.0` nos testes e verificar que o grafo só contém o consumidor inspecionado; Node 22 satisfaz seus requisitos. |

Essas versões são um retrato da consulta, não uma política de atualização permanente. A escolha do mínimo corrigido é acompanhada da auditoria atual e da validação do consumidor.

## 3. Matriz de alcance em cinco ambientes

| Ambiente | Evidência observada | Alcance e limite da conclusão |
|---|---|---|
| Validação em CI | Bootstrap com projeto sintético, `--only firestore`, instalação com `--ignore-scripts`; job sem autenticação cloud configurada. | Risco nas ferramentas de teste. Não há caminho demonstrado de cliente produtivo até os parsers residuais. |
| Worker Windows de desenvolvimento | Execução física desta candidata ainda sem recibo verificável. | Compatibilidade e isolamento da máquina permanecem pendentes; disparo de comando não comprova execução. |
| Implantação HML | CLI `14.17.0` por `npx`; procedimento de reparo usa `15.32.1`; execução após WIF. | Processo operacional credenciado, com árvore distinta. O patch dos testes não o saneia. |
| Implantação de produção | CLI `14.17.0` por `npx`, após WIF, em job separado de publicação. | Mesma distinção entre ferramenta e runtime; versões transitivas da instalação efetiva exigem evidência própria. |
| Runtime de Functions HML/produção | Fonte configurada como `functions`; manifest e lockfile próprios; 68 arquivos TypeScript inspecionados. | Os cinco pacotes residuais estão ausentes do grafo descrito pela candidata. Imagens/revisões efetivamente publicadas não foram certificadas por esta análise. |

O [manifest das Functions][functions-manifest] declara `firebase-admin` e `firebase-functions`; seu [lockfile][functions-lock] não contém `braces`, `chokidar`, `firebase-tools`, `@google-cloud/pubsub` ou `@opentelemetry/core`. Contém `@opentelemetry/api`, pacote diferente. Nenhuma importação dos cinco componentes foi encontrada nas fontes inspecionadas. Essa evidência sustenta a ausência no runtime da candidata, sem converter auditoria de dependências em avaliação completa de segurança.

## 4. Patch mínimo e reversível

O override é declarado diretamente na raiz exclusiva de `firebase-migration/tests`. A proposta preliminar aninhada por CLI/PubSub funcionou no npm 11, mas o npm 10 da CI perdeu seu efeito e rejeitou o lockfile. A reprodução com Node `22.23.3` e npm `10.9.9` confirmou a diferença. A correção final preserva a versão do gerenciador e os workflows existentes:

```json
{
  "overrides": {
    "@opentelemetry/core": "2.8.0"
  }
}
```

O CLI permanece `15.34.0` e Pub/Sub permanece `5.3.1`. No lockfile, um nó muda de Core `1.30.1` para `2.8.0`; desaparece o nó aninhado `semantic-conventions 1.28.0`, passando a ser reutilizada a cópia compatível `1.39.0` já existente. A regeneração pelo npm 10 com override direto produziu o mesmo lockfile corrigido, sem atualização global das demais dependências.

A mudança atravessa a versão principal do Core e ultrapassa a faixa original declarada pelo Pub/Sub. Seu fundamento é o override já adotado pelo upstream do CLI, acompanhado de resolução real e regressões do consumidor. Sintaticamente, o override alcança toda a árvore deste pacote de testes. No grafo examinado há um único consumidor de Core: Pub/Sub `5.3.1`. Um novo teste verifica todos os registros do lockfile, inclusive a raiz, nos campos `dependencies`, `devDependencies`, `optionalDependencies` e `peerDependencies`; exige esse único consumidor e uma única cópia de Core `2.8.0`. A resolução real também exige CLI `15.34.0` e Pub/Sub `5.3.1`. Um consumidor novo, versão diferente ou cópia adicional faz o teste falhar e exige reavaliação da compatibilidade. Esses controles não dispensam a revisão humana e a CI.

## 5. Validação e estados de evidência

| Verificação | Resultado desta revisão |
|---|---|
| `npm ci --ignore-scripts` nos testes | Instalações limpas concluídas com npm 10.9.9/Node 22.23.3 e npm 11.9.0/Node 24.19.0: 690 pacotes em cada uma. |
| `npm ls` e `npm explain` | Saída de sucesso; Core corrigido resolvido a partir do consumidor Pub/Sub. |
| Versão do executável Firebase | `15.34.0`. |
| Auditoria dos testes, antes/depois | 3 HIGH + 2 MODERATE → 3 HIGH + 0 MODERATE. |
| Auditoria do conjunto de Functions | Zero vulnerabilidades na medição atual. |
| Teste determinístico novo | 18/18 aprovados em Node 22.23.3 e Node 24.19.0, após instalação limpa com os respectivos npm 10.9.9 e 11.9.0. |
| Controle negativo | Seis cenários escalar/array reproduzem ausência de limites no extrator oficial 1.30.1 e passam no 2.8.0. |
| Controle negativo do grafo | A inclusão sintética de um novo consumidor via peer dependency e de uma cópia vulnerável aninhada faz o novo teste falhar, com código 1. |
| Nova CI / Rules / worker Windows | PENDING no corte anterior à submissão deste commit; consultar os checks do SHA final no PR. |
| Integração, HML e produção | Não realizadas por esta correção. |

`tooling-dependencies.test.mjs` resolve o Core a partir do módulo real de telemetria do Pub/Sub. Verifica o grafo de consumidores, versão, identidade compartilhada da API, propagação de trace, rejeição de contextos inválidos e ausência de leitura de baggage nessa rota. Exercita também o extrator corrigido com entradas sintéticas pequenas nos limites de 180 entradas, 4.096 bytes por entrada e 8.192 bytes totais, incluindo formatos escalar e array.

Não há cliente Pub/Sub, exportador ou credenciais nesses testes. Aprovação dessas regressões não demonstra correção de `braces`, funcionamento do emulador ou execução do deploy. A suíte foi incluída nos scripts de teste existentes; o próximo gate é sua execução no Node 22 configurado na CI, junto das validações aplicáveis. Processamento pesado deve permanecer preferencialmente no worker Windows autorizado; sua execução continua pendente de recibo.

O controle negativo usa os extratores oficiais com o mesmo peer API: a versão antiga aceita 181 entradas, uma entrada de 4.097 bytes e um total de 8.193 bytes; a corrigida limita ou descarta o excedente. O maior input desse controle foi de 8.193 bytes. Não foi executado teste de esgotamento de memória ou pilha. O runner padrão também propagou corretamente uma falha intencional; a apresentação detalhada local foi obtida com `--test-isolation=none`, sem alterar os scripts por essa diferença de apresentação.

A [CI da candidata preliminar `c93d1e7`][ci-preliminar] falhou no `npm ci` por exigir Core `1.30.1` e semantic-conventions `1.28.0`, antes dos testes e emuladores. Esse resultado não foi ocultado ou convertido em exceção: motivou o ajuste do override e as instalações limpas em ambas as versões do npm. O novo commit precisa de nova CI. O CLI também foi validado no Node 22 com diretório de configuração temporário próprio, versão `15.34.0` e saída 0; uma tentativa anterior em configuração global somente leitura foi diagnosticada como erro de escrita, não contada como aprovação.

## 6. Mitigações observadas e recomendadas

**Observadas:** árvore de testes separada das Functions; [bootstrap][bootstrap] com `npm ci --ignore-scripts`; fixtures sintéticas; Firestore como único emulador solicitado; [workflow de validação][validation-workflow] sem autenticação GCP e com timeout; instalação/compilação de Functions antes da autenticação nos principais jobs de publicação.

**Limites:** o bootstrap não remove ADC, tokens ou autenticações pré-existentes da máquina. A mensagem final que informa ausência de login não constitui isolamento de credenciais. A configuração também não fixa explicitamente host loopback. A marcação `devDependency` não impede uso em jobs com privilégios.

**Recomendadas, ainda sem alegação de implantação:** runner descartável sem credenciais e dados reais para testes; loopback explícito e portas de emulador não publicadas; padrões de observação controlados, com limite de profundidade antes de parsers vulneráveis; limites de tempo/memória; instalação auditada antes da autenticação quando compatível com o fluxo. Mudanças devem receber testes próprios, preservando os controles existentes. Nenhuma dessas medidas equivale a remover a vulnerabilidade sem patch upstream.

## 7. Implantação e governança permanecem pendentes

Os workflows de [HML][hml-workflow] e [produção][prod-workflow] executam `npx --yes firebase-tools@14.17.0`. A instalação fixa o CLI solicitado, mas não utiliza o lockfile de testes para travar toda a árvore transitiva. O [reparo de Hosting HML][repair-workflow] instala globalmente `15.32.1`. Não foram atribuídas a essas instalações as contagens medidas para `15.34.0`.

A consulta de governança registrou `reviews: []`, `protected=false` em `main` e ausência de rulesets retornados. Falha de revisão automática por limite de utilização não é reprovação técnica, tampouco revisão humana. A declaração de um environment no YAML não comprova seus revisores obrigatórios ativos.

A exceção R029 expirou em **2026-10-16T03:00:00Z**, conforme a [política histórica][r029]. Este relatório não a renova, não cria outra exceção e não reduz a severidade do advisory. Correção parcial e testes verdes não substituem decisão de risco válida, revisão humana independente e proteção efetiva da branch.

Os 30 workflows inspecionados não têm `workflow_run` ou `pull_request_target`. Os robôs de autoavaliação não integram nem publicam este patch; a abertura de branch/PR draft pode acionar validação, sem dispensar os gates. Antes de promoção, conferir novamente cabeça final, base corrente, checks e aprovação do SHA pertinente.

## 8. Reversão e aprendizado reutilizável

Se surgir regressão, produzir **novos commits de reversão dos incrementos desta investigação, em ordem inversa**, retornando os arquivos ao candidato original `ba6d083a11481045a62f2903f86893a198227bc5` e preservando sua atualização `15.34.0` e mudanças concorrentes. Reinstalar pelo lockfile revertido, repetir testes/auditoria e registrar o retorno dos alertas moderados. Não reescrever histórico nem restaurar indiscriminadamente a branch.

O aprendizado registrado é: contagem de advisories, presença transitiva, caminho executável, contexto de credenciais e instalação publicada são provas distintas. O registro não habilita automação, não promove release e não declara risco encerrado.

[pr]: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/pull/276
[braces-advisory]: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
[otel-advisory]: https://github.com/advisories/GHSA-8988-4f7v-96qf
[cli-manifest]: https://registry.npmjs.org/firebase-tools/15.34.0
[pubsub-manifest]: https://registry.npmjs.org/@google-cloud/pubsub/5.3.1
[npm-overrides]: https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides
[tests-lock]: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/blob/ba6d083a11481045a62f2903f86893a198227bc5/firebase-migration/tests/package-lock.json
[functions-manifest]: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/blob/ba6d083a11481045a62f2903f86893a198227bc5/firebase-migration/functions/package.json
[functions-lock]: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/blob/ba6d083a11481045a62f2903f86893a198227bc5/firebase-migration/functions/package-lock.json
[bootstrap]: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/blob/ba6d083a11481045a62f2903f86893a198227bc5/firebase-migration/scripts/bootstrap-homologacao.sh
[validation-workflow]: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/blob/ba6d083a11481045a62f2903f86893a198227bc5/.github/workflows/validate-firestore-migration.yml
[hml-workflow]: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/blob/ba6d083a11481045a62f2903f86893a198227bc5/.github/workflows/deploy-aurora-firebase.yml
[prod-workflow]: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/blob/ba6d083a11481045a62f2903f86893a198227bc5/.github/workflows/aurora-firebase-production.yml
[repair-workflow]: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/blob/ba6d083a11481045a62f2903f86893a198227bc5/.github/workflows/repair-hml-hosting-route-once.yml
[r029]: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/blob/ba6d083a11481045a62f2903f86893a198227bc5/firebase-migration/policy/hml-owner-release-approval-v1.json
[chokidar-source]: https://github.com/paulmillr/chokidar/blob/3.6.0/index.js
[chokidar-changelog]: https://github.com/paulmillr/chokidar/blob/main/CHANGELOG.md
[firestore-watcher]: https://github.com/firebase/firebase-tools/blob/v15.34.0/src/emulator/firestoreEmulator.ts
[ci-preliminar]: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/39285772018/job/118171162619
