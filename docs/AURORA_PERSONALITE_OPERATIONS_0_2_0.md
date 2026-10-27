# AURORA NEXUS Personalité 0.2.0 — Operação administrativa

Incremento do PR #325 sobre acesso 0.1.2. Integra o mesmo portal, a autenticação existente, o registro `AURORA-PERSONALITE-001` e os checkpoints por organização. Não cria outro banco, aplicativo principal ou executor agendado.

## Comportamento implementado

- Agenda administrativa: contato mínimo, serviços, reserva sem sobreposição, confirmação, cancelamento, realização e ausência.
- Link individual de confirmação: 32 bytes aleatórios, somente hash persistido, validade máxima de 48 horas limitada ao início do horário, substituição do link anterior e consumo idempotente. GET não confirma presença; a pessoa confirma explicitamente por POST. O fragmento é removido do endereço antes da interação.
- Cobranças e conferência manual de extrato: valores inteiros em centavos; hash do arquivo calculado no dispositivo; alocação única; valores divergentes recusados. Conciliação manual não representa liquidação do provedor ou integração bancária.
- Secretaria: rascunho de lembrete mediante autorização de mensagens, sem envio automático e sem outro scheduler.
- Memória administrativa: respostas explicitamente aprovadas pela titular, revogáveis; consulta determinística sem chamadas externas. Não é um modelo generativo instalado nem aprendizado de pesos.
- Website: edição por titular/editor, aprovação da titular vinculada ao conteúdo exato, invalidação após alteração, exportação HTML escapada. Não compra domínio nem publica automaticamente.
- Tarefas por papel. Recepção não recebe valores financeiros; financeiro não recebe contatos; editorial não recebe agenda ou caixa. Administração genérica não concede acesso.

## Persistência e controle

`organizations/{orgId}/runtimeCheckpoints/practice-operations-v1` guarda envelope AES-256-GCM com KMS e AAD vinculada a organização, tipo, versão e identificador lógico. A operação, o recibo de idempotência e a auditoria são transacionais. O recibo nunca guarda a capacidade de confirmação. Um replay revalida primeiro o vínculo atual.

Cada alteração exige sessão verificada, e-mail confirmado e segundo fator pelo mecanismo existente, membership gerenciada atual, papel permitido, origem canônica, JSON e CSRF específico `POST:/api/practice`. A revisão do estado evita sobrescrita de alterações concorrentes. Limites: 500 itens por coleção e estado serializado de 500 KB; trata-se de capacidade de piloto, não arquitetura homologada de escala.

O backend aceita **somente HOMOLOGATION + SYNTHETIC**, mediante `practiceOperations.enabled=true`. Recusa WMGJ, modo REAL e produção. O wrapper KMS exige configuração existente `crypto.state=HML_READY`, versão 1 e AES-256-GCM. A configuração não cria a organização nem aprova entidade/vínculo profissional.

## Painel e acessibilidade

Resumo por snapshot, atualização manual e após gravações; sem polling contínuo. Uma barra HTML para conferência manual, acompanhada de valores e rótulos; sem dependência de Canvas, hover ou gráfico para entender o resultado. Layout de uma coluna no celular, controles de pelo menos 44 px, foco visível, status anunciados e formulários recolhíveis. Últimos dados permanecem visíveis em erro de rede, claramente indicados; perda de autorização limpa as listas e desabilita alterações. Nenhum dado privado é salvo em localStorage.

Orçamento: no máximo três cartões, uma barra de comparação e 500 registros por lista. Não há animação contínua nem notificação externa. Para escala, paginação e armazenamento particionado precisam de novo incremento validado. Exportação do website não inclui contatos privados, agenda, caixa ou memória interna.

## Como testar

```sh
cd firebase-migration/functions
npm ci
npm run build
npm test
cd ../tests
npm ci
npm run test:rules
npm run test:practice
```

`aurora-practice-operations.test.ts` verifica fluxo completo, criptografia/AAD, isolamento, revogação, papéis, idempotência, concorrência, agenda, consentimento, validade do link, finanças e conteúdo do website. `aurora-practice-runtime.test.ts` verifica sessão gerenciada, CSRF, origem e roteamento HTTP. O emulador usa o Firestore e o Auth existentes para provisionamento, recuperação, confirmação de e-mail, negação do primeiro fator e revogação, além da persistência operacional criptografada. A chave de wrapping do teste é efêmera; não comprova Cloud KMS. Cerimônia TOTP real permanece teste de HML.

