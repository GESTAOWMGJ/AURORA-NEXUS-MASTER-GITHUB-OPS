# PDF textual — incremento candidato de 23/10/2026

Base de engenharia: `1eb89666b7c9d468958c7c6f226b69c901588be2`.
Estado: implementação e testes sintéticos locais; revisão independente, scan,
CI, publicação, adoção e aceite nativo continuam gates próprios. Nenhuma
instalação, fonte real, credencial, permissão ou executor agendado foi criado.

## Caminho efetivo e cobertura

O mesmo `createDocumentIntakeEngine` recebe o backend PDF fixado, nos bytes
Node/Python e no portal. O parser fica em worker descartável: o thread principal
apenas confere entrada, hashes, assets e resultado fechado. A implementação
`document_pdf_runtime.mjs` é a mesma nas duas plataformas. Ela usa somente
`getDocument` com bytes e `streamTextContent`; não chama render, actions,
JavaScript do PDF, XFA, links, OCR, canvas ou modelo. A API não recebe URL,
password ou configuração fornecida pelo documento.

Texto real sai em memória, por página/item, normalizado em Unicode. O hash dos
bytes não é o hash do texto. Todo PDF com texto permanece **PARTIAL**, com base
`BOUNDED_REPRESENTATION`: ler texto não comprova imagens, formulário, anotação,
layout, autenticidade ou semântica completa. PDF só com imagem permanece
`PENDING/BACKEND_REQUIRED`, sem texto/hash inventados. Proteção por senha retorna
`FAILED/ENCRYPTED_DOCUMENT`; corrupção e limites retornam falhas fechadas. O
servidor e o validador Python recusam `PDF_TEXT/COMPLETE`, MIME divergente e mais
de 32 páginas. Valores/fatos, instalação e sincronização global não são promovidos.

## Dependência e reprodução

Perfil `PDFJS_6_4_299_TEXT_V1`, pacote oficial `pdfjs-dist 6.4.299`, commit upstream
`d0991a0d53f3bb3a7307e3b83f279c1d117aafb3`. O tarball tem 8.539.589 bytes,
SHA-256 `86269b40170eb41740ea05ad2102d71d33de4f122b34eb2f478be0ea7779c415`
e SRI SHA-512 fixado no gerador. Ele é inspecionado por nome/tipo/tamanho e nunca
é executado, instalado com hooks ou adquirido em runtime.

| Asset confiável | Bytes | SHA-256 |
|---|---:|---|
| API moderna oficial `build/pdf.min.mjs` |458.904|`57456c8e0c81e46be31174b499ef77f2b9f5ee46d04412ba627320a36755d4c2`|
| Worker LEGACY oficial da mesma versão |1.321.307|`145d2dd3ab0c86151011dba95acfa2d5336e2accd59388ea43dbee0efddaaec6`|
| Contêiner de CMaps/fontes completo |1.991.651|`e345cc3e6465356b3a48c2da62561b3ea99277b7b79be31c5dc80b9e779b1eac`|

O worker LEGACY inclui os polyfills oficiais necessários, inclusive
`Uint8Array.toHex`, ausente no Node 24.19 testado. A API LEGACY não é importada:
ela tentaria carregar o canvas nativo opcional. A combinação API moderna +
worker LEGACY da **mesma** 6.4.299 foi executada em Node 24.19 e Edge 155; outras
versões/plataformas ainda exigem sua própria evidência. O backend exige
Node 22.13+ ou 24+, sem afirmar teste de todas essas versões.

Todos os 169 arquivos CMap e 16 arquivos de fontes padrão/licenças estão no
contêiner indexado:185 entradas, offsets contíguos, tamanho e SHA por entrada.
Nenhuma fonte/CMap necessária foi eliminada para caber no pacote. Viewer,
source maps, entrypoint API LEGACY, renderização, canvas e Wasm não integram o
caminho textual executado. Isso não é uma distribuição para renderizar/OCR PDF.

