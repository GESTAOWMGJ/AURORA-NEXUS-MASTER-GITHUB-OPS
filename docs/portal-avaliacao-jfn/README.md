# Portal de Avaliação Inicial — Consultório JFN

Portal público para distribuição padronizada do kit genérico de pré-consulta do Consultório Dr. João de Freitas Neto — CRM/PR 55137.

## Acesso público

**Portal:** https://portal-avaliacao-jfn.joaodefreitasn.chatgpt.site

A página reúne botões para:

- orientações e checklist;
- triagem clínico-metabólica;
- questionário clínico-metabólico completo;
- ficha profissional não editável, disponibilizada somente para ciência;
- download do kit completo em arquivo único.

## Limites de segurança

- O portal contém apenas modelos genéricos e em branco.
- O portal não recebe nem armazena dados do paciente.
- A ficha médica editável, a chave de identificação, o índice do prontuário e os documentos preenchidos não são publicados.
- O paciente devolve os arquivos somente pelo canal individual indicado pela equipe.
- Links internos do Drive, identificadores, diagnósticos e dados clínicos não devem ser inseridos neste repositório público.

## Uso no Meta/WhatsApp Business

Texto do botão sugerido:

```text
ABRIR AVALIAÇÃO
```

URL do botão:

```text
https://portal-avaliacao-jfn.joaodefreitasn.chatgpt.site
```

O WhatsApp permite modelos de mensagem com botão de chamada para ação que abre um site. A mensagem deve conter apenas comunicação administrativa mínima, sem diagnóstico, exame ou identificador sensível.

## Arquitetura

```text
Meta/WhatsApp -> Portal público -> PDFs genéricos em branco
                                      |
                                      v
                           retorno por canal individual
                                      |
                                      v
                     Drive restrito + índice pseudonimizado
```

## Referências

- [LGPD — Lei 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [Lei 13.787/2018 — prontuário do paciente](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/L13787.htm)
- [ANPD — segurança da informação](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-sobre-seguranca-da-informacao-para-agentes-de-tratamento-de-pequeno-porte)
- [Meta — modelos interativos com botão de URL](https://developers.facebook.com/docs/whatsapp/api/messages/message-templates/interactive-message-templates/)
