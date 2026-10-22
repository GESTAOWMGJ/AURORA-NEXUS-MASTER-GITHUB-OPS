# Regularização da configuração documental — 22/10/2026

Baseline: `226a7f101f4bf1e0680afca2459132f01ebaf71d`. Componente candidato:
`v1.1.4-scoped-configuration-repair`, módulos M01/M08/M10. Estado:
`IMPLEMENTED_LOCAL_TESTED_PENDING_CI_REVIEW_DEPLOYMENT`.

## Problema observado

O login Google e a conexão HMAC foram verificados separadamente da ingestão.
A consulta autenticada do conector retornou `dryRun=true`, nenhuma fonte ativa,
registro documental ausente e um gatilho fora da lista operacional. A leitura
autorizada do código salvo e da versão publicada 26 confirmou que o handler
desse gatilho, `auroraNexusCaptureCycle`, não existe em nenhuma das duas versões.
Não se presume que um gatilho órfão tenha executado captura.

A prévia histórica retorna `AURORA_CONNECTOR_REUSE_EXPIRED`. Seu prazo original
permanece preservado. A instrução atual do titular, “regularize”, fundamenta
somente a janela de manutenção descrita na política
`wmgj-connector-regularization-20261022.json`; não constitui revisão independente
do código nem renovação tácita da exceção HML/R029.

## Correção candidata

`auroraRemoverGatilhoOrfaoWmgjConfigOnly` oferece PREVIEW/REMOVE. Exige identidade
proprietária ativa igual à efetiva, tenant WMGJ, modo simulado, nenhuma fonte
ativa, ausência do símbolo no código em execução, um único gatilho CLOCK com o
handler conhecido e fingerprint completo de ID/handler/tipo/origem. Reconfere
estado e fingerprint sob a trava compartilhada antes de excluir. Não remove
outros gatilhos, não cria substituto nem lê conteúdo documental. Metadados
privados não saem na resposta. Resposta perdida permanece incerta até nova
consulta; ausência já comprovada resulta em zero novas exclusões.

`auroraRegularizarFonteWmgjConfigOnly` reutiliza a implementação de configuração
existente, com confirmação e janela próprias. Preserva comparação de hash,
escopo da fonte, HMAC, flags e rollback condicional. Só registra a fonte como
inativa, após a ausência de gatilhos. O endpoint histórico não ganha prazo novo.
Não existe novo executor, banco, scheduler, fluxo de aquisição ou fallback de IA.

## Validação e execução

Validação local sintética: 62 testes aprovados, sendo 38 de configuração e
24 regressões de status, sanitização e prévia histórica. Testes não comprovam
aceite do Google, remoção de gatilho real, cadastro real, extração ou ingestão.

Após revisão, CI no SHA final e publicação protegida elegível:

1. Revalidar identidade, projeto, versão publicada e janela da política.
2. Chamar PREVIEW de remoção, preservando somente resposta sanitizada.
3. Chamar REMOVE com o mesmo fingerprint; reconciliar resultado incerto antes
   de qualquer repetição e confirmar ausência por nova consulta.
4. Chamar PREVIEW da regularização e CONFIGURE com o hash recém-obtido.
5. Confirmar `CONFIGURED_INACTIVE`, registro existente, zero fontes ativas,
   flags preservadas e nenhum gatilho novo. Persistir os recibos privados.

Toda chamada mantém `devMode=false`. Não usar versões de desenvolvimento ou
chamadas a helpers privados para contornar publicação ou autorização.

## Gates e rollback

A autorização HML/R029 observada encerrou-se em `2026-10-22T03:00:00.000Z`.
Este patch não a renova. A publicação requer elegibilidade vigente do fluxo
protegido e revisão aplicável; a janela deste reparo, isoladamente, não publica
código. CI, instalação, configuração real e primeira ingestão permanecem estados
separados. Nenhum gate do Release Cockpit é promovido por esta candidata.

A configuração real somente avança até cadastro inativo. Ativação e ingestão
exigem vínculo de empresa, recuperação, autenticação, amostra real, reconciliação,
insight nativo e kill switch/rollback comprovados no destino autorizado.

Rollback de código: reverter a candidata pelo fluxo protegido. Falha de escrita
no cadastro restaura somente valores ainda pertencentes à tentativa, com leitura
posterior. A exclusão do gatilho não restaura automaticamente seu agendamento
desconhecido: preservar o recibo e não recriar handler ausente. A substituição
operacional permanece uma etapa separada, com o executor canônico existente.
