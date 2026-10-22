# Ingestão documental global — candidata de 20/10/2026

Base publicada preservada: `0b6471b7fc83752fd29575342bcfd6b5091a251a`.
Esta candidata implementa um incremento real da capacidade integral pedida,
sem declarar a entrega global concluída. Não altera instalação, fonte, credencial,
autoridade de versão, banco, rotina agendada ou executor publicado.

## Caminho comum

`bytes autorizados → núcleo compartilhado navegador/Node → texto/tabelas/XML efêmeros
→ candidatos estritos revisáveis → observação documental fechada → endpoint existente
→ sourceDocuments/entityVersions/idempotência/auditoria existentes`.

`createDocumentIntakeEngine` é a única implementação de extração. O navegador
recebe o mesmo factory compilado; Node o chama localmente. O adapter Python e os
pacotes correspondentes devem carregar os assets gerados dessa mesma fonte,
verificados pelo gerador/comparador do build. Nenhum conteúdo recuperado pode
fornecer código, comando, URL de backend, modelo ou worker.

Texto, folhas XML, tabelas e prévias permanecem efêmeros. O contrato
`OBSERVE_DOCUMENT_EXTRACTION` envia somente campos positivos de aquisição,
hashes distintos de bytes/texto, método/versão, cobertura e estado. O endpoint
genérico continua recusando narrativa, prontuário, raw/text/OCR, bytes e base64.
A observação é atestação autenticada do cliente; não é assinatura do provedor,
reextração pelo servidor ou prova de autenticidade/veracidade do conteúdo.

## Estado implementado e limites

| Representação | Extração atual | Condição de cobertura |
|---|---|---|
| TXT/Markdown UTF-8 | Texto normalizado em memória | Decodificação estrita, sem controles binários, limites explícitos |
| CSV | Células/linhas e localizadores | Vírgula explícita, aspas válidas, sem adivinhar cabeçalhos financeiros |
| JSON | Representação textual de JSON sintaticamente válido | Não equivale à linha canônica v1 nem infere fatos |
| XML | Texto, folhas, caminho/namespace de cada ancestral | Sem DTD/entidades externas/processamento de instruções |
| DOCX | Partes textuais vinculadas pelo pacote OPC | Namespace/manifesto/relações; imagem, hyperlink externo e objetos mantêm parcial |
| XLSX | Abas efetivamente vinculadas por workbook/rels | Fórmulas não são executadas; resultados não viram fatos por presunção |
| ODT/ODS | Conteúdo ODF com manifesto/tipo explícitos | Repetições além do suporte bloqueiam; fórmulas/scripts/objetos mantêm parcial |
| PDF e imagens/OCR | Backend ainda pendente | Nenhum placeholder ou metadado é tratado como texto |
| DOC/XLS/RTF legados | Adapter ainda pendente | Escopo integral preservado, sem alegação de cobertura |

Limites iniciais: aquisição de 1 MiB, texto normalizado de 256 KiB, 128 partes ZIP,
8 MiB expandidos, XML com profundidade 64 e 100.000 nós, tabelas de até 10.000
linhas/128 colunas. Validar tamanho antes de copiar ou calcular hash. Corte,
backend ausente, proteção, corrupção ou conteúdo vazio não podem virar COMPLETE.
Partes não interpretadas mantêm cobertura parcial ou pendência explícita.

O formulário manual novo lê os bytes selecionados no navegador, mostra prévia
limitada a 4.000 caracteres e registra/repite a observação na mesma sessão com
MFA/origem/CSRF. A prévia limitada não reduz silenciosamente a cobertura da
extração. Pagehide/logout interrompem envio/replay e limpam a prévia. A entrada
manual é identificada por conteúdo: bytes alterados são outro envio, sem alegação
de revisão contínua do mesmo arquivo. A importação canônica JSON existente fica
preservada e tem recibo/aceite distintos.

## Observação não é fato nem instalação

