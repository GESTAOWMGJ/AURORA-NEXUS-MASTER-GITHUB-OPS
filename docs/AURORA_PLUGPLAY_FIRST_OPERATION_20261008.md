# Primeira operação plug and play — 08/10/2026

O cadastro de identidade e MFA permanece distinto da conclusão operacional. A
conclusão exige fonte autorizada do tenant, documento canônico elegível, versão
imutável correspondente e projeção do mesmo documento/versão/hash. Fontes
marcadas como teste não servem como aceite, mesmo com outra fonte operacional.

## Implementação

- A API de documentos cria uma entidade, versão imutável e recibo idempotente na
  mesma transação. Uma mesma versão com workflow ou payload alterados retorna
  conflito. Replays retomam a projeção sem duplicar o histórico da mesma fonte.
- A leitura de prontidão compara o hash da entidade persistida e do snapshot
  imutável. Reconhece a rota existente Drive/SHEETS e a API estruturada; não exige
  novo banco ou novo índice. IDs são opacos e todas as leituras usam o tenant da
  sessão ou da credencial autenticada.
- A projeção lê fontes e publica o resultado dentro da transação, evitando que
  um executor atrasado publique uma visão anterior. Histórico existente pode
  reparar uma visão corrente divergente sem repetir o efeito histórico.
- Setup retoma a projeção por POST com CSRF de sessão. Só libera a conclusão
  após COMPLETE_INSTALLATION revalidar a prova e persistir o checkpoint no
  servidor. GET não grava; nenhum Bearer de integração entra no navegador.

## Evidência e limites

Baseline de código: main d5f502eaeb89d66c50024ecb4240ed021e76b676. Build e 73
testes focados passaram no Windows Xeon. O fixture do handler real comprovou
uma entidade e uma versão imutável após interrupção da projeção e replay da
mesma chave, reparação do readback, conflito sem efeito adicional e conclusão
idempotente. Trata-se de fixture transacional isolado, sem dados de clientes;
não comprova handoff distribuído, instalação ou ingestão real em produção.

O projeto produtivo autorizado pelo contrato é wmgj-prod-jfn-20261005. A
auditoria de 08/10 confirmou PITR e proteção contra exclusão habilitados, mas
nenhuma Function publicada. O domínio canônico ainda aponta para o projeto
legado wmgj-ops. Esse diagnóstico não permite substituir o alvo autorizado.
Fonte/registry proprietário, IAM de runtime, Auth/MFA, backup/restore próprio,
publicação e sessão pelo domínio continuam critérios técnicos de aceite, sem
necessidade de renovar consentimentos humanos já registrados.

## Reversão

Reverter o código desta mudança preservando entidades, versões, recibos e
checkpoint de identidade existentes. Não apagar dados para repetir onboarding.
Front e backend devem ser promovidos juntos: frontend reforçado recusa a prova
antiga composta apenas por booleano. Na ausência da prova, a instalação
permanece pendente; não usar HML como outro canal de acesso ao cliente.
