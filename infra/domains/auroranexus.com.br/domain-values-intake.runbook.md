# Aurora Nexus — recebimento dos valores oficiais de domínio, SSL e deploy

## Objetivo

Padronizar o recebimento, validação e registro dos valores oficiais emitidos pelos provedores para o domínio **Aurora Nexus**, sem versionar segredo, senha, token real de DNS, DKIM real, chave privada ou credencial de acesso.

Este runbook complementa a política **login-first**: nenhum domínio Aurora Nexus pode expor landing, demonstração, dashboard, portal ou dado operacional antes de autenticação validada.

## Domínios cobertos

```text
auroranexus.com.br
www.auroranexus.com.br
app.auroranexus.com.br
wmgj.auroranexus.com.br
api.auroranexus.com.br
```

## Regra absoluta

```text
SEM LOGIN = SOMENTE TELA DE LOGIN.
SEM SECRET DE E-MAILS AUTORIZADOS = FALHA FECHADA.
SEM SSL VALIDADO = NÃO PUBLICAR.
SEM SMOKE TEST APROVADO = NÃO LIBERAR.
```

## Valores que devem ser recebidos

### 1. Firebase / Hosting

Registrar no issue operacional apenas o status sanitizado:

```text
FIREBASE PROJECT ID: recebido / pendente
FIREBASE HOSTING SITE: recebido / pendente
DOMÍNIO PRINCIPAL: auroranexus.com.br
PROVEDOR DNS: Registro.br / outro
```

Não registrar credenciais de conta, tokens de API ou chaves de recuperação.

### 2. TXT de verificação

O provedor pode emitir um TXT exclusivo para comprovação de propriedade. Aplicar o valor real diretamente no DNS oficial. No GitHub, registrar apenas:

```text
TXT auroranexus.com.br: aplicado / pendente / não aplicável
TXT www: aplicado / pendente / não aplicável
TXT app: aplicado / pendente / não aplicável
TXT wmgj: aplicado / pendente / não aplicável
TXT api: aplicado / pendente / não aplicável
```

Se for necessário registrar um valor para auditoria, usar somente repositório privado, canal seguro ou cofre de segredo. Não inserir o token real em README, issue pública, comentário ou pull request.

### 3. A/CNAME oficiais

Registrar o tipo e status, sem segredo:

```text
DNS A/CNAME — auroranexus.com.br: aplicado / pendente
DNS A/CNAME — www: aplicado / pendente
DNS A/CNAME — app: aplicado / pendente
DNS A/CNAME — wmgj: aplicado / pendente
DNS A/CNAME — api: aplicado / pendente / não aplicável
```

Os valores reais devem ser copiados somente do console oficial do provedor selecionado.

### 4. SSL

Registrar horário e status:

```text
SSL — auroranexus.com.br
STATUS:
DATA/HORA DA PUBLICAÇÃO DNS:
DATA/HORA DA VERIFICAÇÃO FIREBASE/PROVEDOR:
DATA/HORA DO SSL CONECTADO:
OBSERVAÇÃO:

SSL — app.auroranexus.com.br
STATUS:
DATA/HORA DA PUBLICAÇÃO DNS:
DATA/HORA DA VERIFICAÇÃO FIREBASE/PROVEDOR:
DATA/HORA DO SSL CONECTADO:
OBSERVAÇÃO:

SSL — wmgj.auroranexus.com.br
STATUS:
DATA/HORA DA PUBLICAÇÃO DNS:
DATA/HORA DA VERIFICAÇÃO FIREBASE/PROVEDOR:
DATA/HORA DO SSL CONECTADO:
OBSERVAÇÃO:
```

### 5. Deploy protegido

Antes de deploy real:

```bash
cd firebase-migration
firebase functions:secrets:set AURORA_NEXUS_ALLOWED_EMAILS
firebase deploy --only functions,hosting
```

O conteúdo do secret deve conter somente e-mails expressamente autorizados, separados por vírgula.

Exemplo estrutural, sem senha:

```text
joao@auroranexus.com.br,admin@auroranexus.com.br
```

## Checklist de liberação

```text
[ ] TXT Firebase/provedor publicado
[ ] Domínio verificado no Firebase/provedor
[ ] A/CNAME oficial publicado
[ ] SSL conectado
[ ] Secret AURORA_NEXUS_ALLOWED_EMAILS configurado
[ ] Usuários criados no Firebase Authentication
[ ] Deploy functions concluído
[ ] Deploy hosting concluído
[ ] Teste sem login bloqueado
[ ] Teste com login autorizado aprovado
[ ] Teste com e-mail não autorizado bloqueado
[ ] Acesso direto a /dashboard redireciona para login
[ ] Acesso direto a /demo redireciona para login
[ ] Acesso direto a /portal redireciona para login
```

## Smoke test obrigatório

Abrir:

```text
https://auroranexus.com.br
https://www.auroranexus.com.br
https://app.auroranexus.com.br
https://wmgj.auroranexus.com.br
```

Resultado esperado:

```text
SEM LOGIN: mostra somente tela de login.
COM LOGIN AUTORIZADO: entra na interface.
COM LOGIN NÃO AUTORIZADO: bloqueia.
ABRIR /dashboard DIRETO: redireciona para login.
ABRIR /demo DIRETO: redireciona para login.
ABRIR /portal DIRETO: redireciona para login.
```

## Issue operacional

Usar o issue abaixo para tracking sanitizado:

```text
#32 — Aurora Nexus — receber valores oficiais DNS, SSL e deploy
```

## Critério de fechamento

Fechar o issue somente quando todos os domínios aplicáveis estiverem com DNS, SSL, deploy e login-first validados, sem qualquer interface pública disponível antes de autenticação.

## Observação sobre OneGate

OneGate não participa desta etapa de DNS/Firebase/SSL. Ele deve permanecer fora do fluxo de publicação do Aurora Nexus até existir um escopo explícito de DApp, carteira, assinatura ou submissão pública compatível com OneGate.
