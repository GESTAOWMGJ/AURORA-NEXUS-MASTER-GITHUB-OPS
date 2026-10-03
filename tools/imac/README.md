# Base TRIGGERcmd do iMac — candidato PR #95

Componente: `imac-bootstrap-hardening-1`. Produto permanece no release train
AURORA NEXUS `1.0.0-rc.1`; este patch não publica release nem atualiza o .app.
Baseline reconciliada: PR #95 `ad50a0b4484d4d399a845513a40d57c52cff269e`, sobre a main
`ee4d274bf27e36b293f2043fe2d4d818ea965c3d`. WMGJ Operação é o piloto.

## Plano sem efeitos externos

```sh
bash tools/imac/INSTALL_AURORA_TRIGGERCMD_BASE.sh --dry-run
```

Sem argumento também é `--dry-run`. Apenas imprime o plano: sem escrita,
rede, leitura de credenciais, sincronização, reinício ou instalação.
Não é atestado de prontidão: os pré-requisitos são checados no apply autorizado.

## Preflight nativo somente leitura

No checkout revisado e no iMac identificado, o modo abaixo verifica plataforma,
host, caminhos, presença de arquivos sem ler credenciais, Node major 16 e estado
do LaunchAgent. Não escreve, instala, reinicia nem consulta a rede:

```sh
bash tools/imac/INSTALL_AURORA_TRIGGERCMD_BASE.sh --preflight --confirm-host iMac-de-Joao.local
```

O aceite é exit code 0 e `AURORA_IMAC_NATIVE_PREFLIGHT_OK`. Host divergente ou
Node diferente bloqueiam antes de qualquer escrita. Não substituir o host por
expansão automática. Retorno de preflight não prova login, app ou conexão remota.
O ensaio sintético do modo usa Node 22 com major simulado; não homologa Node 16.

## Aplicação futura, somente com autorização para o equipamento identificado

Não executar apenas porque o PR está disponível. Confirmar o iMac, o hostname,
a conta, a baseline existente e a janela de manutenção. MacBook não é o alvo.
O modo mutante exige `--apply --confirm-host HOST_EXATO_VERIFICADO`; não preencher
automaticamente essa confirmação com `$(hostname)` em comandos remotos.

O apply exige macOS/iMac e o runtime/registro TRIGGERcmd já existentes; não
provisiona tokens. Um agente executando fora do LaunchAgent conhecido bloqueia
para revisão: o script não usa `pkill`, `sudo`, SIP ou Gatekeeper.

O candidato é gerado em staging privado; scripts passam por `bash -n`, JSON por
parse e PLIST por `plutil -lint` antes de alterar os alvos. Caminhos simbólicos
são recusados. O PLIST escapa caminhos como dados XML. Comandos não relacionados
são preservados, e alteração concorrente do arquivo de comandos bloqueia.

O sucesso indica somente arquivos instalados e processo presente. Não prova
conectividade remota, autenticação HML, app aberto, coletor ativo ou ingestão.
Nenhum status HTTP é consultado automaticamente ao aplicar. O comando de status,
quando autorizado separadamente, informa HTTP sem confundi-lo com login testado.

## Espelho local sem descarte

`AURORA NEXUS Sincronizar` é uma ação separada, não executada pelo bootstrap.
Ela clona somente se o destino não existe. Diretório não-Git, symlink, origin
divergente, branch diferente de main, arquivos modificados/não rastreados/ignorados,
commits locais e histórico raso que impeça provar ancestralidade bloqueiam.
A atualização é fast-forward-only; não há reset forçado nem remoção recursiva.
Hooks Git não são executados. Falha de clone pode deixar diretório parcial;
preservá-lo e revisar manualmente, sem apagamento automático.

Não editar o espelho enquanto sincroniza. Locks protegem instâncias destes
scripts, não oferecem exclusão contra todo processo externo da mesma conta.

## Backup e rollback

Antes de sobrescrever, seis alvos têm cópias verificadas em `backup.XXXXXX`
privado dentro de `Library/Application Support/AuroraNexus-iMac`. O caminho exato
é mostrado localmente. Não publicar backup, stage, caminhos pessoais ou logs.
Credenciais `token.tkn`/`computerid.cfg` não são copiadas nem lidas em conteúdo.

| Índice | Alvo relativo à conta |
| --- | --- |
| 0 | `.TRIGGERcmdData/jfn_status_mac.sh` |
| 1 | `.TRIGGERcmdData/aurora_nexus_status.sh` |
| 2 | `.TRIGGERcmdData/aurora_nexus_sincronizar.sh` |
| 3 | `.TRIGGERcmdData/restart_triggercmd_headless.sh` |
| 4 | `.TRIGGERcmdData/commands.json` |
| 5 | `Library/LaunchAgents/com.jfn.triggercmd.imac.plist` |

`N.original` preserva bytes/permissões anteriores; `N.absent` indica ausência
anterior; `N.published` identifica alvos efetivamente tocados. `was-loaded`
registra o estado anterior do LaunchAgent. `prepared-at` registra horário UTC.
Stage e backup são mantidos para recuperação; não há limpeza destrutiva automática.

Em falha após a primeira escrita, a rotina tenta descarregar apenas este
LaunchAgent, restaurar os alvos tocados e recarregar o anterior se estava ativo.
Arquivos novos são movidos para `N.failed` no backup, não apagados.
`ROLLBACK_FILES_OK=1` não substitui revalidação nativa/conectividade pelo operador.
Falha de rollback mantém retorno não-zero e requer intervenção humana.

Após um apply concluído ou interrupção não capturável (energia/SIGKILL), rollback
é manual e autorizado: identificar o backup correto, preservar a configuração
atual em outra cópia privada, conferir se houve edições posteriores, descarregar
somente `com.jfn.triggercmd.imac`, restaurar cada `N.original` com `cp -p` ao alvo
da tabela e mover novos alvos marcados `.absent` para quarentena privada. Validar
shell/JSON/PLIST e carregar o PLIST anterior somente se `was-loaded=1`. Conferir
o processo e depois conectividade; preservar todos os registros. Não tocar no
.app, no espelho, em outros LaunchAgents ou em credenciais. Lock residual exige
confirmar ausência de execução antes de remover exclusivamente o diretório vazio.

## Evidência e próximo gate

```sh
python3 -m unittest discover -s tools/imac/tests -v
```

Testes usam contas sintéticas, repositórios Git locais e service manager simulado.
No runner macOS também validam o PLIST com a ferramenta nativa. Não acessam
Desktop Commander/TRIGGERcmd real, HML, dados ou tokens reais. Node 22 do CI não
homologa Node 16; runner macOS atual não homologa High Sierra.

Pendente: revisão humana; ensaio autorizado no iMac High Sierra/Node 16 correto;
retorno remoto verificável; rollback nativo. Responsável sugerido: mantenedor
desktop com titular autorizador. Aceite: simulação sem efeitos, instalação
idempotente, comandos retornando evidência sanitizada e rollback demonstrado,
preservando o app original. Risco residual: SO/runtime legado e recuperação
após queda de energia ainda não homologados. Nenhum gate HML/comercial é liberado.
