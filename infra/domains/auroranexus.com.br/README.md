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

### Entrada final por empresa — decisão de 04/10/2026

O endereço comercial do cliente é `https://auroranexus.com.br/{orgId}`.
Exemplo piloto: `https://auroranexus.com.br/wmgj`. É um caminho do mesmo domínio,
não uma branch Git, outro Site, outro banco ou um subdomínio por cliente.
Não utilizar endereço ChatGPT na entrega final. A identidade visível é AURORA NEXUS
e a empresa selecionada; os provedores técnicos não aparecem como marca do produto.

O caminho abre o login seguro. `/wmgj/login` é entrada equivalente. A PWA usa
manifesto por empresa com `id` e `start_url` no mesmo caminho, mantendo os ícones
e o frontend aprovados. Logout e sessão expirada retornam à entrada da empresa.
Nenhum nome, saldo, documento ou cadastro é consultado para renderizar o login
anônimo; um caminho sintaticamente válido não comprova empresa provisionada.

Para novos clientes, o slug coincide com o ID estável da organização existente,
em letras minúsculas, números e hífens (2–63 caracteres, sem nomes reservados).
Um alias diferente exige migração/mapeamento explícito; não renomear organizações.
O administrador provisiona `auroraOrgId` como custom claim assinada do Firebase
para a identidade individual, além do membership ativo e da allowlist existentes.
A claim seleciona o escopo, mas nunca confere papel, permissão ou MFA. Ausência
da claim mantém a compatibilidade WMGJ; claim inválida bloqueia, sem fallback.
Uma sessão tem uma organização ativa. Não escolher o tenant por query string,
header, formulário, cookie adicional ou pelo caminho solicitado pelo navegador.

Todas as APIs e o shell usam `resolveMember` com a mesma claim verificada e
relêem organização/membership atuais. Solicitar a URL de outra empresa ou outro
`orgId` no login resulta em 403 antes de servir o shell ou emitir a sessão.
O Firebase Hosting preserva o rewrite privado existente; nenhum banco ou
projeto adicional é necessário para este roteamento.

**Estado:** implementação candidata, sem comprovação de DNS/SSL ou publicação.
O domínio precisa estar vinculado ao Hosting aprovado e autorizado no Firebase
Authentication. Usar somente os registros emitidos pelo provedor; não inventar
IPs/TXT nem redirecionar instalações funcionais antes de validar HTTPS, login,
MFA, APIs, isolamento e PWA no domínio final. Preservar fallback para rollback.

Os subdomínios abaixo permanecem referências históricas/operacionais. A entrada
comercial preferida passa a ser o caminho por empresa no domínio principal.

| Host | Função | Tráfego inicial |
| --- | --- | --- |
| `auroranexus.com.br` | Entrada privada do produto | login obrigatório; sem landing pública |
| `www.auroranexus.com.br` | Redirecionamento ou entrada privada equivalente | login obrigatório |
| `app.auroranexus.com.br` | Aplicação autenticada do Aurora Nexus | login obrigatório |
| `wmgj.auroranexus.com.br` | Piloto WMGJ como primeiro tenant operacional | login obrigatório |
| `api.auroranexus.com.br` | API/BFF/control plane | servidor-only; sem interface pública |

## Runbooks oficiais

```text
infra/domains/auroranexus.com.br/auth-gate.runbook.md
infra/domains/auroranexus.com.br/domain-values-intake.runbook.md
```

- `auth-gate.runbook.md`: proteção da interface, login obrigatório, sessão e smoke test.
- `domain-values-intake.runbook.md`: recebimento sanitizado dos valores oficiais de DNS, SSL e deploy.

## Issue operacional

```text
#32 — Aurora Nexus — receber valores oficiais DNS, SSL e deploy
```

O issue é o local de tracking. Não colar senha, token real, TXT sensível, chave privada, DKIM real ou código de recuperação.

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
8. Nenhum domínio Aurora Nexus deve exibir demonstração pública antes de autenticação.

## Runbook resumido

1. Confirmar propriedade ou disponibilidade do domínio no Registro.br.
2. Criar os usuários autorizados no Firebase Authentication.
3. Configurar o secret `AURORA_NEXUS_ALLOWED_EMAILS` com os e-mails autorizados.
4. Adicionar os domínios customizados no provedor de hospedagem escolhido.
5. Copiar os TXT de verificação emitidos pelo provedor para o DNS.
6. Aguardar propagação e emissão de SSL.
7. Executar deploy controlado de Functions e Hosting.
8. Executar smoke test de `https`, tela de login, sessão, logout, permissões por tenant e logs.
9. Atualizar estes arquivos de estado desejado com o status real após validação.
