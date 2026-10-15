# AURORA — clareza da primeira leitura

Incremento de experiência de 15/10/2026, nos módulos M01, M03, M07 e M08.
Baseline de integração: `c7c234cae263a4c2cb4fa854a5fa26a4ab0b3509`.

## Desafio e resultado

Os controles de importação e automação eram renderizados antes do conteúdo de
todas as seções. A primeira leitura do gestor começava por configuração técnica,
e o resumo financeiro ficava abaixo desses formulários.

Os mesmos controles passam para painéis recolhidos em **Equipe e conexões**.
**Hoje** mantém um link para esse destino e começa pela prioridade financeira,
com valor, competência, explicação e próxima ação. No celular, o valor precede
a explicação longa. O tamanho dos valores dos cartões acompanha a largura do
próprio cartão para reduzir quebras nos centavos.

O aprendizado incorporado é simples: apresentar a decisão operacional antes da
configuração técnica, mantendo visíveis os limites da evidência. Não constitui
nova rotina, executor, autorização nem promoção de aprendizado entre clientes.

## Contratos preservados

- IDs dos formulários, handlers, perfis, CSRF e APIs existentes.
- Valores canônicos e distinção entre ausência, zero e dados observacionais.
- Competência, qualificadores `SHADOW` e indicação de cenário sintético.
- Navegação por âncoras e retorno de foco; descrições acessíveis da prioridade.
- Nenhuma nova chamada de escrita durante a navegação.

Um bootstrap válido sem dados continua permitindo cadastrar fontes. Falha ou
timeout do bootstrap oculta o conteúdo privado, incluindo os controles movidos;
a ação de tentar a consulta novamente permanece no tratamento existente.

## Evidência e limites

Histórico da primeira fase: compilação TypeScript e 55 testes de frontend,
runtime do cliente, apresentação financeira, ingestão e configuração da automação
passaram. Esse total pertence à fase anterior, não à suíte mais recente.
O smoke visual dessa fase usou exclusivamente valores sintéticos, em 1440 × 1000 e
390 × 844. Os valores de exemplo não comprovam faturamento, saldo ou implantação
WMGJ. CI deve ser conferido no SHA final do PR; teste local não o substitui.
O harness de runtime reconhece tags de script sem diferenciar maiúsculas e
minúsculas; a regressão confirma bootstrap, navegação e limpeza após HTTP 401.

Estado deste registro: `IMPLEMENTED` e `TESTED` localmente. Não constitui recibo
de publicação, instalação, autenticação real ou ingestão no ambiente hospedado.
Validação autenticada de CSRF/ingestão após implantação permanece independente.

## Continuação de 15/10/2026 — candidata em revisão

O acesso, a segurança da própria conta e os downloads passam a usar a mesma
marca visível, com o ícone existente `/aurora-icon.svg`, títulos serifados e
tokens de creme, petróleo e ouro. A apresentação não cria outra identidade de
aplicativo nem muda permissões, credenciais ou destinos de download.

A confirmação do segundo fator passa por um formulário com um único handler de
`submit`, permitindo o envio por Enter e impedindo confirmações concorrentes.
A ajuda sobre perda do autenticador permanece uma ação separada. Foco e
descrições acessíveis acompanham o código do autenticador e, na recuperação,
o e-mail, a nova senha após validação do link e o retorno ao acesso. Respostas
atrasadas respeitam o foco escolhido pelo usuário e o ciclo de saída/retorno da
página; a abertura automática de um link não força foco. As regras de senha,
segundo fator, sessão e recuperação existentes permanecem exigidas.

A página de acesso inclui a metapolítica CSP `form-action 'none'`, restringindo
o envio HTML nativo quando o módulo JavaScript ainda não iniciou ou falhou.
As chamadas autorizadas continuam nos handlers existentes. No Chrome, o formulário válido sem módulo JavaScript não navegou nem
acrescentou os campos à URL após clicar em Entrar, em uma prévia inerte local.

No Master, o progresso visual e o resumo legível apresentam os passos e recibos
disponíveis, mantendo os detalhes técnicos nas opções avançadas. O CTA de
pareamento sem código orienta a preencher o campo, sem iniciar uma consulta de
rede. A conexão e cada avanço continuam dependendo do resultado confirmado.
O histórico sem recibo detalhado explica a ausência sem invalidar a etapa
registrada. Conferir diferenças em PROPOSED mostra caminhos e hashes sem
registrar uma transição de estado; preparo e publicação exigem o recibo de
verificação vinculado à proposta.

Após essas correções, a suíte combinada registrou 167 testes: 166 passaram,
nenhum falhou e um foi pulado no Windows por indisponibilidade de symlink.
A compilação passou. O log local está preservado na entrega; CI deve ser
conferida no SHA final do PR, separadamente.

No Chrome, a verificação visual dos renderizadores reais confirmou o ícone no
acesso, a tela de segundo fator sem overflow em largura de 1225 px e o foco em
`mfa-code`. Acesso e Master também foram conferidos em 320 px, sem overflow horizontal;
o Master foi renderizado em 1440 × 1000. O fallback sem módulo JavaScript foi
observado como descrito acima. A confirmação fictícia pelo botão acionou o
resolver uma vez. O envio por Enter foi confirmado com uma única chamada
fictícia; o código vazio foi bloqueado pela validação nativa sem nova chamada.
Enter usa o mesmo submit, ignorando composição de texto e bloqueando repetição
e concorrência. Falha de rede tem mensagem própria sem alegar código inválido.
Essas observações não comprovam
autenticação real, instalação, publicação ou uso de dados operacionais. O
PR #265 permanece draft; CI, smoke final e promoção têm recibos próprios.

## Reversão

Reverter o incremento pelo Git e seguir o processo de publicação existente,
preservando a versão anterior e seus recibos. A alteração não migra dados nem
reescreve checkpoints; não exige apagar fontes, conhecimento ou backups.
