# Aurora Coletor

Coletor local do Aurora Nexus para entrada administrativa por pasta explícita.

## Princípios

- Sem dependências adicionais: Python 3 + biblioteca padrão.
- Leitura somente da pasta de entrada configurada.
- Escrita somente no estado local dentro do `target`.
- Sem senha, token, certificado, TXT DNS ou chave privada no repositório.
- O instalador recusa destino existente.
- `org` usa minúsculas; `facility` usa referência em maiúsculas.

## Instalação Linux

Criar primeiro uma conta de serviço restrita, com leitura na entrada e escrita somente no estado local.

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin aurora-coletor
sudo mkdir -p /srv/aurora-entrada
sudo chown root:aurora-coletor /srv/aurora-entrada
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

Para o piloto WMGJ, depois de receber o endpoint oficial autorizado:

```sh
python3 install.py \
  --target /opt/aurora-coletor \
  --watch-dir /srv/aurora-entrada \
  --endpoint https://ENDPOINT-OFICIAL-AUTORIZADO \
  --org wmgj \
  --facility WMGJ
```

Finalizar permissões:

```sh
sudo chown -R aurora-coletor:aurora-coletor /opt/aurora-coletor
sudo chmod 0750 /opt/aurora-coletor /opt/aurora-coletor/state /opt/aurora-coletor/log
```

Teste único:

```sh
sudo -u aurora-coletor /opt/aurora-coletor/run.sh --once
```

## Windows

Usar caminhos absolutos e `python`:

```powershell
python install.py `
  --target C:\Aurora\Coletor `
  --watch-dir C:\Aurora\Entrada `
  --endpoint https://ENDPOINT-OFICIAL-AUTORIZADO `
  --org wmgj `
  --facility WMGJ
```

Execução única:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Aurora\Coletor\run.ps1 --once
```

## Autenticação opcional por ambiente

O coletor aceita um token bearer somente por variável de ambiente. O padrão é:

```text
AURORA_COLLECTOR_TOKEN
```

O valor não deve ser salvo no GitHub, em README, Notion ou planilha.

## Arquivos aceitos

Por padrão, somente:

```text
.csv
.json
.jsonl
```

Arquivos são enviados com chave de idempotência baseada em `org`, `facility`, caminho relativo, tamanho, mtime e SHA-256.

## Estado local

O estado fica em:

```text
<TARGET>/state/collector-state.sqlite3
```

O coletor não move, apaga, renomeia nem escreve arquivos na pasta de entrada.
