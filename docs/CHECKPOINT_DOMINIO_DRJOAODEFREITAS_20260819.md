# CHECKPOINT OPERACIONAL — drjoaodefreitas.com.br

**Data:** 19/08/2026  
**Registrador:** Registro.br  
**Domínio:** `drjoaodefreitas.com.br`  
**Tenant lógico:** `CONSULTORIO_JOAO_NETO`

## 1. Estado confirmado

| Componente | Estado real |
|---|---|
| Domínio registrado e pago | Confirmado pelo titular |
| Google Workspace contratado | **Não concluído** |
| Tenant Google Workspace criado | **Não confirmado** |
| Usuário `joao@drjoaodefreitas.com.br` | Planejado; ainda não provisionado |
| Aliases institucionais | Planejados; ainda não provisionados |
| TXT de verificação Google | Aguardando token exclusivo do tenant |
| MX do Gmail | Aguardando verificação do domínio |
| SPF/DKIM/DMARC | Planejados; ainda não publicados |
| Site institucional | Código versionado no GitHub |
| Projeto Vercel | Aguardando conexão da conta e importação do repositório |
| DNS web no Registro.br | Aguardando valores oficiais da Vercel |
| Automação de aliases | Código e workflow versionados; depende do tenant e das credenciais administrativas |
| Controle por navegador | Aguardando instalação/conexão do Opera Browser Connector e sessão autenticada do titular |

## 2. Link oficial para contratação

Google Workspace Business Starter:

`https://workspace.google.com/business/signup/welcome?ga_country=us&ga_lang=pt&ga_region=amer&hl=pt-BR&sku=businessstarter&source=gafb-business-businessstarter-pt-BR`

A contratação deve ser iniciada com o domínio existente `drjoaodefreitas.com.br`. O Google gerará o checkout, os termos, a recuperação da conta e o token TXT exclusivo durante a sessão do titular.

## 3. Estrutura de e-mail aprovada

### Caixa licenciada inicial

- `joao@drjoaodefreitas.com.br`

### Aliases previstos na mesma caixa

- `contato@drjoaodefreitas.com.br`
- `agendamento@drjoaodefreitas.com.br`
- `financeiro@drjoaodefreitas.com.br`
- `privacidade@drjoaodefreitas.com.br`
- `admin@drjoaodefreitas.com.br`

Os aliases não terão login ou caixa independentes. Contas independentes futuras exigirão licenças próprias.

## 4. Sequência técnica após a contratação

```text
1. Criar o tenant Google Workspace
2. Criar o administrador joao@drjoaodefreitas.com.br
3. Concluir faturamento, recuperação e autenticação do titular
4. Copiar o TXT exclusivo de verificação
5. Publicar o TXT no Registro.br
6. Validar o domínio no Google Admin
7. Publicar o MX recomendado pelo Google
8. Ativar Gmail
9. Publicar SPF
10. Gerar e publicar DKIM 2048 bits
11. Publicar DMARC inicialmente com p=none
12. Habilitar Admin SDK e delegação administrativa
13. Configurar segredos no ambiente protegido do GitHub
14. Executar provision-google-workspace.yml em modo plan
15. Executar em modo apply após aprovação
16. Testar envio e recebimento de todos os aliases
17. Conectar a Vercel, importar o repositório e publicar homologação
18. Adicionar domínio principal e www à Vercel
19. Copiar somente os registros DNS fornecidos pela Vercel para o Registro.br
20. Validar HTTPS, redirecionamento e cabeçalhos de segurança
```

## 5. Ativos já versionados

- `infra/domains/drjoaodefreitas.com.br/workspace.desired-state.json`
- `infra/domains/drjoaodefreitas.com.br/vercel.desired-state.json`
- `tools/google-workspace/provision.mjs`
- `.github/workflows/provision-google-workspace.yml`
- `.github/workflows/validate-site-drjoaodefreitas.yml`
- `.github/workflows/deploy-site-drjoaodefreitas-vercel.yml`
- `site-drjoaodefreitas/`

## 6. Travas de segurança

- Não registrar senha, cartão, token, código de recuperação ou chave privada no GitHub, Drive, planilha ou chat.
- Não publicar DNS de exemplo.
- Não ativar DMARC com `quarantine` ou `reject` antes de validar SPF e DKIM.
- Não considerar caixa ou alias criado até confirmação no Google Admin.
- Não considerar site publicado até existir URL de produção e HTTPS validado.

## 7. Ponto exato de retomada

```text
TITULAR:
abrir o link oficial, informar drjoaodefreitas.com.br,
criar joao@drjoaodefreitas.com.br e concluir o checkout.

AUTOMAÇÃO:
após o token TXT existir e os conectores Opera/Vercel estarem conectados,
aplicar DNS, ativar Gmail, provisionar aliases e publicar o site.
```
