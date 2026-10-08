# AURORA NEXUS — validação beta em 07/10/2026

## Resultado observado

O backend privado HML comprovado continua no fallback técnico
`https://wmgj-hml-jfn-20260927.web.app/`. A main reconciliada
`bebb0a0b62baa47b2057dbf773c87b6ca8e7e3da` adota a entrada única
`https://auroranexus.com.br/portal`; essa alteração de código não comprova
interconexão do domínio ao backend privado. O serviço Go de status no Cloud Run
não substitui o aplicativo Firebase.

O deploy protegido HML do SHA `bebb0a0b62baa47b2057dbf773c87b6ca8e7e3da`
foi concluído com sucesso no run
[37711572514](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/37711572514).
O modo `SHADOW_UPDATE` preservou o tenant ativo e os gates de recuperação,
autenticação e aprovação existentes.

Validação Linux no mesmo run: Functions 481/481, Security Rules 27/27,
API Python 33/33 e painel JavaScript 3/3. O smoke autenticado verificou identidade,
sessão e shell privado. Metadados HTTP do Cloud Logging na janela do smoke
confirmaram resposta 200 de Native Intelligence e Motor Mestre no deploy anterior
`203670bc`, run `37706475370`. Essa observação histórica não substitui o resultado
HTTP de uma execução posterior.

O run anterior `37710988330` publicou o SHA `6053718` e falhou no smoke por
exigir HTTP 200 no caminho de tenant, agora redirecionado com 303 para `/portal`.
A correção na main exige explicitamente o redirect e o shell privado em `/portal`;
o run novo passou. A falha global anterior não representou rollback da publicação.

Verificação HTTPS independente após o deploy novo: 14/14 checks passaram para login, acesso privado,
rejeição de credencial ausente, integração, perfis, downloads e decisão societária.
Foi feita leitura autenticada somente dos metadados permitidos do tenant e do
snapshot: ambiente HOMOLOGATION, projeção SHADOW, fonte presente e atualizada,
armazenamento Firestore e inferência sem acesso à origem ou requisito de IA externa.
Nenhum dado operacional, credencial ou payload financeiro foi publicado.

O manifesto `desktop/beta-platforms.json` passa a referenciar esse SHA e run
comprovados. Esse registro corrige a evidência de implantação web; não altera
a versão do cliente Windows nem promove os gates de Mac, iOS, sincronização
integral ou produção. O histórico anterior permanece nos documentos de handoff.

Na verificação dirigida de 07/10/2026, a entrada canônica retornou HTML de
apresentação, não o formulário de login Firebase; `/api/bootstrap` nessa origem
retornou 404. O controle Firebase confirma domínio ativo no site legado `wmgj-ops`
e `OWNERSHIP_MISMATCH` no site HML já existente. O Auth HML não autoriza o domínio
canônico e mantém MFA desativado, embora tenha configuração TOTP. O desired-state
mantém `customPortalBackedByHmlAuthGate=false`.
Portanto a evidência do run HML não libera o endereço canônico, a migração do
cliente Windows para ele nem o login pessoal nessa nova superfície.

## Correção candidata do coletor

O teste nativo Windows reproduziu conexão SQLite deixada aberta por
`scan_counts` e `transmit_once`. O arquivo de estado não podia ser removido
ao encerrar a validação. A candidata usa `contextlib.closing` nas duas rotinas,
mantendo os commits e a política de idempotência existentes.

A regressão retém a conexão real para detectar vazamento mesmo em sistemas
que permitem remover arquivos abertos. Cobre saída normal, falha do scanner,
recibo persistido, rejeição 401 com estado BLOCKED preservado, falha inesperada
e inicialização em banco somente leitura. Os seis casos falham antes da correção
e passam depois no Windows.
O workflow existente executa a mesma regressão em Linux e Windows.

Esse patch corrige gestão de recurso local; não habilita novo executor,
não provisiona credencial e não comprova transmissão cloud. Reversão: reverter
o commit candidato, preservando o arquivo de estado e a fila. A candidata
permanece em PR draft até revisão e CI do SHA exato; não foi instalada ou publicada.

A distribuição Windows beta.4 inclui apenas instalador, `aurora_deployment.py`
e `aurora_cloud_sync.py`. O atalho abre o portal em Edge e não executa o coletor
SQLite. Portanto essa correção pertence à capacidade de coletor separada e não
deve ser anunciada como atualização de um componente presente no pacote beta.4.

## Gates ainda abertos

1. Login pessoal do titular no portal. O smoke usa identidade técnica e não
   substitui esse aceite. MFA continua obrigatório nas ações administrativas,
   de permissão e de risco alto/crítico, conforme AURORA-SEC-001.
2. Primeira transmissão Windows–cloud com credencial de integração governada,
   recibo atual e reconciliação canônica. Sincronização integral, agente em
   segundo plano e failover físico/cloud não estão comprovados.
3. Inspeção da baseline e teste nativo do aplicativo Mac, além de teste no
   dispositivo iOS, quando incluídos no aceite multiplataforma.

O resultado comprova código, CI e HML nos limites descritos. Não libera produção,
dados clínicos sensíveis, certificação comercial nem atualização do Mac original.
O objetivo de entrega permanece aberto até os gates de aceite exigidos.

## Aprendizado reutilizável

O ciclo AURORA-MO-001 deste desafio registra duas regras técnicas abstratas:
um deploy de status não atesta o app operacional; e o contexto de transação
SQLite não garante fechamento do recurso. Evidência e testes permanecem separados
de instalação, sincronização real e aceite. Nenhum novo agendamento ou rotina
operacional foi criado e nenhum aprendizado de tenant foi promovido automaticamente.