O ramo discriminado usa CAS contra revisão/hash anterior, comparação semântica
sem horário de captura/CAS, e versões imutáveis existentes. Mesma observação em
outro instante mantém a revisão; mesma versão com evidência diferente conflita.
Substituição do snapshot pendente remove fatos correntes não comprovados dessa
versão, sem herdar amountCents/count/competence por merge. Histórico permanece.

O servidor deriva `sourceVersion:null`, `nativeReady:false`,
`sourceIndependent:false`, valores/contagens/competência nulos e revisão pendente.
Recibo de observação retorna `accepted:false`, sem FIRST_INGESTION_VERIFIED,
aceite de instalação ou conclusão operacional. Membership/credencial/emissor e
configurador aplicável são revalidados na mesma transação, inclusive replay.
POST canônico v1 antigo e recibo histórico não podem apagar pendência nova.

`createDocumentFactMapper` reutiliza capacidades estritas dos parsers GS06/GS10:
total NF-e e data em caminhos/namespace/ancestral instanciado exatos; extrato
apenas com DATA/TIPO/VALOR e formatos explícitos. A prévia contém candidatos
minimizados e hashes/localizadores, sem identidade/narrativa bruta. Não valida
XSD, assinatura, autorização ou protocolo fiscal. NF-e é faturamento; emissão
não é competência de serviço, recebimento, saldo ou lucro.

A promoção persistida de fatos ainda exige o próximo incremento de revisão
autenticada com MFA, CAS, vínculo à observação/versão/hash atuais, valores positivos
tipados e versão factual explícita. O servidor que não recebeu texto não pode
alegar ter reexecutado o mapper. Preview sozinho não libera automação/instalação.

## Distribuição e retomada

Novos módulos, gerados e manifestos devem participar da mesma closure do Windows
Integration, IA Master, bundle Windows, satélite e Beta One. Falta de Node compatível
ou de um arquivo/hash esperado mantém backend/configuração pendentes. Testes devem
executar os bytes empacotados em sandbox sem resolver módulos em caminhos de QA.
O rollback preserva configurações/fila/histórico e exige baseline/CAS compatíveis.
Mac mantém a identidade original; app iOS, assinatura e aceite têm gates próprios.

A enumeração contínua de nuvem v1 continua estruturada até a integração da nova
observação aos cursores/fila existentes. A próxima etapa deve separar recibos de
aquisição das pendências de interpretação, sem bloquear toda a enumeração no
primeiro PDF e sem apagar pendência pelo desaparecimento da fonte. Exportações
Docs/Sheets podem ter ZIP variável na mesma versão: não omitir byteHash nem tratar
versão igual como bytes iguais. Reutilização de prova já persistida exige versão,
representação e configuração atuais; nova materialização divergente fica em revisão.
Drive readonly não autoriza cópia/OCR no provedor nem ampliação silenciosa de OAuth.

## Pesquisa de PDF/OCR anterior à incorporação

