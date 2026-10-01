# Google Workspace — drjoaodefreitas.com.br

**Status:** preparação técnica concluída; contratação, faturamento e autenticação do titular pendentes.

## Estado desejado

- Plano inicial: Google Workspace Business Starter.
- Licenças iniciais: 1.
- Usuário principal licenciado: `joao@drjoaodefreitas.com.br`.
- Aliases sem caixa independente:
  - `contato@drjoaodefreitas.com.br`
  - `agendamento@drjoaodefreitas.com.br`
  - `financeiro@drjoaodefreitas.com.br`
  - `privacidade@drjoaodefreitas.com.br`
  - `admin@drjoaodefreitas.com.br`

Aliases entregam mensagens à caixa do usuário principal e não possuem login próprio. Contas independentes futuras exigem licenças próprias.

## Ordem de implantação

1. O titular inicia a contratação oficial do Business Starter.
2. Informa o domínio existente `drjoaodefreitas.com.br`.
3. Cria o primeiro administrador `joao@drjoaodefreitas.com.br`.
4. Conclui identidade, recuperação de conta e faturamento diretamente no Google.
5. Copia o TXT único de verificação apresentado pelo Google.
6. Publica o TXT no DNS do Registro.br.
7. Após o domínio ficar verificado, publica/valida o MX recomendado pelo assistente Google.
8. Ativa Gmail.
9. Publica SPF.
10. Gera chave DKIM de 2048 bits no Admin Console e publica o TXT correspondente.
11. Aguarda a validação de SPF/DKIM e publica DMARC inicialmente com `p=none`.
12. Habilita Admin SDK e delegação em todo o domínio para o provisionador.
13. Executa o workflow em modo `plan`.
14. Após aprovação do ambiente protegido, executa em modo `apply`.
15. Testa envio e recebimento de cada alias.

## DNS planejado

| Tipo | Host | Prioridade | Valor | Momento |
|---|---|---:|---|---|
| TXT | `@` | — | token exclusivo gerado pelo Google | verificação do domínio |
| MX | `@` | 1 | `smtp.google.com.` | após verificação |
| TXT | `@` | — | `v=spf1 include:_spf.google.com ~all` | após ativação do Gmail |
| TXT | `google._domainkey` | — | chave DKIM de 2048 bits gerada no Admin Console | após ativação do Gmail |
| TXT | `_dmarc` | — | `v=DMARC1; p=none; rua=mailto:privacidade@drjoaodefreitas.com.br; adkim=s; aspf=s; pct=100` | após SPF/DKIM |

Não substituir o token de verificação nem a chave DKIM por valores de exemplo.

## Automação versionada

- Desired state: `infra/domains/drjoaodefreitas.com.br/workspace.desired-state.json`
- Provisionador: `tools/google-workspace/provision.mjs`
- Workflow: `.github/workflows/provision-google-workspace.yml`
- Ambiente protegido: `google-workspace-production`

O provisionador é idempotente: consulta o domínio, valida o usuário principal, compara aliases existentes e cria somente os ausentes.

## Segredos obrigatórios do GitHub

- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_ADMIN_IMPERSONATE`

Esses segredos somente podem ser configurados depois que o tenant do Google Workspace existir e a delegação em todo o domínio estiver autorizada. Nunca armazenar senhas, dados de cartão, códigos de recuperação ou chaves em arquivos do repositório.

## Travas

- A assinatura e o pagamento não são automatizados pelo workflow.
- O titular deve permanecer presente para autenticação, termos, recuperação de conta e faturamento.
- Alterações DNS só devem ser aplicadas com valores apresentados pelo tenant real.
- DMARC não deve evoluir para `quarantine` ou `reject` antes de SPF/DKIM estarem estáveis e os relatórios serem revisados.
