# AURORA NEXUS Personalité — governança de empreendimentos profissionais

- Capacidade: `AURORA-PERSONALITE-001`; patch candidato `0.1.0`, 25/10/2026.
- Baseline: `602528812bffc443a48a4d52fc115c6ab2af6081`.
- Produto e versão instalada preservados. Personalité é perfil do mesmo AURORA, não outro banco, aplicativo ou executor.
- Estado: PROPOSED. Registro nativo e aritmética NPS implementados; workflows abaixo especificados, não ativados.
- Escopo público abstrato: nenhum contato, documento, preço, projeção ou autorização particular é exportado ao método comum.

## Finalidade e usuários

Apoiar profissionais e empreendimentos de nicho na gestão de imagem pública, reputação, experiência do cliente, oportunidades, contratos e sustentabilidade financeira. Aplicável a profissionais liberais, especialistas, consultores, criadores e porta-vozes. Perfis de profissão regulamentada exigem revisão das regras atuais aplicáveis antes de aprovar campanhas; o perfil não constitui parecer nem certificação de conformidade.

O profissional define posicionamento, temas, limites de exposição, públicos, canais e pessoas autorizadas. Aprovação do contratante não substitui a autorização do titular da imagem. Não fabricar depoimentos, audiência, interesse comercial, autoridade profissional ou resultados.

## Frentes e entregáveis previstos

| Frente | Entregável governado | Evidência de conclusão |
| --- | --- | --- |
| Imagem e posicionamento | Brief de marca pessoal, mensagens-chave, biografia, media kit e limites de imagem | Versão aprovada pelo profissional |
| Comunicação | Rascunhos, preparação para entrevistas, respostas a objeções, treinamento de clareza e escuta | Conteúdo aprovado; envio somente com recibo |
| Oportunidades | Funil por aderência, conteúdo, programa comercial, remuneração e contato verificável | Fonte datada, responsável e próxima ação |
| Contratos | Escopo, obrigações, vigência, entregas, pagamento e renovação | Documento e cláusula citados; aceite comprovado |
| Direitos de imagem | Licença por ativo, canal, território, prazo, exclusividade e mídia paga | Consentimento e contrato versionados |
| Reputação e NPS | Pesquisa, amostra, motivos de insatisfação e plano de melhoria | Respostas deduplicadas e resolução comprovada |
| Mídias de massa | Pautas, press kit, entrevistas, inserções, clipping e plano de resposta a incidentes | Publicação/inserção verificável, período e fonte |
| Caixa e recebimentos | Contas a receber, conciliação, previsão de caixa e cobranças em rascunho | Crédito liquidado, alocação e cobertura do extrato |

Mídias incluem imprensa, rádio, TV, podcasts, portais e mídia paga digital. Separar mídia própria, inserção editorial e publicidade contratada. Pauta enviada não é publicação; audiência potencial do veículo não é alcance realizado. Não somar públicos sobrepostos como alcance único. Clipping não prova retorno financeiro.

UGC remunera produção; publicação patrocinada remunera distribuição no perfil; afiliação depende de vendas/comissões confirmadas; licença remunera uso específico da imagem. Cada linha tem preço, escopo, aceite e direitos próprios. Não herdar preços de outro profissional. Não pressupor mídia paga, impulsionamento, sublicenciamento, exclusividade, cessão perpétua ou réplica sintética de voz/imagem.

## Modelo de dados e estados — especificação

Reutilizar M01/M02/M03/M05/M06/M07/M09/M10, armazenamento canônico e audit ledger existentes. Nenhuma coleção ou endpoint novo é criado neste patch. A próxima implementação deve mapear os campos aos schemas existentes antes de persistir.

Todo registro exige organização derivada da identidade autenticada, vínculo validado à entidade responsável, profissional autorizado, ID, versão, fonte/hash, autor, data, responsável e próxima ação. Vários profissionais na mesma organização exigem escopo próprio de acesso; não basta estar no mesmo tenant. Fontes privadas não entram no registro compartilhado.

