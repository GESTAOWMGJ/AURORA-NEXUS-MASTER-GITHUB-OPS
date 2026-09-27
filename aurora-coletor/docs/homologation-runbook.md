# Aurora Coletor — homologação, identidade técnica e operação segura

## 1. Destino e identidade técnica

Destino de homologação previsto:

```text
https://api.auroranexus.com.br/coletor
```

Identidade técnica padrão do piloto WMGJ:

```text
identityId: aurora-collector-wmgj-hml-001
org: wmgj
facility: WMGJ
environment: homologation
```

A ativação real exige cadastro no backend com:

```text
instituição
unidade
expiração
hash SHA-256 da credencial
estado ativo/inativo
```

O servidor nunca recebe a credencial em arquivo de configuração versionado. O arquivo de exemplo contém apenas placeholders.

Para gerar o hash sem colocar a credencial na linha de comando:

```sh
python3 - <<'PY'
import getpass, hashlib
secret = getpass.getpass("Credencial técnica: ")
print(hashlib.sha256(secret.encode("utf-8")).hexdigest())
PY
```

Revogação: marcar a identidade como inativa ou remover o hash.  
Rotação: gerar nova credencial pelo administrador, atualizar hash no backend e atualizar o segredo da conta de serviço.

## 2. Segredo no ambiente do serviço

O coletor lê somente:

```text
AURORA_COLLECTOR_TOKEN
```

Não colocar tokens em:

```text
linha de comando
repositório
Notion
prints
logs
README
planilhas
```

Linux:

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin aurora-collector
sudo install -d -o aurora-collector -g aurora-collector -m 0700 /etc/aurora-coletor
sudo install -o aurora-collector -g aurora-collector -m 0600 /dev/null /etc/aurora-coletor/aurora-collector-wmgj-hml-001.env
```

O arquivo real deve ter permissão `600` e conter somente:

```text
AURORA_COLLECTOR_TOKEN=<valor aprovado>
```

O modelo de systemd usa:

```text
User=aurora-collector
UMask=0077
EnvironmentFile=/etc/aurora-coletor/aurora-collector-wmgj-hml-001.env
```

O `launchd` não herda automaticamente ambiente de terminal. O plist entregue não contém token.

## 3. Validação sem transmissão

```sh
python3 aurora_collector.py --config /caminho/collector-config.json
```

O padrão valida e não transmite. A saída mostra somente contagens.

## 4. Transmissão autorizada

Um ciclo:

```sh
python3 aurora_collector.py --config /caminho/collector-config.json --once
```

Ciclo contínuo:

```sh
python3 aurora_collector.py --config /caminho/collector-config.json --watch
```

Preferir supervisor do sistema e uma instância por configuração.

O recibo aceito deve conter:

```text
hash do conteúdo normalizado
ID do recibo
estado Aguardando conferência / AWAITING_REVIEW
```

## 5. Conferência humana

Após transmissão, confirmar na plataforma o lote em:

```text
Aguardando conferência
```

A conta técnica não pode revisar nem aprovar. Outra pessoa autorizada deve revisar com MFA.

## 6. Pausa, revogação e retenção

Pausar: parar/desabilitar a tarefa ou serviço no sistema operacional.  
Revogar acesso: desativar a identidade no servidor.  
Preservar estado e originais até decisão formal de retenção.

Não desinstalar apagando evidências.

## SQLite local

O banco guarda somente:

```text
hash do arquivo
hash do conteúdo normalizado
escopo
tentativas
estado
próxima tentativa
ID do recibo
```

Não guarda nome de arquivo, caminho, conteúdo, credencial ou token.

## Retentativa

- Falha de rede: espera progressiva até 1 hora.
- HTTP 408, 429 e 5xx: nova tentativa.
- Erros permanentes: `BLOCKED`.
- HTTP 401/403: interrompe o ciclo.
- Recibo inválido: `BLOCKED`.

Após correção, remover somente o registro `BLOCKED` autorizado do banco para reprocessar. Não apagar toda a fila.

Interface de suporte para desbloqueio: evolução pendente.

## Duplicidade

Duplicidade local: hash dos bytes.  
Duplicidade remota: conteúdo normalizado.

Essa diferença é deliberada para que mudanças de formatação não criem faturamento adicional.

## Limites desta versão

Receptor integrado ao backend existente, limitado por configuração a homologação sintética, instância única e disco persistente.

Não é implantação produtiva nem certificação de conformidade. Ativação real exige:

```text
identidade aprovada
destino aprovado
volume persistente/backup
região aprovada
retenção aprovada
ACL da pasta
restauração validada
revisão operacional no ambiente do cliente
```

Gmail/Drive continuam fontes complementares. O coletor não afirma sincronizá-los.
