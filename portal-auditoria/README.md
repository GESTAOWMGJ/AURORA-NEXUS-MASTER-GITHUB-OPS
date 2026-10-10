# Portal JFN — Next.js + React + Firebase

Integração progressiva da Consultoria e Auditoria Hospitalar João Neto / JF Neto SM, com a habilidade JFN-AUD-FAT-001. Data: 09/09/2026.

## Estado desta entrega

Código de homologação, não publicação em produção nem ativação de Firebase real. `JFN_INTEGRATION_MODE=disabled` é o padrão. Nenhum arquivo da operação existente é substituído. Nenhuma API de escrita é exposta pelo portal.

Base inspecionada: `GESTAOWMGJ/automacao-gestao-wmgj`, commit `f789dc5694d63d2311b339f3c5bf4485219d2f2c`.

## Arquitetura

```text
Interface React / Next.js App Router
  ├─ /                          entrada institucional
  ├─ /demo                      somente dataset sintético
  └─ /auditoria/{orgId}          competência na URL
            ↓ Firebase Auth + App Check
      /api/dashboard            gateway Next.js, GET e no-store
            ↓ token original + App Check; rota fixa
      FastAPI já existente      valida revogação, vínculo, papel e all_facilities
            ↓
      Firestore já existente    snapshots organizacionais
            ↑
      Fundação WMGJ             ingestão, evidências e controles existentes
```

Next.js já utiliza React; não há dois frontends independentes. O SDK Admin e as permissões continuam no backend atual. O frontend não acessa Firestore diretamente e não cria uma segunda base de usuários ou matriz de papéis.

Contrato reutilizado: `GET /v1/organizations/{org_id}/dashboards/operational?competence=YYYY-MM`, conforme `firebase-migration/api/wmgj_api/app.py`, `auth.py` e `models.py`. A seleção de organização na URL não concede acesso. O backend precisa autorizar um membro ativo com `dashboard:read` e `all_facilities=true`.

## Funcionalidades implementadas

Interface institucional responsiva; login Google via Firebase; App Check reCAPTCHA Enterprise; tokens somente em memória; consultas explícitas, sem polling; filtro de competência; gateway sem cache com timeout e limite de resposta; DTO com allowlist; estados de ausência, erro, completude e atualidade. O relatório do snapshot não é confundido com documento-fonte.

O módulo JFN-AUD-FAT-001 inclui funções determinísticas de diferença em centavos, confrontamento pergunta/resposta/evidência e proposta de fechamento gerencial. Seus exemplos são sintéticos. **O backend atual não oferece leitura detalhada de contratos, produção, notas e repasses para esta tela. Não há conciliação integral real ou persistência de devolutivas nesta versão.**

A diferença entre faturamento e recebimento não é rotulada automaticamente como glosa ou perda. `null` permanece desconhecido. Fechamento gerencial com ressalvas mantém os achados abertos e nunca autoriza pagamento.

## Executar sem serviços externos

Requer Node 22. Os testes de domínio/gateway não precisam instalar dependências:

```bash
cd portal-auditoria
npm test
```

Para executar a interface em ambiente de desenvolvimento com acesso ao npm:

```bash
npm install --ignore-scripts
npm run typecheck
npm run build
npm run dev
```

A demonstração fica em `http://127.0.0.1:3000/demo`. Sem `.env.local`, nenhuma consulta externa é habilitada.

## Homologação conectada — pré-requisitos

Copiar `.env.example` para `.env.local` **somente no ambiente autorizado**, com o Firebase Web App do projeto de homologação. Não inserir conta de serviço, private key, HMAC, senha, CPF ou dados clínicos no arquivo.

O projeto Firebase deve ter prefixo `wmgj-hml-jfn-`; Google Auth precisa estar habilitado, domínio autorizado e App Check configurado. O backend deve estar disponível por HTTPS, apontando para o mesmo projeto, com permissões e snapshot da competência já validados. Só então configurar `JFN_ALLOWED_ORGS`, `WMGJ_CONTROL_PLANE_ORIGIN` e `JFN_INTEGRATION_MODE=homologation`.

Configuração pública do Firebase não substitui autenticação, App Check, IAM ou autorização. Nenhum login, projeto, serviço pago ou configuração acima foi criado por este pacote.

## Verificação e limites

46 testes locais passaram no Node 22.16.0: contratos, null/zero, timezone, centavos, ressalvas e comportamento do gateway com upstream simulado. Isso **não** comprova login real, isolamento IAM, Rules em emulador, build Next, testes de navegador ou integração fim a fim.

O workflow adicionado executa testes, instalação isolada, TypeScript, build e auditoria de dependências. Não usa secrets nem executa deploy. As dependências diretas principais foram fixadas; as transitivas ainda precisam de `package-lock.json` revisado e versionado. O CI preserva o lock resolvido como artefato; não grava no repositório. Usar `npm ci` depois de incorporar o lock aprovado.

Antes de qualquer liberação: CI aprovado; lock versionado; teste de login e revogação; dois usuários de instituições diferentes; validação App Check; teste de navegador; política CSP/limite de requisições; aprovação de segurança; definição do host e rollback. App Hosting oferece suporte Next.js, mas a matriz consultada não confirma suporte ativo à versão 16.3.4; a hospedagem fica pendente de validação. Não habilitar auto-deploy.

## Fontes técnicas

- https://nextjs.org/docs/app/guides/authentication
- https://nextjs.org/docs/app/getting-started/server-and-client-components
- https://firebase.google.com/docs/auth/web/google-signin
- https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- https://firebase.google.com/docs/app-hosting/frameworks-tooling

A continuidade do módulo financeiro está delimitada em `docs/contrato-e-evolucao.md`.
