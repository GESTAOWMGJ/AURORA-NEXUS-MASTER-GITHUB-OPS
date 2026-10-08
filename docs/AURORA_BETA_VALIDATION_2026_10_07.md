# AURORA NEXUS — validação beta em 07/10/2026

## Resultado observado

O portal beta canônico continua em `https://wmgj-hml-jfn-20260927.web.app/`.
O serviço Go de status no Cloud Run não substitui o aplicativo Firebase.

O deploy protegido HML do SHA `203670bc562bbb48694b08e55af363a07d90a8f5`
foi concluído com sucesso no run
[37706475370](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/37706475370).
O modo `SHADOW_UPDATE` preservou o tenant ativo e os gates de recuperação,
autenticação e aprovação existentes.

Validação Linux no mesmo run: Functions 479/479, Security Rules 27/27,
API Python 33/33 e painel JavaScript 3/3. O smoke autenticado verificou identidade,
sessão e shell privado. Metadados HTTP do Cloud Logging na janela do smoke
confirmaram resposta 200 de Native Intelligence e Motor Mestre, em vez de
presumir disponibilidade a partir da tolerância a resposta 409 no script.

Verificação HTTPS independente: 13/13 checks passaram para login, acesso privado,
rejeição de credencial ausente, integração, perfis, downloads e decisão societária.
Foi feita leitura autenticada somente dos metadados permitidos do tenant e do
snapshot: ambiente HOMOLOGATION, projeção SHADOW, fonte presente e atualizada,
armazenamento Firestore e inferência sem acesso à origem ou requisito de IA externa.
Nenhum dado operacional, credencial ou payload financeiro foi publicado.

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

## Gates ainda abertos

1. Login pessoal do titular com senha e segundo fator. O smoke usa identidade
   técnica e não substitui esse aceite.
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
