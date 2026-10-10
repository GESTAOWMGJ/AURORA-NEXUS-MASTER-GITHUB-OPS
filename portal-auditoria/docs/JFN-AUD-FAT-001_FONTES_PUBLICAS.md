# JFN-AUD-FAT-001 — extensão de rastreio de recursos públicos e benefícios não monetários

Versão metodológica 1.1 — 09/09/2026. Integra a habilidade de Confrontamento de Faturamento e Rastreabilidade da Receita, submódulo 3.1 do Módulo 3 da Consultoria e Auditoria Hospitalar João Neto / JF Neto SM. Não cria um produto paralelo nem substitui as regras anteriores.

## Benefício comercial
Diagnosticar origem, vinculação, execução e recebimento de recursos; confrontar as justificativas de repasse com documentos públicos e evidências internas autorizadas; apoiar previsibilidade e negociação com memória de cálculo. Contratação por diagnóstico retrospectivo, implantação e acompanhamento recorrente. Não prometer cobertura universal de portais, recuperação financeira, prova de lucro, adimplência ou conformidade sem evidência.

## Cadeias separadas
1. Autorização orçamentária / emenda → instrumento → empenho → liquidação → pagamento registrado pelo pagador → crédito bancário do beneficiário → aplicação / prestação de contas.
2. Produção OCI / APAC → faturamento apresentado → aprovado → glosado → transferência ao gestor → pagamento ao prestador → crédito ao hospital → obrigação contratual e repasse ao profissional.
3. Procedimentos remunerados por crédito financeiro → validação da produção → reconhecimento / utilização do crédito. Crédito financeiro não é depósito.
4. Doação em espécie versus bens, projetos, serviços ou cessões. Reconhecimento contábil e avaliação patrimonial não são ingresso de caixa.

Não somar repasses entre entes aos créditos finais do mesmo recurso. O hospital não recebe necessariamente diretamente da União. Valor nacional SIGTAP não é honorário médico nem tarifa contratual específica do hospital.

## Registro mínimo
orgId; CNPJ completo e CNES; esfera e pagador efetivo; fundo intermediário; programa/componente; instrumento e exercício; emenda, autor e ano; fonte/dotação; natureza CASH/FINANCIAL_CREDIT/IN_KIND; estágio; objeto/vinculação; competência de produção/faturamento/contabilidade; emissão/vencimento/pagamento/crédito; valor global/apresentado/aprovado/retido/líquido/creditado; ID da ordem bancária; vínculo com APAC e NF; versão da tabela e regra; URL, data da captura, SHA256, página/linha; cobertura da consulta; revisão e justificativas.

Fonte sem resultados, erro HTTP ou CAPTCHA deve ser registrada como indisponível, não como zero. Não contornar controles de acesso. Não usar busca por nome como substituto de CNPJ/CNES. Filiais e estabelecimentos devem ser reconciliados separadamente.

## Regras determinísticas implementadas
`lib/public-funding.mjs` contém classificação da evidência de crédito, verificação de datas e centavos, aferição de pontualidade somente com vencimento e crédito comprovados e agrupamento de repetições por autor dentro da mesma fotografia de um instrumento.

Valores globais ou liberados repetidos por autores não são novos repasses. Divergências entre valores da mesma fotografia permanecem conflitantes. Liberação superior ao global gera revisão, sem acusação automática. Fotografias de datas diferentes, pagadores diferentes e instituições diferentes não são fundidas.

As funções são puras: NÃO autenticam, NÃO verificam extratos por conta própria, NÃO persistem dados, NÃO liberam pagamentos. Os campos de revisão e identidade precisam ser obtidos pelo backend de fontes confiáveis, nunca aceitos de assertions do navegador. O teste de `orgId` da função não equivale a teste real de isolamento Firebase.

## Integração de plataforma
Next.js/React continua interface; Firebase Auth e App Check produzem credenciais; o backend existente verifica token, revogação, membership e escopo. Persistência futura proposta: organizations/{orgId}/publicFundingRecords e auditEvents; não existe endpoint de escrita novo nesta versão. Fontes públicas podem ser usadas como evidências sem tornar públicos relatórios internos, contratos privados, segredos ou dados de pacientes.

O workflow de browser testa somente páginas sintéticas e o bloqueio seguro de configuração ausente. Os testes FastAPI usam fixtures. Login real, regras em Firestore real, tenant A tentando consultar tenant B, revogação, App Check real, IAM, domínio e logs exigem ambiente de homologação identificado e autenticação autorizada. Nunca trocar essas etapas por aprovação de testes simulados.

## Fechamento e revisão
Divergências sob esclarecimento não bloqueiam automaticamente fechamento gerencial, que pode ocorrer com ressalvas. Achados continuam abertos, sem autorizar pagamento, nota, distribuição ou reconhecimento definitivo. Resposta administrativa, solução documental e liquidação financeira têm estados distintos.

## Fontes a parametrizar por cliente
Portal da Transparência/CGU; FNS/InvestSUS e consultas detalhadas; Transferegov; PNCP; portais estaduais de despesas e convênios; SESA/CIB/Diário Oficial; TCE/SIT e painéis de emendas; prefeitura/FMS; consórcios; CNES/SIA/SIH/SIGTAP; transparência e demonstrações da entidade. Confirmar cobertura e atualização em cada consulta; não confundir portal de contratos com comprovante bancário.

## Critérios de aceite
Cobertura declarada por fonte/período; cada valor ligado à página/linha e estágio; fontes preservadas; ausência ≠ zero; sem dupla contagem; sem inferir margem de empresa médica a partir de superávit do hospital; memória de cálculo; revisão humana; trilha histórica. Valores de receita contábil, caixa livre, caixa vinculado e recursos a realizar não são somados como ingressos independentes.

Nenhum dado financeiro privado de cliente foi incluído no código ou nos testes. Nenhum deploy, migração, alteração de produção, criação de serviço pago ou login real é realizado por esta extensão.
