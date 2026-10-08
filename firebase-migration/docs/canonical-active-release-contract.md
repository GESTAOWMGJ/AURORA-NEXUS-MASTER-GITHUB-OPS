# Versão vigente comum do Aurora Nexus

Estado deste código: candidato de homologação. A existência do verificador não
significa que uma referência ativa foi publicada ou que clientes foram atualizados.

A IA nativa, provedores externos, servidor, PC satélite e Mac podem originar
melhorias. Uma melhoria entra na versão vigente por revisão, CI no SHA exato,
deploy protegido, smoke no domínio canônico e promoção assinada. O ponto de
referência único é `platformRuntime/activeRelease`, protegido contra SDK de cliente.
Título, e-mail, manifesto local ou declaração de atualização não promovem versão.

O certificado Ed25519 fixa SHA da fonte, versão do produto, versões e SHA256 dos
manifestos de servidor/interface dinâmica/pacotes satélites, runs de CI/deploy e
data de publicação. A chave pública confiável vem da configuração de runtime;
não vem do certificado. Sem chave/documento válido, o resultado é `NO_ACTIVE_PIN`
ou `INVALID_ACTIVE_PIN`. Histórico é create-only e a troca do ponteiro usa CAS
do certificado anterior, evitando promoção concorrente ou regressão de data.

O publisher consulta as evidências do GitHub: main atual, workflow e projeto
exatos, CI concluído com sucesso, revisão humana no head final do PR integrado,
deploy e smoke concluídos. No mesmo run, pode ignorar exclusivamente o check do
próprio job de publicação ainda em execução, vinculado ao run/job exatos. Outros
checks pendentes ou falhos continuam bloqueando. Main é revalidada antes de
assinar e em cada tentativa da transação. Uma falha não troca o ponteiro ativo.

## Processo e página em execução

Os manifestos são gerados de HEAD limpo após build. O conjunto `lib/*.js` deve
corresponder às fontes atuais e os pacotes satélites devem ter bytes, tamanho,
hash e sourceCommit corretos. Servidor e interface dinâmica usam todos os JS
compilados, incluindo helpers transitivos. Assets remotos de Hosting/PWA não são
declarados como observados por esses manifestos.

O processo Functions captura manifestos e bytes na inicialização. A consulta
do pin continua fresca a cada bootstrap. Trocar arquivos no disco não faz um
processo antigo afirmar que executa código novo. A página recebe o manifesto
web observado quando foi renderizada e mantém essa identidade; polling posterior
não substitui o build carregado. Divergência mostra `UPDATE_NOT_APPLIED`, sem
recarregar formulários em edição. A leitura atual ocorre na abertura, reconexão
e no polling existente de até 60 segundos enquanto visível. Isso não oferece
latência zero nem sincronização com máquinas desligadas.

A IA local informa manifesto sanitizado e startedAt capturados no start.
`manage.start` bloqueia processo antigo, desconhecido ou incompatível antes de
iniciar componentes. Não mata nem reinicia processos ou aplicativos Mac.

Receipts podem indicar `NOT_REPORTED`, `OFFLINE_PENDING`, `STALE_RECEIPT`,
`VERSION_CONFLICT`, `UPDATE_NOT_APPLIED` ou `MATCH_REPORTED`. Relato compatível
não comprova instalação física. Verificação de pacotes exige todos os bytes.
`allClientsSynchronized` permanece falso sem evidência individual de cada cliente.

## Ativação protegida

Configurar, após revisão, a variável pública `AURORA_ACTIVE_RELEASE_PUBLIC_KEY`
e o secret protegido `AURORA_ACTIVE_RELEASE_PRIVATE_KEY` como par Ed25519.
Nenhuma chave real é gerada, copiada ou publicada pelos testes. No workflow HML,
usar `publish_active_release=true`, CI/PR exatos e hash do certificado predecessor
(`NONE` apenas na primeira promoção). Depois de configurar a chave pública,
deploy sem promoção é recusado antes das alterações de nuvem.

O smoke canônico cria sessão própria no domínio `auroranexus.com.br`, com cookie
host-only. Compara a fonte e os hashes do runtime ao artefato construído. O job
posterior de publicação conserva os manifestos do mesmo deploy; não inventa
confirmação de instalação nem aceita sucesso escrito em um pedido do cliente.

O vínculo pessoal do Gestor Master à WMGJ não concede acesso entre organizações.
Manutenção de outros clientes exige concessão contratual vigente, escopo e
auditoria. Declarações do usuário sobre fundador/titular são registradas como
declarações; não substituem documentos societários ou contratos.
