# AURORA NEXUS — verificação de 05/10/2026

Consulta iniciada às 08:08 America/Sao_Paulo. Produto permanece 1.0.0-rc.1,
WMGJ Operação como piloto. Baseline de código:
`68467209b55f1f8e281ecb5d21acb9a8211757cf`.
Lidas AGENTS.md, AURORA-MO-001, AURORA-DEV-001, AURORA-SEC-001 e
desktop/README.md. Nenhum novo executor, scheduler operacional ou projeto.

## Correção candidata: web updater 1.0.1

O atualizador definia nextCheck para 15 minutos após falha, mas seu único timer
rodava a cada 24 horas. Sem novo evento de visibilidade/conectividade, a
retentativa não ocorria no prazo previsto. Reproduzido com relógio sintético:
timer da baseline = 86.400.000 ms; esperado após falha = 900.000 ms.

A candidata troca o intervalo fixo por um timeout após cada tentativa concluída.
Sucesso agenda 24 horas; falha agenda 15 minutos; aba oculta/offline pausa e
retoma pelos eventos existentes. pending impede concorrência e o timeout anterior
é cancelado antes de agendar outro.

Seis testes passam localmente com Node 24.19.0, removendo somente tipos TypeScript
e ajustando a extensão do import em cópia temporária; compilação TypeScript e
Node 22 continuam sujeitos ao workflow existente no SHA publicado. A suíte nova
falha na baseline e passa na candidata, incluindo a regressão da retentativa.

Compatibilidade: mesmo /service-worker.js, updateViaCache=none e APIs existentes;
nenhuma alteração de payload, autenticação, membership, storage, dados, cache,
bundle, ícone ou domínio. Sem reload forçado; trabalho aberto é preservado.
O service worker continua sem handler fetch/cache. A consulta do worker não
equivale a substituir um binário desktop nem a recarregar a interface aberta.

Rollback: reverter somente o commit desta correção e publicar pelo fluxo protegido
quando os gates forem comprovados. O código anterior continua compatível; não há
migração de dados ou protocolo. Sem instalação ou alteração remota nesta verificação.
Nenhum gate do Release Cockpit é promovido: dailyUpdates continua
IMPLEMENTED_PENDING_LIVE_VALIDATION.

## Evidência por plataforma

| Plataforma | Código e teste/CI | Deploy / instalada / validação real |
| --- | --- | --- |
| Web | Atualizador na main; correção candidata com seis testes locais. Main: Validate Firestore Migration run 37267793270 e CodeQL 37267793121 passaram no SHA acima. | Deploy run 37267892546 falhou no preflight Eventarc; deploy e smoke foram pulados. SHA atualmente servido e sessão real não revalidados. |
| Windows | PR #128 draft, head 27d00d9254b9fe088e29bf666b9d4d7a6d0b589a: cliente 0.3.0-beta.20261004.1. PR #156 trata destinos canônicos; PR #158 trata IA Master. São ciclos existentes, não atualizações instaladas comprovadas nesta execução. | Versão instalada, editor confiável, login, atualização no mesmo destino e rollback real não revalidados. Nenhuma instalação executada. |
| Mac | Continuidade do app original obrigatória. beta-platforms.json mantém BLOCKED_BASELINE_INSPECTION; launcher HML não é sucessor. | Bundle/caminho/assinatura/versão funcional não inspecionados nesta execução. Nenhuma substituição. |
| iOS / Android PWA | Compartilham o atualizador web. Testes sintéticos não comprovam comportamento nativo. | Sem teste próprio de dispositivo nesta execução; instalação, retomada, autenticação e rollback permanecem não comprovados. |

Fontes: main e arquivos acima; PRs #128/#156/#158; runs no repositório
GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS. Não reutilizar CI de outro SHA como
liberação da candidata. Não há GitHub Release listado na consulta; isso não
prova ausência de instalação ou distribuição por outro canal.

## Prioridades materiais (máximo três)

