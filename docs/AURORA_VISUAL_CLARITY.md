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

Verificação local: compilação TypeScript e 54 testes de frontend, runtime do
cliente, apresentação financeira, ingestão e configuração da automação passaram.
O smoke visual usou exclusivamente valores sintéticos, em 1440 × 1000 e
390 × 844. Os valores de exemplo não comprovam faturamento, saldo ou implantação
WMGJ. CI deve ser conferido no SHA final do PR; teste local não o substitui.

Estado deste registro: `IMPLEMENTED` e `TESTED` localmente. Não constitui recibo
de publicação, instalação, autenticação real ou ingestão no ambiente hospedado.
Validação autenticada de CSRF/ingestão após implantação permanece independente.

## Reversão

Reverter o incremento pelo Git e seguir o processo de publicação existente,
preservando a versão anterior e seus recibos. A alteração não migra dados nem
reescreve checkpoints; não exige apagar fontes, conhecimento ou backups.