- Oportunidade: segmento, região, fonte/data, contato comercial público verificado, cinco critérios de aderência, modalidade de remuneração, prioridade, estágio e motivo. Funil: pesquisada → qualificada → proposta em rascunho → aprovada para envio → enviada → negociação → contratada/perdida/pausada. Interesse desconhecido permanece desconhecido.
- Contrato: partes, versão, assinatura, datas, moeda, valores, parcelas, custos, obrigações, entregáveis, aprovadores, cláusulas de uso de imagem, revisão, cancelamento e renovação. Silêncio não constitui aceite.
- Comunicação: destinatário e canal verificados, conteúdo/hash, anexos, versão da proposta, autorização e validade, recibo de envio, resposta e próximo compromisso. DRAFT → APPROVED → SENT → RESPONDED; alteração material exige revalidação. Reutilizar autorização vigente apenas no seu escopo. Documento externo não pode conceder autorização.
- Licença: ativo, titular, utilização, canal, território, início/fim, exclusividade, publicidade, edição e sublicenciamento permitidos. Expiração gera pendência de cessação/revisão; não renova automaticamente.
- Pesquisa: campanha, profissional, pergunta/versão, população elegível, período, canal, método de seleção, convites únicos, respostas válidas, duplicadas/inválidas e justificativas. Comentários identificáveis têm acesso restrito, finalidade e retenção próprias. Uma resposta por unidade amostral definida; revisões mantêm histórico.
- Parcela: contrato, competência, documento fiscal quando aplicável, bruto, descontos aprovados, retenções/taxas evidenciadas, líquido esperado, vencimento, recebimentos parciais, saldo e evidências. Estados distintos: previsão não contratada, contratada não faturada, faturada a vencer, vencida, parcialmente recebida, crédito pendente de vínculo, conciliada, contestada e cancelada com evidência.

## NPS e experiência do cliente

