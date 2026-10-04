# Aurora Coletor

O transporte explícito de registros estruturados para a API canônica também está
disponível em Windows/Linux: [procedimento Windows–cloud](docs/windows-cloud-sync.md).
É um componente de ingestão unidirecional; não significa espelhamento do banco local.

Coletor local do Aurora Nexus para entrada administrativa por pasta explícita.

## Princípios

- Sem dependências adicionais: Python 3 + biblioteca padrão.
- Leitura somente da pasta de entrada configurada.
- Escrita somente no banco local de estado dentro do `target`.
- Sem senha, token, certificado, TXT DNS, DKIM ou chave privada no repositório.
- O instalador recusa destino existente.
- `org` usa minúsculas; `facility` usa referência em maiúsculas.
- O padrão valida e não transmite.
- Transmissão exige `--once` ou `--watch` e token no ambiente `AURORA_COLLECTOR_TOKEN`.
- O SQLite não guarda nomes de arquivos, caminho, conteúdo ou credenciais.

## Identidade técnica de homologação

A ativação real exige identidade técnica cadastrada no servidor com:

```text
instituição
unidade
ambiente
expiração
hash SHA-256 da credencial
estado ativo/inativo
```

A credencial real nunca deve entrar no repositório, Notion, print, log ou linha de comando. O servidor usa apenas o hash aprovado pelo administrador.

Revogação: marcar identidade inativa ou remover o hash.  
Rotação: gerar nova credencial, atualizar o hash no servidor e atualizar o segredo da conta de serviço.

## Instalação Linux

Criar primeiro uma conta de serviço restrita:

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin aurora-collector
sudo mkdir -p /srv/aurora-entrada
sudo chown root:aurora-collector /srv/aurora-entrada
sudo chmod 0750 /srv/aurora-entrada
```

Instalação padrão:

```sh
python3 install.py \
  --target /opt/aurora-coletor \
  --watch-dir /srv/aurora-entrada \
  --endpoint https://ENDERECO-AUTORIZADO \
  --org ID-INSTITUICAO \
  --facility UNIDADE
```

Piloto WMGJ em homologação, com endpoint validado:

```sh
python3 install.py \
  --target /opt/aurora-coletor \
  --watch-dir /srv/aurora-entrada \
  --endpoint https://api.auroranexus.com.br/coletor \
  --org wmgj \
  --facility WMGJ \
  --identity aurora-collector-wmgj-hml-001
```

Finalizar permissões:

```sh
sudo chown -R aurora-collector:aurora-collector /opt/aurora-coletor
sudo chmod 0700 /opt/aurora-coletor /opt/aurora-coletor/state /opt/aurora-coletor/log
```

## Segredo por ambiente

Disponibilizar a credencial somente pelo ambiente do serviço:

```text
AURORA_COLLECTOR_TOKEN
```

Não usar token em linha de comando. O modelo `aurora-coletor.env.example` não contém token.

No Linux, o arquivo real de ambiente deve ser restrito:

```sh
sudo mkdir -p /etc/aurora-coletor
sudo chown aurora-collector:aurora-collector /etc/aurora-coletor
sudo chmod 0700 /etc/aurora-coletor
sudo install -o aurora-collector -g aurora-collector -m 0600 /dev/null /etc/aurora-coletor/aurora-collector-wmgj-hml-001.env
```

Conteúdo do arquivo real:

```text
AURORA_COLLECTOR_TOKEN=<segredo aprovado pelo administrador>
```

O `launchd` não herda automaticamente ambiente de terminal. O administrador deve prover o ambiente do serviço com mecanismo aprovado. O plist de exemplo não contém token.

## Operação

Validação sem transmissão:

```sh
python3 aurora_collector.py --config /caminho/collector-config.json
```

Execução única autorizada:

```sh
python3 aurora_collector.py --config /caminho/collector-config.json --once
```

Execução contínua:

```sh
python3 aurora_collector.py --config /caminho/collector-config.json --watch
```

Preferir supervisor do sistema e uma instância por configuração.

## Recibo

Um ciclo `--once` só é aceito se o recibo do servidor trouxer:

```text
ID do recibo
hash do conteúdo normalizado
estado Aguardando conferência / AWAITING_REVIEW
```

Em caso de hash, formato ou estado incorreto, o item é marcado como `BLOCKED` para investigação.

## Estado local

O estado fica em:

```text
<TARGET>/state/collector-state.sqlite3
```

O banco guarda somente:

```text
hash do arquivo
hash do conteúdo normalizado
escopo: org, facility, technicalIdentityId
tentativas
estado
próxima tentativa
ID do recibo
```

Não guarda nome de arquivo, caminho, conteúdo, token ou credencial.

## Retentativas e bloqueios

- Falha de rede: nova tentativa com espera progressiva até 1 hora.
- HTTP 408, 429 e 5xx: nova tentativa.
- Erros permanentes: `BLOCKED`.
- HTTP 401/403: interrompe o ciclo.
- Rejeição de recibo: `BLOCKED`.

Após correção de permissão/configuração, o administrador pode remover somente o registro `BLOCKED` autorizado do banco para reprocessar. Não apagar toda a fila.

Interface de suporte para esse desbloqueio: evolução pendente.

## Duplicidade

- Duplicidade local: hash dos bytes.
- Duplicidade remota: conteúdo normalizado.

Essa diferença é deliberada. Mudanças de formatação não devem criar faturamento adicional.

## Segurança de transporte

O coletor exige HTTPS, usa verificação de certificado padrão e não segue redirecionamentos.

## Estado e alcance

O receptor desta versão deve permanecer limitado por configuração a homologação sintética, em instância única com disco persistente. Não é implantação produtiva nem certificação de conformidade.

Ativação real exige identidade, destino, volume persistente/backup, região, retenção aprovada, ACL da pasta, restauração e revisão operacional no ambiente do cliente. Gmail/Drive continuam fontes complementares; este agente não afirma sincronizá-los.


## Instalação com conectores

Para o fluxo plug-and-play completo, use `one_click_deploy.py --one-click`. O processo chama o instalador real e solicita os dados dos conectores em modo interativo/oculto; segredos não são aceitos na linha de comando.

A conexão documental usa a arquitetura existente: Google Drive autorizado → extração/classificação → evento `DOCUMENT_UPSERT` → ingestão autenticada Firebase → `sourceDocuments`. Quando o conector é ativado como obrigatório, sucesso local sem confirmação Firebase deixa de ser considerado fechamento.

Para integração com outro ERP/software, o instalador pode registrar a chave recebida do sistema externo e gerar uma chave Aurora independente, limitada por escopo/validade. A ativação server-side da chave Aurora exige registro do hash por administrador autenticado com MFA.
