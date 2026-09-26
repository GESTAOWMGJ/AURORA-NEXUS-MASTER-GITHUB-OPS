# Aurora Nexus — domínio canônico

**Status:** domínio canônico registrado no estado desejado; política de interface atualizada para **login-first privado**, sem landing pública e sem demonstração pública.

## Domínio base

```text
auroranexus.com.br
```

Este domínio é destinado ao produto **AURORA NEXUS**, software B2B de auditoria, consultoria, rastreabilidade e governança em saúde. Ele deve permanecer separado do domínio institucional do consultório `drjoaodefreitas.com.br`.

## Regra absoluta de interface

Qualquer acesso web por qualquer domínio Aurora Nexus deve abrir primeiro a tela de login.

Não deve existir:

- landing pública;
- demonstração pública;
- dashboard público;
- amostra de dados;
- rota aberta para exploração do produto;
- página comercial com interface funcional.

Conteúdo operacional só pode ser entregue após autenticação validada.

## Mapa de subdomínios

| Host | Função | Tráfego inicial |
| --- | --- | --- |
| `auroranexus.com.br` | Entrada privada do produto | login obrigatório; sem landing pública |
| `www.auroranexus.com.br` | Redirecionamento ou entrada privada equivalente | login obrigatório |
| `app.auroranexus.com.br` | Aplicação autenticada do Aurora Nexus | login obrigatório |
| `wmgj.auroranexus.com.br` | Piloto WMGJ como primeiro tenant operacional | login obrigatório |
| `api.auroranexus.com.br` | API/BFF/control plane | servidor-only; sem interface pública |

## Fallback atual preservado

```text
https://wmgj-ops.web.app/portal
```

O fallback não deve ser removido enquanto o domínio customizado, o SSL e os testes de autenticação não estiverem validados. Se o fallback expuser interface operacional sem autenticação, deve ser tratado como ambiente de transição e substituído pelo mesmo padrão de login-first antes de qualquer divulgação.

## Regras de segurança

1. Não versionar senha, token, chave privada, código de recuperação, TXT real de verificação, DKIM real ou segredo HMAC.
2. Copiar para o DNS somente valores emitidos pelo provedor oficial no momento da configuração.
3. Não redirecionar tráfego de produção antes de verificar propriedade do domínio, SSL, login, App Check ou controle equivalente, regras de acesso e logs.
4. Manter `AURORA NEXUS` sem símbolo de marca registrada até concessão marcária formal.
5. Toda mudança de domínio deve passar por pull request, revisão humana e checklist de rollback.
6. Usuário e senha devem existir no provedor de identidade, nunca em arquivo versionado.
7. Usuário autenticado deve estar explicitamente autorizado no secret `AURORA_NEXUS_ALLOWED_EMAILS`.

## Runbook resumido

1. Confirmar propriedade ou disponibilidade do domínio no Registro.br.
2. Criar os usuários autorizados no Firebase Authentication.
3. Configurar o secret `AURORA_NEXUS_ALLOWED_EMAILS` com os e-mails autorizados.
4. Adicionar os domínios customizados no provedor de hospedagem escolhido.
5. Copiar os TXT de verificação emitidos pelo provedor para o DNS.
6. Aguardar propagação e emissão de SSL.
7. Executar smoke test de `https`, tela de login, sessão, logout, permissões por tenant e logs.
8. Atualizar estes arquivos de estado desejado com o status real após validação.