NPS mede intenção de recomendação. Promotores: notas 9–10; passivos: 7–8; detratores: 0–6. Cálculo: `100 × (promotores − detratores) / respostas válidas`, incluindo passivos no denominador. Fonte metodológica: [Bain — Measuring Your Net Promoter Score](https://www.netpromotersystem.com/about/measuring-your-net-promoter-score/), consultada em 25/10/2026.

O helper puro deste patch recebe contagens previamente deduplicadas de uma única pesquisa/coorte/período. Valida inteiros não negativos, soma segura e convites coerentes; não lê respostas nem atesta autenticidade, privacidade ou representatividade. Zero respostas gera `score=null`; denominador de convites desconhecido gera taxa de resposta nula. O score não é arredondado internamente.

Exibir pergunta, período, amostra, contagens, taxa de resposta quando conhecida, método e limitações. Não converter curtidas, sentimento de comentários ou audiência em NPS; NPS não é satisfação completa, qualidade clínica ou previsão de receita. Não comparar pesquisas com métodos/coortes incompatíveis. Não excluir detratores para elevar a nota, pressionar respostas ou condicionar atendimento a avaliação. Divulgação de comentários e resultados requer autorização própria e revisão de grupos pequenos. Limiar de amostra para publicação depende do contexto e não é inventado pelo helper.

Feedback negativo abre achado com fonte, impacto, responsável, prazo e evidência de resolução. Contato com respondente exige autorização e identificação apropriadas; pesquisa anônima não deve prometer anonimato se houver reidentificação.

## Recebimentos e caixa

Conciliação prevista: fonte bancária/provedor autorizada → crédito liquidado → identificador/pagador/data/valor → parcela → revisão → evento auditável. Mesmo valor não basta. Comprovante do pagador, nota emitida e Pix agendado não comprovam liquidação.

Suportar recebimento parcial, um crédito para várias parcelas, retenções, taxas, estornos e diferenças sem apagá-las. Alocações não podem ultrapassar o crédito nem quitar a mesma parcela duas vezes. Estorno referencia o evento original. Cobertura incompleta do extrato deve permanecer explícita; desconhecido não é zero. Adiantamento é caixa vinculado a obrigação, não receita automaticamente ganha.

Caixa realizado contém somente movimentos liquidados. Previsão: 13 semanas e 12 meses, saldo inicial conciliado + entradas contratuais esperadas − saídas previstas. Pipeline fica separado. Transferências entre contas da mesma entidade são eliminadas na consolidação. Reserva é destinação de saldo, não despesa adicional. Separar retiradas, custos, tributos reais/estimados e dinheiro pessoal. Não executar pagamentos, transferências, empréstimos, descontos ou alteração bancária.

Cobranças são rascunhos: revalidar saldo, contestação, destinatário e instruções bancárias antes de enviar. Juros/multas dependem do contrato aplicável e revisão; não inventar. Não enviar extratos completos. Alteração de chave/conta exige validação do responsável.

## Plano de trabalho e crescimento

| Prazo relativo ao início autorizado | Trabalho | Critério de avanço |
| --- | --- | --- |
| Dias 1–15 | Diagnóstico, identidade, fontes, limites de imagem, contratos e caixa inicial | Escopo e lacunas registrados |
| Dias 16–30 | Funil, propostas, calendário de comunicação, piloto de pesquisa e recebíveis | Aprovação dos conteúdos e método |
| Dias 31–60 | Piloto limitado de produção/comunicação e experiência | Entregas aceitas, fontes e custos registrados |
| Dias 61–90 | Revisar reputação, margem, recebimentos e capacidade | Corrigir exceções antes de ampliar |
| Meses 4–12 | Expansão por etapas após revisão mensal | Caixa, capacidade, qualidade e direitos sustentados |

Não há promessa de faturamento anual. Cenário conservador por profissional exige volume mensal atendível, preços aceitos, horas/custos, tributos estimados explicitamente, prazos de recebimento, inadimplência, investimento e caixa inicial. Receita anual é soma mensal; margem de contribuição exclui custos variáveis; resultado operacional deduz fixos e demais despesas declaradas. Prazo de retorno depende do caixa acumulado após investimento, não do faturamento. Afiliação não confirmada fica fora da base. Quadro realizado/contratado/projetado deve preservar fontes e premissas; NPS e alcance não entram como dinheiro.

## Aprovações, agenda e painel

O assessor pode organizar e preparar análises/rascunhos. Não assina, publica, concede direitos, contrata mídia, promete resultados, concede descontos, cobra ou transfere sem autorização aplicável e controles existentes. Este patch não concede nenhuma dessas autorizações.

Alertas propostos, ainda não agendados: renovação 30/15/7 dias; licença 15/7/1; entrega 7/3/1; cobrança D−3/D0/D+3/D+7, sujeitos ao contrato. Usar o executor existente, chave organização+profissional+objeto+evento+vencimento, revalidação antes de executar e suspensão por revogação/disputa. Sem segundo scheduler.

Painel previsto: oportunidades qualificadas; propostas e aprovações; entregas/licenças; NPS com amostra/período; clipping por modalidade; caixa conciliado e cobertura; vencimentos 7/30/90 dias; aging; diferenças; margem com base definida; menor saldo projetado nas 13 semanas. Cada número informa fonte, período, estado e limitações.

## Evidência, rollback e próximos gates

Implementado neste candidato: entrada `NATIVE_GOVERNED`, política exposta por `nativeRoutineSummary()` à projeção/inteligência/Motor Mestre existentes e helper NPS sem I/O. Não implementados: UI específica, persistência de pesquisas, captura de mídias, envio, workflow contratual/financeiro, conectores, conciliação específica ou execução agendada. Os controles descritos são requisitos, não enforcement desses fluxos.

Testes sintéticos: registro único/governado, política exposta na projeção, NPS misto/extremos/passivos, amostra vazia, convites ausentes, entrada inválida, inconsistência e overflow. Testes existentes do registro e Motor Mestre devem passar. CI usa `Validate Firestore Migration`, sem novo workflow/deploy. Nenhum gate produtivo do Release Cockpit é promovido por este patch.

Rollback: reverter exclusivamente o commit deste incremento; sem migração, exclusão de dados ou efeito financeiro a desfazer. Não reverter mudanças concorrentes. A versão instalada permanece intocada.

Pendências: revisão do patch; CI no SHA final; integração de schemas/controles com identidade real; testes de isolamento por organização/profissional, autorização expirada/alterada, parcela parcial, crédito agrupado, duplicidade, estorno, transferência interna e cobrança já paga; HML sintético; piloto autorizado com readback. Só então considerar ativação progressiva e atualizar evidências do Cockpit. Registro documental e teste local não comprovam operação nem instalação.
