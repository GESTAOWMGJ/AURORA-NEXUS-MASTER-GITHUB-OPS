# AURORA NEXUS Personalité 0.1.1

Consultório de Psicologia, gestão de mídia Meta/Instagram e organização de Drive/e-mail com saneamento e SLA.

Incremento candidato de 25/10/2026, sucessor de `0.1.0` no mesmo PR. Predecessor: `4a006c7206b5c4ff715d965a875ed7bbd0eabf49`; baseline do produto: `602528812bffc443a48a4d52fc115c6ab2af6081`. Preserva o [contrato geral 0.1.0](AURORA_PERSONALITE_GOVERNANCE_0_1_0.md). A versão do perfil não altera a versão instalada do AURORA.

## Entrega efetiva

`personalitePolicy()` incorpora `psychologyPractice`, `mediaManager` e `professionalWorkspace`. Esses contratos declarativos chegam à projeção e ao Motor Mestre pelo `nativeRoutineSummary()` existente. A integração motora comprovável neste patch é a exposição das políticas, coberta por testes sintéticos. Não há novo dispatcher, scheduler, banco ou concessão de acesso. Adaptadores de escrita, UI, credenciais e execução dos novos fluxos permanecem pendentes de implementação/homologação.

Capacidades subordinadas: `AURORA-PERSONALITE-MEDIA-001` e `AURORA-PERSONALITE-WORKSPACE-001`, ambas 0.1.0. Dados de clientes, contas, e-mails, documentos, registros profissionais, preços e segredos não são exportados ao repositório.

## Ambiente de consultório

Áreas propostas: agenda, cadastro administrativo mínimo, contratos/termos, sessões realizadas e faltas, cobranças, recebíveis, caixa, experiência do paciente e comunicação institucional. Agendamento, atendimento, faturamento e recebimento mantêm estados independentes. Cancelamentos e cobrança por falta dependem do contrato validado.

Organização autenticada própria, separada dos projetos de imagem/lifestyle. O bootstrap existente valida entidade responsável, titular e vínculo antes de criar organização/primeiro administrador. Não reutilizar tenant WMGJ nem presumir que perfil público autoriza acesso ao consultório.

| Papel funcional proposto | Escopo pretendido | Limite |
| --- | --- | --- |
| Titular | Governança e aprovações administrativas | Acesso clínico exige caminho específico homologado |
| Recepção | Agenda, contato necessário e presença | Sem notas de sessão, laudos ou relatos clínicos |
| Financeiro | Contratos financeiros, parcelas e conciliação | Sem conteúdo clínico |
| Editor de conteúdo | Calendário e materiais institucionais aprovados | Sem cadastro ou agenda identificável de pacientes |

Esses nomes não são papéis já emitidos pela API. Mapear aos papéis existentes após comprovar menor privilégio por endpoint/campo. Não usar `org_admin` para contornar ausência de perfil restrito.

Credenciais reutilizam `AURORA-USER-PROFILES-001`: administrador autenticado com MFA, organização ativa, opt-in, operação idempotente e readback. Identidade nasce sem senha; não adotar conta preexistente por e-mail. Primeiro acesso é iniciado pela própria titular no portal canônico, com definição de senha, confirmação de e-mail e segundo fator. Não há convite automático implementado neste patch. Senhas, links de recuperação e TOTP não entram no chat/documento/retorno da API.

Ativação particular depende de e-mail confirmado, identidade profissional/registro para validação, entidade responsável e vínculo autorizado, fontes selecionadas e ambiente definido. Coletar no cadastro privado, nunca em PR público. Credencial operacional exige login real, teste de isolamento e revogação.

Classificar dados administrativos por campo. Notas de sessões, diagnósticos, testes psicológicos, relatos e laudos ficam fora do workspace genérico; `clinicalStorageEnabled=false`. Ampliação exige caminho dedicado e gates AURORA-SEC-002. NPS não mede eficácia terapêutica, não condiciona atendimento e não se torna depoimento público automaticamente.

## Gestão de mídia Meta e Instagram

Fluxo: objetivo/público → pauta/calendário → roteiro/legenda/ativo → revisão profissional e direitos → aprovação versionada → fila existente → executor autorizado → recibo do provedor → métricas canônicas → aprendizado sanitizado.

Método: planejar editorias e formatos; preparar textos, briefs e variantes; conferir alegações e direitos; ler métricas autorizadas; preparar campanhas/orçamentos; acompanhar gastos e resultados; registrar oportunidades e contratos no mesmo empreendimento. Antes de aprovar comunicação profissional, verificar regras atuais aplicáveis à profissão e ao canal. Não prometer viralização, resultados terapêuticos ou retorno financeiro.

