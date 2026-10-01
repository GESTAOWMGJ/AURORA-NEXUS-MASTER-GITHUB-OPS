# Aurora Nexus — Runbook de proteção da interface

## Objetivo

Garantir que qualquer acesso web aos domínios Aurora Nexus abra sempre a tela de login antes de qualquer interface, demonstração, dashboard ou dado operacional.

## Domínios cobertos

```text
auroranexus.com.br
www.auroranexus.com.br
app.auroranexus.com.br
wmgj.auroranexus.com.br
api.auroranexus.com.br
```

## Modelo de segurança aplicado

- Firebase Hosting reescreve todas as rotas para `auroraNexusAuthGate`.
- Usuário sem cookie de sessão recebe apenas a tela de login.
- Login usa Firebase Authentication por e-mail e senha.
- A Cloud Function troca o ID token por cookie `__session` HttpOnly, Secure e SameSite=Strict.
- A sessão só é aceita se o e-mail estiver no secret `AURORA_NEXUS_ALLOWED_EMAILS`.
- Se o secret não estiver configurado, o sistema falha fechado.
- Não existe demo pública.

## Configuração obrigatória

### 1. Criar usuários no Firebase Authentication

Criar usuários manualmente no console oficial do Firebase Authentication. Não registrar senhas no GitHub, Notion, README, planilha ou prompt.

### 2. Configurar lista de e-mails autorizados

No diretório `firebase-migration`, configurar o secret:

```bash
firebase functions:secrets:set AURORA_NEXUS_ALLOWED_EMAILS
```

Valor sugerido, em linha única, separando por vírgula:

```text
joao@auroranexus.com.br,admin@auroranexus.com.br
```

A lista real deve refletir somente usuários autorizados.

### 3. Build local

```bash
cd firebase-migration/functions
npm ci
npm run build
```

### 4. Deploy controlado

A partir de `firebase-migration`:

```bash
firebase deploy --only functions,hosting
```

Ou, para rollout dividido:

```bash
firebase deploy --only functions:auroraNexusAuthGate,functions:auroraNexusSessionLogin,functions:auroraNexusSessionLogout
firebase deploy --only hosting
```

## Smoke test obrigatório

### Sem autenticação

Cada URL abaixo deve mostrar somente login:

```text
https://auroranexus.com.br/
https://www.auroranexus.com.br/
https://app.auroranexus.com.br/
https://wmgj.auroranexus.com.br/
```

Critério: nenhuma tela de dashboard, demo, card operacional ou dado interno visível.

### Com autenticação válida

1. Entrar com e-mail autorizado.
2. Confirmar criação de sessão.
3. Abrir `/` e subrotas internas.
4. Confirmar que a interface só aparece após sessão validada.
5. Clicar em sair.
6. Confirmar retorno obrigatório ao login.

### Com e-mail não autorizado

1. Criar usuário de teste não listado no secret.
2. Tentar login.
3. Confirmar rejeição.

## Rollback

Se o login-first falhar:

1. Remover ou reverter DNS dos domínios customizados.
2. Manter fallback `https://wmgj-ops.web.app/portal` apenas como ambiente transitório.
3. Corrigir secret, usuários ou rewrites.
4. Reexecutar smoke test antes de nova exposição.

## Proibições permanentes

- Não publicar landing pública antes do login.
- Não publicar demo pública.
- Não versionar senha.
- Não versionar token real de DNS ou Firebase.
- Não permitir rota de dashboard sem sessão validada.
- Não tratar `api.auroranexus.com.br` como página navegável pública.