O percurso de navegador está em `integration/practice-ui.cjs`: usa a página compilada, o redutor e a cifra reais com transporte, identidade e armazenamento de teste. Requer Playwright e Chromium instalados no ambiente de QA; aceita `AURORA_PLAYWRIGHT_MODULE`, `AURORA_PRACTICE_BROWSER` e exige `AURORA_PRACTICE_ARTIFACT_DIR`. Verifica agenda, confirmação, cobrança, memória, website, desconexão e reconexão em 1365 e 390 px. Esse teste sintético não substitui o teste autenticado de HML nem uma chamada ao provedor.

## Ativação real: dependências precisas

1. Identificação e comprovação privada da entidade responsável e do vínculo profissional; aceite da titular; revisor independente ativo com permissão `practice.validate`; grant vinculado ao operador, à organização nova e ao e-mail exato. Um brandbook ou nome de arquivo não constitui essa prova.
2. Provisionar pela rotina existente. Titular define a própria senha no portal, confirma e-mail e cadastra o autenticador. Nenhuma senha será gerada ou inserida no repositório.
3. Homologação no SHA candidato, revisão de segurança e liberação de tratamento real conforme AURORA-SEC-002. O código deste incremento deliberadamente não habilita modo REAL; uma promoção posterior precisa implementar/verificar os gates de CMEK, KMS, recuperação, privacidade e revisão antes de permitir dados reais. A autorização do titular para avançar não comprova que esses testes foram executados.
4. Banco/provedor de pagamentos escolhido, conta da entidade validada, consentimento via OAuth/fluxo oficial, escopos mínimos e segredo no Secret Manager. O adaptador Stripe implementa checkout e webhook exclusivamente TEST, com conta, organização, sessão, valor e moeda vinculados; assinatura HMAC sobre o corpo original e proteção contra replay. Requer segredos versionados específicos da organização no Secret Manager e autorização de escrita do provedor. Foi desenvolvido para validação contratual com fixtures; não comprova chamada real ao Stripe. O adaptador bancário/Open Finance não está implementado; a conferência manual está. Nenhum botão de pago substitui evidência do provedor.
5. Canal de e-mail/WhatsApp autorizado com remetente, regras de consentimento, credenciais protegidas e envio/readback homologados. Esta versão prepara rascunhos, não envia.
6. Domínio final, titular registrante, prazo e preço confirmados na conta Registro.br; DNS e TLS no destino escolhido. Website exportável não comprova registro ou publicação.
7. IA generativa local isolada para o consultório, caso desejada, exige adoção separada no runtime instalado. Não reutilizar o corpus WMGJ. O assistente de regras já funciona sem IA externa.

## Conexão de pagamentos em teste

Configuração server-only: `practicePayments.enabled=true`, `mode=TEST`, `accountId` da conta exata, `apiSecretVersion` e `webhookSecretVersion` com versões numéricas em `projects/{project}/secrets/aurora-practice-{orgId}-stripe-test-{api|webhook}/versions/{n}`. Também exige `providerWriteEnabled=true`; nenhuma dessas flags é editável no painel. IAM deve limitar o acesso às versões autorizadas. Rota de webhook: `/api/practice-payments/{orgId}`. O botão “Gerar checkout de teste” somente retorna uma URL após vinculação transacional da sessão. Chaves LIVE são recusadas. O retorno à página de sucesso não marca pagamento. Reembolsos, disputas e cancelamento de sessão no provedor estão fora deste incremento; não habilitar produção com este adaptador.

Referências técnicas: [Stripe webhooks](https://docs.stripe.com/webhooks), [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [Secret Manager](https://docs.cloud.google.com/secret-manager/docs/access-secret-version).

## Revisão e rollback

Solicitação ao Codex Security Cloud em profundidade média: descoberta do repositório e ambiente concluída; lançamento retornou HTTP 404 em `/api/aardvark/workflow/runs`. Nenhum run ou aprovação independente foi emitido. Essa indisponibilidade não equivale a aprovação.

Rollback operacional: desabilitar `practiceOperations.enabled` na organização correspondente e reverter o candidato pelo fluxo de release existente. Preservar o checkpoint criptografado e a auditoria. Não apagar fontes, membros, chaves ou dados para reverter a interface.

Esta versão é um candidato administrativo testável. Não representa entrega final de operação real, integração bancária, secretariado autônomo com envio, instalação de IA local por cliente ou publicação de website.
