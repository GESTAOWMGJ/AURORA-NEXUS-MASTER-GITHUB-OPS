# Segurança da API e promoção para FastAPI Cloud

## Homologação primeiro

O pacote `api/` está preparado, mas não vinculado nem implantado. A primeira aplicação FastAPI Cloud deverá ser exclusiva de homologação. Produção exige aprovação manual depois de build, testes, IAM, secrets, Firestore de homologação e revisão de retenção.

## Controles

1. Firebase ID Token verificado no backend, incluindo revogação.
2. Firebase App Check obrigatório por padrão nas rotas autenticadas.
3. Membership ativa em `organizations/{orgId}/members/{uid}`.
4. Permissão derivada do papel; nunca confiada ao cliente.
5. MFA obrigatório por padrão para revisão humana e uso clínico futuro.
6. `orgId` validado no path e na allowlist do serviço.
7. `Idempotency-Key` escopada por organização, rota e UID.
8. Mesma chave + mesmo corpo retorna a execução original.
9. Mesma chave + corpo diferente retorna `409`.
10. Revisão usa `expectedRevision`; concorrência ultrapassada retorna `409`.
11. API e audit trail não registram corpo, bearer token ou segredo.
12. Respostas `/v1/` usam `Cache-Control: no-store`.
13. CSP, `nosniff`, política de permissões e `frame-ancestors 'none'` são definidos pelo serviço.
14. Erros de validação retornam apenas caminho e tipo; nenhum valor de entrada é ecoado.

## Secrets e identidade de serviço

- `OPENAI_API_KEY`: secret do backend;
- `WMGJ_FIREBASE_PROJECT_ID`: variável de homologação;
- credencial Google: workload identity/ADC do runtime;
- service-account JSON: proibido no repositório e no pacote;
- HMAC do Apps Script: não é reutilizado pela API de usuário.

`.fastapicloudignore` exclui `.env`, credenciais, PDFs, XML, XLS/XLSX, testes, evals e dados do emulador.

## Dados clínicos

Mesmo com `OPENAI_API_KEY` configurada, a execução permanece desligada até `WMGJ_OPENAI_EXECUTION_ENABLED=true`. Esse kill switch é independente do bloqueio clínico.

`store=false` não equivale automaticamente a Zero Data Retention. A documentação oficial descreve retenção de abuse monitoring, controles ZDR/MAM sujeitos a elegibilidade e condições específicas para tratamento de PHI/BAA: https://developers.openai.com/api/docs/guides/your-data.

Portanto, o gate clínico só poderá ser removido após validação conjunta de:

- contrato e eventual aditivo de saúde aplicável;
- configuração do projeto OpenAI e retenção;
- base legal/finalidade/necessidade;
- minimização e desidentificação;
- perfis e escopo por unidade;
- resposta a incidentes;
- teste adversarial e aprovação do auditor médico/DPO.

## Deploy

Não usar workflow de deploy em todo push da feature branch. O CI deste PR apenas valida. O primeiro deploy deve ser comando deliberado para uma app de homologação já vinculada, com secrets externos e evidência do commit exato.