O inventário `document_pdf_vendor.json` registra o pacote, perfil, cada entrada,
SHA/SRI, upstream e o `core-js 3.50.0/MIT` embutido no worker oficial. O aviso
`document_pdf_LICENSE.txt` mantém Apache 2.0, licenças CMap/Foxit/Liberation e MIT
do core-js; o arquivo oficial MIT também está retido como fonte do gerador.
Fonte do pacote: [npm](https://registry.npmjs.org/pdfjs-dist/6.4.299).
APIs consultadas: [getDocument/streamTextContent](https://github.com/mozilla/pdf.js/blob/d0991a0d53f3bb3a7307e3b83f279c1d117aafb3/src/display/api.js),
[worker](https://github.com/mozilla/pdf.js/blob/d0991a0d53f3bb3a7307e3b83f279c1d117aafb3/src/core/worker.js).

Reprodução offline a partir do tarball explicitamente fornecido:

```text
python firebase-migration/scripts/vendor-pdf-text-assets.py --archive <tarball oficial local>
node firebase-migration/scripts/generate-document-intake-assets.mjs --check
```

O primeiro comando compara sem escrever; `--write` prepara publicação por
rename de arquivo exclusivo, sem abrir o destino anterior ou seguir hardlink.
Não existe download durante extração. O segundo confere closure e os mesmos
bytes no coletor e nos assets de hosting.

## Limites efetivos e residual

- Documento não confiável: 1 MiB, inalterado; texto UTF-8: 256 KiB, debitado antes
  de reter itens; 32 páginas e 20.000 itens. Uma pendência não retorna texto truncado
  fingindo leitura completa.
- Worker:deadline externo 10 segundos, término em resultado, erro, cancelamento
  ou timeout. Node:heap antigo 128 MiB, jovem 16 MiB e stack 4 MiB, ambiente somente
  `TZ=UTC`, sem segredos/autorização herdados. Isso é worker de parsing, não
  sandbox do sistema operacional nem isolamento de tenant por processo.
- Browser:sem quota rígida de heap. A API PDF.js não fornece cap geral dos bytes
  internos descomprimidos. Worker/CSP/deadline contêm execução; não comprovam
  limite rígido de memória nem impedimento absoluto de OOM antes do deadline.
  Este residual permanece para revisão/scan; não foi aceito como produção.
- Runtime do worker bloqueia fetch/XHR/WebSocket/EventSource/importScripts,
  usa factory de bytes exclusivamente do contêiner fixado, `useWorkerFetch:false`,
  `useWasm:false`, `isEvalSupported:false`, sem fontes de sistema/render/XFA.
  No navegador, o worker recebe CSP com `connect-src 'none'`, `worker-src 'none'`
  e scripts apenas da mesma origem, sem `unsafe-eval`. O nome/URL do worker e
  módulos são fixos. A verificação usa a confiança no checkout/hosting promovido;
  não afirma resistência a escritor concorrente com controle dessa mesma conta.
- API e worker são importados apenas no worker descartável. O browser principal
  busca somente assets fixos da própria origem, sem cookies no pedido de assets;
  esses pedidos não são acesso à nuvem/documentos do cliente. Logout/pagehide
  abortam o worker em curso e limpam a prévia. Texto/bytes não entram no recibo.

## Distribuição e decisão de orçamento

Decisão de engenharia do coordenador no escopo desta candidata: permitir até
**3 MiB por arquivo confiável somente** para o worker e contêiner acima, nos
nomes exatos e hashes fixados, após autenticação do perfil/manifesto. Nome,
prefixo, assinatura de outro conteúdo ou hash alterado não autorizam a exceção.
É decisão para implementar/revisar a candidata; não é autorização de deploy,
aceite humano independente, mudança de risco R029 ou aceite comercial.

Perfis fechados:Integration 1.0.0–1.0.7 preserva 7 arquivos; 1.0.8 preserva 12;
1.0.9 exige 20. IA mantém a closure 39/clientAgent 1.0.5 histórica; a nova exige
47/clientAgent 1.0.6. Misturar perfis ou versão desconhecida bloqueia a leitura.

### Barreira de atualização a partir do consumidor instalado

O consumidor da fonte `1eb89666b7c9d468958c7c6f226b69c901588be2`, Integration
1.0.8 e IA com 39 arquivos, **não reconhece** Integration 1.0.9/IA47. A validação
histórica no consumidor novo é compatibilidade para ler provas antigas, não
uma ampliação retroativa da capacidade do consumidor antigo.

Antes de aplicar este pacote, será necessário bootstrap governado do consumidor
novo a partir da fonte/certificado assinados, com revisão, confiança existente,
identidade, CAS, backup e recuperação preservados. Não alterar a allowlist do
instalado, confiança ou checkpoint para fazer um pacote desconhecido passar.
Esse bootstrap não foi implementado nem executado neste incremento; atualização
automática de 1.0.8 para 1.0.9 permanece gate explícito. A publicação futura precisa
resolver essa transição antes de afirmar convergência dos clientes antigos.


| Validador | Efeito |
|---|---|
| `published_release.py/assess_manifest` | versão/closure assinada, hash de todos; worker/contêiner fixos mesmo se um atacante os encurtar; limite 1 MiB padrão, 3 MiB só com pin exato |
| `published-update.cjs/inspectPackage` | mesma seleção histórica/atual e pins fixos; preserva total 32 MiB e 200 arquivos |
| `aurora_deployment.py/_transition_windows_files` | certificado verificado seleciona 7/12/20; checkpoint/identidade/idempotência continuam governados |
| `install_windows_beta.py` | ZIP autenticado seleciona perfil; admissão 3 MiB apenas nos dois nomes/version 1.0.9; aceitação exige hashes exatos após leitura; demais arquivos seguem 1 MiB; ZIP/total 16 MiB preservados |
| `document_intake.py` e worker Node | manifestos fechados, arquivos regulares/hash/tamanho; ausência ou alteração mantém backend pendente/falha; o limite do documento continua 1 MiB |
| build Windows/IA/satélite/BetaOne | copiam os assets declarados para a mesma linha de produto; não baixam módulo; gates genéricos de ZIP/closure não foram relaxados |

Medições de pacote de trabalho, `dirty=true`, sem artefato aprovado para instalar:
Windows Beta 24 entradas/4.208.219 bytes expandidos/2.079.445 bytes ZIP;
IA 48 entradas/4.886.420 bytes expandidos/2.476.388 bytes ZIP. Mudanças posteriores
exigem nova medição. Nenhum limite de documento foi elevado nem um asset foi
omitido para reduzir artificialmente a closure.

## Evidência local e próximos gates

Fixtures reais pequenas:PDF com duas páginas, português WinAnsi, XObject imagem,
senha AES-256, corrupção e 33 páginas. Sem dados de cliente ou credenciais. A
comparação browser/Node usa os mesmos bytes e exige status/código/hash do texto
iguais; deadline simula perda da resposta com worker real ocioso, sem gerar carga
de exaustão. CDP acompanha somente o browser de teste em perfil novo; nenhuma
sessão do usuário é lida. A publicação exige revisão do snapshot final, scan,
CI e HML próprios. Texto parcial não libera OCR, promoção de fatos, alimentação
real de nuvem, atualização do Mac original, TestFlight ou entrega beta completa.