PDF.js fornece parsing/renderização browser/Node, com pacote e worker próprios.
Tesseract.js faz OCR de imagens e não interpreta PDF; é necessário renderizar
páginas antes. Seus defaults podem buscar worker/core/modelos por CDN, portanto o
Aurora exige assets locais/same-origin fixados e rede de backend fechada, sem URLs
arbitrárias ou download durante a operação. [PDF.js](https://github.com/mozilla/pdf.js/blob/master/README.md),
[Tesseract.js](https://github.com/naptha/tesseract.js/blob/master/README.md),
[instalação local oficial](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md).

Pesquisa e medição estática em QA não são incorporação nem extração PDF/OCR testada.
Pacotes completos excedem orçamentos atuais; subset exige assets realmente
necessários, licenças/notice, SRI/SHA, SBOM, versões transitivas e matriz browser/Node
por plataforma. Aumentar orçamento exige decisão explícita, limite finito e testes
de ZIP aninhado, endpoint/memória/tempo; não ajustar número só para passar.

Para o preview fiscal, o leiaute oficial define total vNF e formatos numéricos/data;
isso não equivale a validação fiscal do documento.
[MOC NF-e/NFC-e, Anexo I](https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-anexo-i-leiaute-e-rv.pdf).

## Gates e evidência

Testes locais sintéticos são estados separados de CI, scan, emulador/HML, acesso
real aos provedores, implantação, adoção e aceite nativo. Regressões exercitam
bytes reais sintéticos e o mesmo factory browser/Node, não somente metadados.
Formatos/backends/canais pendentes e a promoção humana devem permanecer ativos até
prova própria. A fonte oficial e as instalações atuais permanecem congeladas.

## Checkpoint de desenvolvimento — 22/10/2026

A candidata foi recuperada do trabalho local ainda não commitado e preservada antes
de qualquer reconciliação. Na árvore de trabalho sobre `0b6471b7fc83752fd29575342bcfd6b5091a251a`,
foram executados 66 testes Node/TypeScript de extração, interface, mapeamento,
observação e runtime: 66 aprovados, zero falhas/skips. O adaptador Python passou
12 testes, incluindo execução com os módulos efetivamente empacotados, rejeição
de asset alterado, replay e preservação de pendências de PDF/imagem. A compilação
TypeScript sem emissão e `git diff --check` também passaram. Runtime de teste:
Node 24.19.0 no Windows; a CI usa sua própria configuração de versão.

Esses resultados não são CI, revisão independente, publicação, instalação nem
prova de ingestão de dados reais. A `main` observada na retomada é
`226a7f101f4bf1e0680afca2459132f01ebaf71d`, que inclui os conectores Notion/Slack;
a reconciliação e os testes no SHA final são obrigatórios antes de promoção.
O objetivo de cobertura integral permanece aberto enquanto houver formatos,
fontes, paginação, credenciais ou validação operacional pendentes. Não mudar
`globalDocumentAcquisitionVerified` ou `fullSynchronizationVerified` apenas
pela existência deste código ou de um checkpoint.

### Reconciliação dos contratos de distribuição e CI

A primeira CI da candidata `dba026bec387b761941fa6dc181d5bcaf1d1b3c8`
expôs expectativas legadas de Windows Integration 1.0.7/sete arquivos e IA Master
34 arquivos, ausência das dependências de compilação antes da primeira verificação
de pacote e APIs de codificação ausentes na fixture de navegador. Os contratos
agora verificam explicitamente Integration 1.0.8/doze arquivos e IA39, mantendo
verificação exata de nomes/hashes, rejeições e cobertura dos recibos históricos.
A dependência TypeScript é instalada pelo lockfile antes da verificação de pacote;
a origem deve ser um SHA exato antes de qualquer geração.

O gerador deixa de verificar metadados e depois abrir o mesmo destino por nome.
Publica bytes preparados em diretório temporário privado do checkout por renomeação,
sem abrir o destino antigo. Regressões verificam troca normal, preservação do alvo
externo de hardlinks/symlinks, rejeição de nomes e falha de renomeação. Isso não
substitui o resultado do CodeQL do novo SHA nem torna diretório de build não confiável.

Na árvore corrigida, 202 testes locais passaram e três foram omitidos por limites
ou diferenças de plataforma: criação de symlink de arquivo no Windows e dois casos
específicos de POSIX/macOS. Não foram removidas verificações nem ampliadas permissões
para executá-los. TypeScript e comparação dos assets gerados também passaram.
A compilação/teste da árvore de trabalho não é um artefato aprovado para instalação;
a CI e o pacote limpo devem estar vinculados ao novo commit.

O alerta Dependabot #67 foi identificado em `firebase-migration/api/uv.lock`
(`certifi`), com correção já proposta no PR #295. Reutilizar esse PR; não duplicar
nem misturar a mudança de dependência ao incremento documental. O alerta continua
aberto até resolução própria comprovada e é um gate separado de promoção.
