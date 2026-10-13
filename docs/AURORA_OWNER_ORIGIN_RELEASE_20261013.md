# Publicação com origem proprietária — 13/10/2026

Baseline: `c89d41e492ee92b46c9aca05c087cbcd74ea65ec`.

Fatos: run38445934068 (#62) confirmou validação, deploy, smoke autenticado e
runtime vinculado à fonte, todos SUCCESS. A etapa publisher está separada.
Consulta da API desse run retornou `actor=github-actions[bot]` e
`triggering_actor=github-actions[bot]`. O publisher existente exige conta
proprietária nesses dois campos e aprovação real do ambiente protegido.
A revisão aprovada pelo proprietário no ambiente não altera a origem do run.

Conclusão do código: um child dispatch com GITHUB_TOKEN não satisfaz esse modo.
Não registrar promoção assinada desse run sem resultado próprio. A correção
preserva o publisher, assinatura, CAS, identidade e permissões: o request aguarda
CIpush exato e prepara um recibo sanitizado dos inputs, sem disparar child run.
A sessão proprietária autorizada inicia o workflow oficial usando esses inputs.
Não cria PAT, segredo, credencial, novo dispatcher ou privilégio do bot.

Regressões executam o Bash real: CIpush correto sem mutação, rejeição de
failure/cancelled/SHA/evento divergentes e preparo do recibo proprietário.
Os testes existentes de SHADOW continuam exigindo os mesmos gates/flags.
CI final, run proprietário, smoke e promoção são provas independentes.

O cliente Mac existente permanece beta2026.10.13-beta.1. Fonte do agente1.0.1
e método c89d41e foram preparados no nó de contingência com nove hashes
conferidos; estado STAGED_SOURCE_AND_METHOD_NOT_INSTALLED. Credenciais e
consentimentos próprios dos provedores, extração e cobertura WMGJ permanecem
pendentes. Não ativar ingestão massiva no Mac ou declarar corpus físico atualizado.

O cancelamento manual do run antigo38444321556 foi recusado pela revisão
automática por falta de autorização explícita para esse cancelamento. Não houve
retry/contorno dessa ação; consulta posterior mostrou o run já CANCELLED.
Continuar o fluxo autorizado da nova candidata sem alterar gates ou fontes.

Rollback: reverter apenas o preparo do request, preservando todos os recibos,
fontes, auditoria, backups e credenciais. Reversão não autoriza publicar por bot.
