# AURORA-RESOURCE-OPT-001 — Manutenção contínua, recursos e conflitos

Decisão permanente do titular: 15/10/2026. Extensão de AURORA-MO-001/M08/M10 e do
robô de manutenção existente, não um segundo sistema ou scheduler. A autorização
inclui corrigir algoritmos, fluxos, processos e reescrever código quando necessário;
não remove revisão independente, controles executáveis, isolamento ou recuperação.

## Estado verificável do incremento

A rotina hospedada existente recebeu o mandato de checagem horária por delta.
Este patch acrescenta um avaliador puro read-only, sua representação no registro
nativo e testes sintéticos. Não instala um observador nativo em tempo real, não
consulta faturamento, não altera workflows, não cria locks/filas/bancos e não
executa promoção, cancelamento, ingestão ou escrita financeira. A política é
`PURE_EVALUATOR_IMPLEMENTED_NOT_WIRED`; integração runtime e benefício permanecem
pendentes até prova. A referência a watchdogs existentes não prova sua implantação.

## Cadeia financeira e deduplicação de medição

Execução → requisições/modelos → modalidade de cobrança → tarifa vigente →
débito/extrato → fatura; comprovação de pagamento é um estado adicional distinto.

Preservar fornecedor, conta de cobrança opaca, tenant, ambiente, run/request/attempt,
modelo, tier, período, categorias de tokens e fonte/hash da tarifa e da cobrança.
Somente extratos ou documentos idôneos permitem custo comprovado. Estimativa,
assinatura/franquia, compra e consumo de créditos, rateio e custo local ficam
separados. Não somar compra de créditos ao consumo como duas despesas do scan.
O cache que integra a entrada não é entrada adicional. Tarifas de gravação/leitura
e regras de contexto/tier dependem do contrato/fornecedor e do instante da chamada.

O avaliador desta versão aceita APENAS contadores finais por requisição normalizados,
com cache incluído na entrada. Rejeita telemetria cumulativa/parcial; o adaptador
futuro precisa comprovar deltas, epochs, replays e resets sem dupla contagem.
Mesma identidade com contadores divergentes falha fechada. Exportação repetida do
mesmo evento não duplica; requisições/tentativas efetivamente diferentes continuam
contadas. O resultado mantém custo efetivo e estimado `null`: não aplica preços.
Cobertura limita-se às entradas fornecidas, nunca a todo consumo da conta.

## Workflows, efeitos e reescrita

Inventariar gatilhos, entradas, dependências, destino, efeito, estado, dono, ambiente,
tenant e evidências. Mesmo nome, horário ou prompt não demonstra equivalência.
Agrupar candidatos por efeito/recurso, sem confundir SHA diferente com destino
diferente: duas versões ainda podem competir pela mesma escrita. Testes negativos,
replay de idempotência, plataformas distintas e revisão independente devem permanecer.
Um rótulo de teste não autoriza duas escritas concorrentes no mesmo recurso.

O classificador retorna sinais candidatos, não autorização de cancelar, eliminar
workflow, pular teste, quebrar trava ou omitir consumo. Timeout/falha requer readback
dos efeitos. Consolidação exige equivalência, paridade e dependências comprovadas,
mais transferência coordenada do executor existente. Lease/fencing/CAS só serão
alegados depois de implementação e teste no mecanismo canônico, nunca por strings
iguais ou pelo envelhecimento da trava. Preserve evidência, logs e histórico.

Preferir patch mínimo e refatoração modular. Reescrita extensa exige diagnóstico,
contratos observáveis, testes diferenciais, migração reversível, rollback e avaliação
de custo total. A autorização genérica não permite descartar dados, credenciais,
identidade instalada ou gates. Mudança de governança exige revisão independente
vinculada ao SHA final antes de merge; ninguém fabrica review retroativo.

## Operação eficiente e SLA

Processamento pesado pertence ao Windows Xeon. Mac é interface e supervisão leve;
indisponibilidade do Xeon mantém checkpoint, não desloca a carga. Usar regras nativas,
metadados/hashes e snapshots canônicos antes de modelo externo. Contexto mínimo
inclui dependências relevantes. Cache de evidências tem tenant, versão, ferramenta,
política e critérios de invalidação; não substitui autorização e estado vivo.

Objetivos iniciais, não garantias comprovadas: checagem hospedada horária; triagem
crítica na passagem de detecção; prioridade alta até próximo dia útil; otimizações
rotineiras na revisão semanal existente. Medir evento, observação, triagem, resolução,
reabertura, cobertura e tempo bloqueado por dispositivo/evidência/revisão. O MTTR
legado de 60 minutos é alvo de configuração, não resultado já alcançado. Resolução
não ocorre só porque o sintoma desapareceu; exige causa tratada e teste/readback.

Revisar toda operação por inventário versionado e cobertura incremental: detectar
mudanças por hash, percorrer lacunas em lotes e consolidar revisão global semanal.
Não reprocessar todo repositório a cada hora para dizer que está limpo. Alertas novos
por fato/versão apenas: conflito, regressão, SLA, cobrança divergente ou limite
aprovado. Sem orçamento documentado, manter valor pendente, não inventar teto.

## Piloto e promoção

Comparar baseline/candidato no mesmo escopo com dados sintéticos; medir cobertura,
qualidade, falsos negativos/positivos, retrabalho, latência p50/p95, CPU/RAM/I/O,
filas, tokens e custos comprovados. Incluir o custo da própria manutenção/revisão.
Ganho exige denominador e evidência; zero achados não comprova qualidade equivalente.

Antes do runtime: adaptador de telemetria, sessão/membership atuais, armazenamento
canônico existente, idempotência/auditoria/checkpoint, testes concorrentes/falhas,
CI no SHA final, revisão independente, HML e readback/rollback. Reutilizar o executor
vigente; nenhum scheduler novo neste patch. Não misturar evidência privada de tenants.
Somente regra abstrata, versão, regressões e desfechos validados alimentam o motor.

## Teste deste incremento

`node --experimental-strip-types --test firebase-migration/functions/test/aurora-resource-optimization.test.ts`

A suíte sintética testa contadores, conflitos, isolamento e limites. Ela não prova
runtime real, fatura conciliada, ausência global de conflitos ou economia alcançada.