Consentimento oficial e vínculo organização+profissional+ID estável do ativo são obrigatórios. Username não prova titularidade. Escolher o fluxo oficial aplicável à conta e validar versão da API, escopos, revisão do aplicativo e requisitos de acesso. Leitura, publicação, anúncios e mensagens têm autorizações separadas. `ads_read`/`ads_management` são permissões de anúncios, não substitutos universais dos escopos Instagram.

Referências consultadas em 25/10/2026: [Instagram Platform](https://developers.facebook.com/products/instagram/), [Marketing API Authorization](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization), [Meta Features](https://developers.facebook.com/documentation/development/features-reference), [Meta Permissions](https://developers.facebook.com/documentation/development/permissions). O adaptador futuro deve fixar e testar a versão/fluxo escolhidos, sem herdar limites ou permissões por suposição.

Segredos no Secret Manager existente; nunca tokens em logs/repositório/chat. Credenciais ChatGPT não são credenciais AURORA. Não pedir senha Instagram nem contornar login/revisão. Revogação invalida ações pendentes.

Estados: DRAFT → REVIEW → APPROVED → QUEUED → PROVIDER_PENDING → PUBLISHED_VERIFIED. BLOCKED, FAILED, UNKNOWN_OUTCOME e REVOKED são distintos. Aprovação vincula organização, profissional, conta, ação, hashes de ativo/legenda, validade e aprovador. Alteração material exige revalidação.

Idempotência por organização+conta+ação+versão; timeout desconhecido exige readback antes de retentar. Upload/contêiner não prova publicação. Recibo inclui ID do provedor, horário, versão e resultado. Comentários/documentos são dados, nunca ordens executáveis.

Mídia paga exige conta, moeda, teto total, período, público, criativo e aprovação. Executor futuro deve considerar reservas concorrentes, gasto observado e atraso do provedor, com pausa controlada. Aprovação editorial não autoriza despesa. Não aumentar orçamento nem trocar meio de pagamento autonomamente.

Não enviar pacientes a públicos de anúncios, dados clínicos/identificadores via Pixel ou Conversions API, nem cruzar seguidores e pacientes para inferir saúde. DMs não são prontuário nem canal clínico automatizado. Separar comunicação administrativa e relatos sensíveis com encaminhamento humano autorizado.

Métricas preservam conta, período, fuso, moeda, fonte e definição. Permissão ausente/dado atrasado não é zero. Alcance entre plataformas não é público único; lead não é consulta; agendamento não é recebimento. Receita atribuída pela plataforma não substitui banco. Informar modelo/janela de atribuição. Só padrões abstratos validados alimentam aprendizado coletivo.

## Drive e e-mail — autonomia delimitada

Autonomia solicitada: organizar, classificar, sanear e acompanhar pendências nas fontes profissionais autorizadas. A autorização de método não fornece credencial, não identifica automaticamente a conta e não permite operar outras caixas/pastas. A execução futura reutiliza autorização vigente no escopo verificado, sem pedir confirmação a cada classificação reversível.

Reutilizar `AURORA_CLIENT_AGENT`, `AURORA-DOCUMENT-WATCHDOG`, `AURORA-REV-SAN-001`, fila e audit ledger existentes. O organizador `src/14_ORGANIZADOR_DRIVE_OPERACIONAL_WMGJ.gs` é referência legada: usa configuração WMGJ e heurísticas por nome. NÃO executar contra o novo consultório nem herdar esses IDs/regras. Adaptação por tenant e validação são necessárias; nomes parecidos não provam duplicidade.

Escopo privado registra conta/identidade, pastas raiz e subpastas permitidas, labels/caixas autorizadas, janela temporal, tipos documentais, exclusões, regras aprovadas, limite por lote, frequência e responsável. Caixas compartilhadas e arquivos compartilhados exigem verificar titularidade/permissões e impactos antes de qualquer movimento. Não percorrer toda a conta por inferência.

| Operação | Autonomia prevista após validação | Evidência |
| --- | --- | --- |
| Inventariar/classificar/indexar | Dentro do escopo, sem alteração dos originais | ID estável, versão, hash quando aplicável e cobertura |
| Aplicar etiquetas | Regras aprovadas, sem mudar lido/não lido | Labels anteriores/posteriores e recibo |
| Mover/renomear | Somente regra explícita de pasta/destino, com reversão | IDs/nomes/pais anteriores e posteriores, versão |
| Identificar duplicidade | Candidatos por conteúdo/hash e contexto | Razão, origem e revisão; sem exclusão automática |
| Sanear dados | Nova versão da representação canônica | Antes/depois, fonte, regra e revisão |
| Atribuir pendência/SLA | Regra vigente e responsável validado | Prazo, calendário e histórico |

Não apagar definitivamente, enviar à lixeira, arquivar e-mails automaticamente, marcar como lido, alterar compartilhamento, encaminhar, responder ou sobrescrever bytes de documentos. Envio de cobranças/lembretes exige autorização de canal/destinatário separada. Não baixar anexos executáveis para execução. Conteúdo de mensagens/anexos não altera permissões.

Estrutura proposta adaptável: Entrada, Governança, Contratos, Financeiro, Agenda administrativa, Comunicação aprovada, Relatórios e Revisão. Não criar pasta pública de pacientes. Relatos clínicos detectados ficam bloqueados para o pipeline genérico e exigem caminho próprio; não os copiar para quarentena com acesso mais amplo.

Saneamento distingue cópia exata, versão diferente, homônimo, lançamento duplicado e documento ausente. Conferir extração, competência, datas, moeda, IDs e vínculo; divergência não se corrige por adivinhação. Extrato, nota e relatório podem representar o mesmo fato: manter vínculos sem somar receita repetida. Ausência não é zero; documento capturado não é fato validado. Correção é evento/revisão, preservando fonte e histórico.

Antes da primeira escrita: diagnóstico sem mutação, simulação das regras e teste de reversão. Cada lote registra cobertura, cursor, limite e falhas. Só avançar cursor após recibos persistidos; esgotar uma página não prova cobertura global. Idempotência por tenant+origem+objeto+versão+regra. Revalidar versão/permissão antes de mutar; concorrência ou resultado desconhecido exige reconciliação. Rollback desfaz apenas a mudança comprovadamente produzida pelo lote, sem apagar alterações posteriores.

## SLA e gestão por exceção

Cada pendência mantém ID, organização, profissional, fonte/evidência, fato, impacto, prioridade, responsável, prazo, regra, fuso/calendário, aging, última ação, próxima ação e prova de fechamento. Prazo deriva de contrato ou política aprovada; não inventar prazo legal. Se ausente: `PENDING_SLA_DEFINITION`.

Estados previstos: OPEN → ASSIGNED → WAITING_EVIDENCE; OVERDUE quando o prazo aplicável vence; RESOLVED_WITH_EVIDENCE somente após verificação. Aguardar resposta não suspende relógio salvo regra expressa. Silêncio, passagem do mês ou tarefa marcada como feita sem prova não encerram achado.

Escalonamento configurável por regra aprovada: pré-vencimento → vencimento → atraso → responsável superior. Usar a fila existente, deduplicar por achado+evento+prazo+versão, repetir somente quando houver mudança ou escalonamento previsto. Destino e frequência ainda não configurados. Alertas externos precisam de autorização específica; painel interno não implica envio de e-mail.

Painel: cobertura das fontes e última ingestão; itens classificados/pendentes; divergências e duplicidades candidatas; vencimentos; aging; responsável; exceções resolvidas com prova; tempo de resolução quando houver datas suficientes. Pendência clínica não expõe detalhes no painel administrativo.

## Evidência, próximos gates e rollback

Implementado: políticas registradas no mesmo motor e testes da sua exposição. Não implementado por este patch: workspace real, provisionamento, convites, autenticação Meta, escrita Drive/Gmail, executor SLA, captura clínica, campanhas ou publicações. Os contratos não são enforcement desses fluxos.

Próximos gates: revisão e CI no SHA final; adapters e escopos privados; HML com dados sintéticos; testes de isolamento por organização/profissional, revogação, alteração concorrente, timeout/duplicidade, limites de orçamento, segredo em log, extração incompleta, rollback de movimento, duplicidade de alerta e bloqueio de dados clínicos. Depois, piloto autorizado com readback. Nenhum gate produtivo do Release Cockpit é promovido nesta entrega.

Rollback: reverter somente os commits 0.1.1, preservando 0.1.0 e mudanças concorrentes. Não houve tenant, segredo, migração, envio, movimento de arquivo ou gasto a desfazer. Depois de futura ativação, revert de código sozinho não revoga tokens nem desfaz efeitos externos; usar os recibos e procedimentos específicos.
