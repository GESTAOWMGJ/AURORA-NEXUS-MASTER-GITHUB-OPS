# Aurora Nexus — domínio canônico

**Status:** proposta operacional canônica, aguardando confirmação de propriedade/registro, verificação DNS e emissão automática de SSL pelo provedor de hospedagem.

## Domínio base

```text
auroranexus.com.br
```

Este domínio é destinado ao produto **AURORA NEXUS**, software B2B de auditoria, consultoria, rastreabilidade e governança em saúde. Ele deve permanecer separado do domínio institucional do consultório `drjoaodefreitas.com.br`.

## Mapa de subdomínios

| Host | Função | Tráfego inicial |
| --- | --- | --- |
| `auroranexus.com.br` | Landing institucional, status comercial e documentação pública mínima | sem dados sensíveis |
| `www.auroranexus.com.br` | Redirecionamento para o apex | sem dados sensíveis |
| `app.auroranexus.com.br` | Aplicação autenticada do Aurora Nexus | homologação controlada até validação |
| `wmgj.auroranexus.com.br` | Piloto WMGJ como primeiro tenant operacional | homologação/piloto |
| `api.auroranexus.com.br` | API/BFF/control plane para FastAPI, Cloud Run ou Functions | servidor-only, sem exposição de segredos |

## Fallback atual preservado

```text
https://wmgj-ops.web.app/portal
```

O fallback não deve ser removido enquanto o domínio customizado, o SSL e os testes de autenticação não estiverem validados.

## Regras de segurança

1. Não versionar senha, token, chave privada, código de recuperação, TXT real de verificação, DKIM real ou segredo HMAC.
2. Copiar para o DNS somente valores emitidos pelo provedor oficial no momento da configuração.
3. Não redirecionar tráfego de produção antes de verificar propriedade do domínio, SSL, login, App Check, regras de acesso e logs.
4. Manter `AURORA NEXUS` sem símbolo de marca registrada até concessão marcária formal.
5. Toda mudança de domínio deve passar por pull request, revisão humana e checklist de rollback.

## Runbook resumido

1. Confirmar propriedade ou disponibilidade do domínio no Registro.br.
2. Adicionar os domínios customizados no provedor de hospedagem escolhido.
3. Copiar os TXT de verificação emitidos pelo provedor para o DNS.
4. Aguardar propagação e emissão de SSL.
5. Executar smoke test de `https`, redirecionamentos, autenticação, logout, permissões por tenant e logs.
6. Atualizar estes arquivos de estado desejado com o status real após validação.
