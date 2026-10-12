# Aurora Nexus 1.1.0-beta.1 — candidato consolidado

Data de verificação: 12/10/2026. Este incremento une experiência visual, controles de acesso e Studio de engenharia dentro do mesmo Aurora. A baseline de engenharia começou em `9c6164f2818314713f24bdc5e53c1bb4f1ed5bdd`; alterações posteriores da main precisam ser incorporadas antes da CI final.

## Mudanças de produto

O painel adota creme, petróleo e dourado com fontes locais Source Serif 4 e Atkinson Hyperlegible Next. Navegação por seção, foco acessível, menu móvel e detalhes técnicos recolhidos reduzem o esforço de leitura. O destaque financeiro prioriza vencimentos e riscos comprovados, conserva centavos inteiros e identifica fontes incompletas e cenários de teste. Não transforma informação ausente em zero nem soma exposições sobrepostas.

O Master exige administrador com escopo completo e MFA confirmado. Dentro da interface, o operador cria um pedido, escolhe arquivos autorizados e, opcionalmente, intervalos de linhas, solicita uma proposta local, examina diferenças, valida o patch, verifica uma área isolada e prepara uma branch/commit local. O modelo não recebe ferramentas, shell ou credenciais. Os checks implementados são estáticos; execução dos testes completos do projeto, push, PR e deploy pelo Studio permanecem pendentes.

A recuperação de senha usa o provedor de identidade. A gestão do autenticador adiciona e comprova um novo fator antes de permitir a retirada do anterior. Existência dos formulários e testes não comprova troca real da credencial pessoal do titular.

## Evidência e gates

| Etapa | Estado observado |
| --- | --- |
| Build/lint TypeScript | Aprovados localmente com Node 22. |
| Rodada principal de Functions | 135 cenários aprovados para painel, sessão, acesso, dados financeiros, setup e Studio. |
| Studio/servidor/conhecimento e atualização | 45 testes de servidor/Studio/registro e 19 de atualização aprovados; inclui ticket expirado, preservação do conhecimento, backup, rollback e conflito concorrente. Pacote Python: 1 teste aprovado. |
| Cliente Master após foco e recibo de conhecimento | 19 cenários aprovados; seleção de linhas, rejeição de intervalos inválidos, recibo, descarte de sessão e fluxo de revisão. |
| Contrato de autenticação/workflow | 16 métodos aprovados em execuções separadas; inclui 20 cenários do probe e análise de 147 blocos Bash. |
| Interface | Conferida pelo navegador no desktop e em viewport móvel; fontes locais carregadas; prévia sintética claramente identificada. |
| CI do candidato consolidado | Pendente. Não reutilizar aprovação de SHA anterior. |
| Instalação atual neste PC | IA Master 1.0.1 preservada. A candidata 1.1.0 exige preservação do registro de conhecimento já instalado, backup e readback. |
| Instalação Mac original | Não inspecionada; não substituída por cliente experimental. |
| Deploy/pin/dados reais deste candidato | Não comprovados por testes locais ou pela prévia. |
| Superdesign canvas | Login expirou; nenhum projeto/draft remoto deste incremento foi publicado. |

Uma execução ampla anterior de Functions teve falhas de fixtures de navegador e ambiente Windows. As fixtures foram corrigidas e os grupos correspondentes passaram. A aprovação da suíte completa no Linux continua sendo gate da CI final; esta tabela não anuncia essa aprovação antecipadamente.

## Preservação e recuperação

O Studio conserva o checkout ativo; alterações ficam em worktree isolada e exigem SHA, hashes, versão e revisão de diferenças. Falha parcial de staging/preparo bloqueia repetição de mutação. O pacote dirty serve apenas à revisão; a instalação exige release limpa, manifesto verificado e paridade com a baseline instalada. O registro de conhecimento existente não pode ser removido ou reclassificado silenciosamente.

O rollout HML reutiliza os gates reais de main, CI, aprovação do ambiente, backup, smoke, assinatura, predecessor e CAS do repositório. O helper incompleto de recuperação ficou fora da release. A limpeza de um resíduo temporário de teste foi recusada pela revisão automática com `blocked by policy`; a pasta foi preservada, sem contorno do bloqueio.

O guia visual e o template reutilizável usam exemplos financeiros ilustrativos. Não constituem dados atuais WMGJ, manifesto original, recibo de instalação, certificação ou prova de operação completa.