1. **Atualizador — IMPLEMENTED/TESTED, CI pendente na publicação.** Risco:
   demora de recuperação após erro transitório. Responsável sugerido: manutenção
   web/PWA. Próxima ação: CI no SHA final e smoke autenticado em HML. Aceite:
   seis regressões, build/Rules/security verdes no SHA, trabalho aberto preservado
   e teste próprio iOS/Android antes de alegar validação mobile.
2. **Publicação HML — BLOCKED.** Run 37267892546, job 111628705048, main
   68467209: erro HML_EVENTARC_IAM_REVIEW_REQUIRED, exit 3, antes do Firebase CLI.
   WIF autenticou, mas esse fato não fecha o gate IAM. Risco: ampliar permissões
   ou publicar parcialmente para contornar a falha. Responsável sugerido:
   administrador cloud autorizado. Próxima ação: revisar a evidência IAM pelo
   procedimento existente; aceite: preflight aprovado sem bypass, CI/revisão do
   SHA atual e ambiente protegido. Esta rotina não amplia IAM.
3. **Continuidade desktop/mobile — PENDENTE.** Reutilizar #128/#156/#158,
   reconciliar com a main antes de promoção e vincular cada teste ao SHA final.
   Responsável sugerido: mantenedor desktop e QA mobile. Aceite: identidade,
   confiança do editor, login, funções anteriores, backup e rollback comprovados
   no dispositivo autorizado. Falta dessa evidência bloqueia distribuição,
   sem afirmar que o aplicativo instalado falhou.

## Dependências e fontes primárias

Main usa firebase-admin ^14.5.0, firebase-functions ^7.4.0; ferramentas de
Rules: firebase 12.18.0 e firebase-tools 15.28.1. O passo
Block high or critical production dependency advisories do run 37267793270 passou
no SHA 68467209. É evidência daquele audit de dependências de produção, não
atestado sobre todas as dependências/dispositivos nem ausência de advisories futuros.

Consultados documentação ServiceWorkerRegistration.update/updateViaCache e
release oficial firebase-admin-node. As páginas completas de advisories não
puderam ser recuperadas nesta consulta; não se conclui ausência de vulnerabilidades.
Nenhum upgrade especulativo de dependência foi incluído.

- https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update
- https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache
- https://github.com/firebase/firebase-admin-node/releases

Não houve deploy, publicação binária, alteração de IAM, segredo, DNS ou produção.

## Reconciliação com a main durante a validação

Às 08:18 America/Sao_Paulo, a main avançou para
`19937d96be37a570caa9e074a9c03d51543cdbc8` com merge do PR #158.
O PR #159 é reconciliado com esse commit, preservando integralmente a IA Master.
A mudança não sobrepõe os quatro arquivos deste patch. A seção 23 acrescentada
à AURORA-MO-001 foi relida: inferência local produz propostas, não autentica
fontes nem autoriza publicação, credenciais ou execução arbitrária.

O estado Windows da tabela acima é a primeira consulta. A evidência posterior
registrada no PR #158 informa instalação do componente no PC autorizado,
sete testes nativos e inferência sintética autenticada (10.998 ms inicial,
5 ms com cache; 123 tokens locais). Cinco workflows passaram no candidato
`e76df6f45ace4b542dcb0e69e30533abf098f622`. Isso é evidência registrada no PR,
não uma nova inspeção física realizada por esta rotina. Sincronização cloud,
publicação web e produção continuam não comprovadas por esses resultados.

O primeiro candidato do #159, `71a7267a0c4304ff1f5274091f18d4724b975157`,
passou Firestore 37301903488 (461 testes Functions e 27 Rules), CodeQL
37301903471 e integração orgânica 37301903474; audit de produção retornou zero
vulnerabilidades nesse run. Esses checks são históricos após a reconciliação:
o novo SHA exige seus próprios checks. A descrição do PR registra o SHA e os
runs finais, sem reutilizar o verde da base anterior como aprovação.
