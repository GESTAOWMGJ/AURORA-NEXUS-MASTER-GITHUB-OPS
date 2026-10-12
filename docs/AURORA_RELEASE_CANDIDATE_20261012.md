# Aurora Nexus 1.1.0-beta.1 — candidato consolidado

Data de verificação: 12/10/2026. Este incremento une experiência visual, controles de acesso e Studio de engenharia dentro do mesmo Aurora. A baseline de engenharia começou em `9c6164f2818314713f24bdc5e53c1bb4f1ed5bdd`; alterações posteriores da main precisam ser incorporadas antes da CI final.

## Mudanças de produto

O painel adota creme, petróleo e dourado com fontes locais Source Serif 4 e Atkinson Hyperlegible Next. Navegação por seção, foco acessível, menu móvel e detalhes técnicos recolhidos reduzem o esforço de leitura. O destaque financeiro prioriza vencimentos e riscos comprovados, conserva centavos inteiros e identifica fontes incompletas e cenários de teste. Não transforma informação ausente em zero nem soma exposições sobrepostas.

O portal Master exige administrador com escopo completo e MFA confirmado. A interface local reutiliza a sessão privada do componente existente, sem anunciar MFA cloud. Dentro de ambas as interfaces, o operador cria um pedido, escolhe arquivos autorizados e, opcionalmente, intervalos de linhas, solicita uma proposta local, examina diferenças, valida o patch, verifica uma área isolada e prepara uma branch/commit local. O modelo não recebe ferramentas, shell ou credenciais.

O Publisher opt-in vincula essa versão à organização, aos hashes dos executáveis revisados e ao repositório de engenharia fixo. A sexta etapa cria somente uma branch exclusiva e um PR draft, registra intenção e recibos, reconcilia timeouts por leitura e consulta metadados de CI. Se a main avançar durante a criação, o draft observado conserva sua base real e a base revisada original, sem liberar promoção. A tarefa e a publicação têm revisões próprias. A consulta permanece `ciVerified=false`, com checkout e cobertura obrigatória não observados; testes gerais do projeto, merge, deploy e instalação não são operações dessa API.

A recuperação de senha usa o provedor de identidade. A gestão do autenticador adiciona e comprova um novo fator antes de permitir a retirada do anterior. Existência dos formulários e testes não comprova troca real da credencial pessoal do titular.

## Evidência e gates

| Etapa | Estado observado |
| --- | --- |
| Build/lint TypeScript | Aprovados localmente com Node 22. |
| Rodada principal de Functions | 135 cenários aprovados para painel, sessão, acesso, dados financeiros, setup e Studio. |
| Studio/servidor/Publisher/interface local | 89 cenários aprovados na bateria final Windows/Node 22.23.3, sem falhas ou skips: servidor 26, Studio 19, Publisher 25 e interface local 19. |
| Conhecimento, leitura e atualização | Em execuções próprias, 5 cenários do registro preservado, 15 de leitura e 19 de atualização aprovados; incluem backup, rollback e conflito concorrente. Pacote Python: 1 teste aprovado com os arquivos, fontes, hashes e ZIP finais. |
| Cliente Master com Publisher | 32 cenários aprovados; inclui recibos, organização, revisão própria da publicação, base divergente, reconciliação explícita e acessibilidade das áreas de código. |
| Contrato de autenticação/workflow | Após a integração da main, 15 métodos aprovados em execução Windows; 20 cenários do probe preservados, preflight 23 e análise de 27 YAML/158 blocos Bash na fonte então observada. A CI do head final continua necessária. |
| Interface | Conferida pelo navegador no desktop e em viewport móvel; fontes locais carregadas; prévia sintética claramente identificada. |
| CI do candidato consolidado | PR #224 draft. O head `48f04ddc3c7032e208d272fa738d3f3022dd1b61` aprovou todos os nove checks, incluindo CodeQL agregado, 755 Functions, 128 IA Master, 29 Firestore e 19 downloads no Linux, sem skips. A correção posterior do leitor BOM exige nova CI e novo pacote do seu SHA. |
| Pacote de CI | O artefato do run `38304303719` foi marcado dirty por bytecode Python gerado pelo teste. Não foi instalado. A correção versiona a exclusão de `__pycache__` e adiciona um gate de dirty=false, SHA exato e hashes de todos os arquivos antes da retenção do pacote. |
| Pacote limpo verificado | Run `38305486029`, artefato `11772891155`: digest externo `662aec6a42cf271c65f88259666fa5fcc2dffaaf10a436d8c6f073d47fce6c7b`, ZIP `29b7f2c866fb8e0d346f242c5de444cd7950e6929cafeef0e830fac6a7f96ab9`, manifesto `e9847773ffe585b00b303df5ea2f76e74b5cc1da4cce3fbb41853d6fee2d522b`; 26 arquivos/27 entradas conferidos. Não instalado: o preflight encontrou BOM UTF-8 nos metadados legados. |
| Instalação atual neste PC | IA Master 1.0.1 preservada. Os 13 arquivos do manifesto foram conferidos em 12/10 sem divergência; hash do manifesto `e731d8d04886271befcc109369c84dab59de27cbbf82a4eeddfec5d7a7dddebb`. A candidata 1.1.0 exige pacote limpo, backup e readback. |
| Instalação Mac original | Não inspecionada; não substituída por cliente experimental. |
| Deploy/pin/dados reais deste candidato | Não comprovados por testes locais ou pela prévia. |
| Superdesign canvas | Login expirou; nenhum projeto/draft remoto deste incremento foi publicado. |

Uma execução ampla anterior de Functions teve falhas de fixtures de navegador e ambiente Windows. As fixtures e a leitura de CRLF foram corrigidas; o harness Windows usa delimitador de PATH correto e ferramentas explícitas. O rerun Windows observou 753 aprovados, um caso de modo 0600 divergente e um skip de symlink indisponível. A asserção de modo não foi relaxada ou simulada. A CI Linux no head `4de6f4a` aprovou todos os 755 cenários, incluindo essa propriedade e o symlink; as mudanças posteriores continuam exigindo CI do seu próprio SHA.

## Preservação e recuperação

O Studio conserva o checkout ativo; alterações ficam em worktree isolada e exigem SHA, hashes, versão e revisão de diferenças. Falha parcial de staging/preparo bloqueia repetição de mutação. O pacote dirty serve apenas à revisão; a instalação exige release limpa, manifesto verificado e paridade com a baseline instalada. O registro de conhecimento existente não pode ser removido ou reclassificado silenciosamente.

O preflight real identificou BOM UTF-8 em `installation.json`, cujo hash permanece `a4ca0588ef078b294a4716b014ab150f8fff9a42c336788a31a195fa0a7e00ef`; o Master 1.0.1/PID 22088 continuou em execução. O leitor atualizado aceita um único BOM inicial para metadata/opções, conservando o Buffer original para hash, CAS, backup e rollback. Os 25 testes passaram em Node 22 e no Node 24 instalado; o preflight somente leitura do leitor corrigido conferiu a baseline e o pacote anterior sem mudar arquivos ou processos. Instalação e aceite continuam pendentes do novo pacote exato.

As leituras locais de configuração, registros, hashes de workspace e recibos usam descritor aberto, identidade do arquivo, limite de bytes e conferência após a leitura. Os testes incluem troca do arquivo, escrita de mesmo tamanho, crescimento, truncamento, leitura parcial e fechamento do descritor após erro. A fronteira continua incluindo a conta Windows; isso não comprova isolamento contra todos os reparse points ou processos hostis da mesma conta.

O CodeQL marcou como corrigidos os quatro alertas de leitura por pathname e os três alertas anteriores de fixtures. Os alertas #38 e #39 foram tratados como falsos positivos com justificativas e readback de dismissal: endpoint fixo de inferência em loopback sem redirect/fallback externo e seleção da única receita estática, sem retirada dos gates de autenticação/estado/versão. Não foram desabilitadas queries. O novo despacho explícito e a fixture sem distinção de maiúsculas passaram 38 cenários e integração HTTP mock das três operações, mas seu resultado no scanner depende da próxima rodada.

A correção restrita de UUID nos testes Firebase preserva o Firebase CLI 15.32.1 e o analytics com UUID 14.0.2. O UUID vulnerável transitivo foi substituído por 11.1.1, com testes de buffer, importação real e 29 cenários do emulador Firestore. O audit ainda observa nove agregações de dependências de desenvolvimento, sete altas e duas moderadas; não há declaração de audit integralmente limpo.

O preflight do domínio oficial continua falhando em `CANONICAL_PORTAL_HTTP_INVALID`. A consulta do Hosting no run `38300443875` observou `HOST_ACTIVE`, `CERT_ACTIVE` e `OWNERSHIP_MISMATCH`; a tentativa de atualização de metadados teve retorno confirmado, sem mudança DNS/IAM e sem resolver a titularidade. O painel Registro.br exige login. A prévia local não comprova esse acesso oficial.

O rollout HML reutiliza os gates reais de main, CI, aprovação do ambiente, backup, smoke, assinatura, predecessor e CAS do repositório. O helper incompleto de recuperação ficou fora da release. A limpeza de um resíduo temporário de teste foi recusada pela revisão automática com `blocked by policy`; a pasta foi preservada, sem contorno do bloqueio.

O guia visual e o template reutilizável usam exemplos financeiros ilustrativos. Não constituem dados atuais WMGJ, manifesto original, recibo de instalação, certificação ou prova de operação completa.
