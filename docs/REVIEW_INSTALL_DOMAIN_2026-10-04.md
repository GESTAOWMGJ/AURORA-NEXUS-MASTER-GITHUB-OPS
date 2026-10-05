# AURORA NEXUS — instalação retomável e domínio por empresa

## Resultado para revisão

Destino comercial desejado: `https://auroranexus.com.br/{orgId}`.
Piloto: `https://auroranexus.com.br/wmgj`, login seguro e identidade AURORA NEXUS.
Este documento não comprova publicação, DNS/SSL, criação de conta, MFA ou
sincronização de dados reais.

| Candidata local | Conteúdo |
| --- | --- |
| `a06a647` / `feat/native-install-integration` | Instalação retomável, empacotamento Python, registro no motor e Release Cockpit |
| `a579acc` / `feat/customer-domain-entry` | Login por empresa, PWA por caminho, escopo confiável da sessão e retirada de referências GPT da interface |
| `77f090c27167cf620600990f0e748dd8d643735f` | Árvore combinada validada localmente |

Base remota revalidada: `68ee776b5ce24520f8412448774efa468ab1ca35`.
Repositório existente: `GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS`.
Nenhuma nova branch foi confirmada no remoto nesta etapa. Não há novo PR/CI
remoto nem merge/deploy destas candidatas.

## Comportamento implementado

- O instalador inclui o transporte canônico aprovado e um checkpoint sanitizado.
  Valida entrada/destino, autentica a organização, envia amostra explicitamente
  autorizada e confere o recibo. Timeout reutiliza a chave idempotente.
- Recibo histórico evita repetir POST; o ping é refeito e o resultado identifica
  que o recibo é cache local, não prova atual do banco. Não registra senha,
  credencial, valor financeiro, conteúdo do documento ou caminho da fonte.
- O registro nativo incorpora `AURORA-INSTALL-INTEGRATION-001` como capacidade
  governada, por organização e sob demanda. Não cria scheduler nem banco.
- `/wmgj` e `/{orgId}` apresentam o login seguro. A URL não seleciona dados:
  `auroraOrgId` vem de token Firebase verificado e todas as APIs revalidam o
  membership/organização. Claim ausente preserva WMGJ; inválida bloqueia.
- Solicitar outra empresa não concede acesso. Papel e permissões continuam no
  membership, MFA continua obrigatório para administração e ações protegidas.
- O manifesto PWA, saída e expiração preservam o caminho da empresa. O frontend
  conserva o padrão visual atual, sem GPT/OpenAI/Gemini como marca visível.

## Verificação

| Verificação | Resultado |
| --- | --- |
| Python: transporte, implantação, conectores e onboarding | 59 aprovados na árvore combinada |
| TypeScript: domínio, sessão, CSRF, autorização, frontend, motor e release | 39 aprovados na árvore combinada |
| TypeScript `tsc --noEmit` | Aprovado; lockfile corresponde à instalação de dependências utilizada |
| Diff whitespace | Aprovado |
| Windows físico: transporte | 12 aprovados |
| Windows físico: implantação | 11 aprovados; 1 teste POSIX dispensado |
| Cinco arquivos executados no Windows | SHA-256 idênticos à candidata |

Um teste legado do workflow pós-ingestão depende do executável Ruby, ausente
nesta estação. Sua execução falhou por essa dependência e foi excluída da seleção
local final; não está contado entre os 98 aprovados. Deve executar no CI existente.
Nenhum teste foi removido do código ou do CI para dispensar esse gate.

Hashes dos módulos executados no Windows:

- `aurora_cloud_sync.py`: `0c2dc77ff656040d6db78e4052b5212595a5cddb4ef5c186d96d1d1b3aacc9c2`
- `aurora_deployment.py`: `cd075773470fe4082fe8d77799ab76368c284f2df50dd0412abc009a1e921d34`

## Situação operacional e próximos gates

1. Código candidato em staging no Windows; nenhum serviço, tarefa ou envio real
   ativado. Credencial de integração ausente do ambiente do processo inspecionado.
   Esta verificação não inspecionou cofres nem exportou sessões do navegador.
2. Cadastro do titular informado como concluído; vínculo master e MFA ainda não
   verificados nesta etapa. Provisionamento permanece no fluxo administrativo.
3. Revisão automática rejeitou a abertura do console IAM do projeto HML por não
   reconhecer autorização direta na mensagem ativa. Nenhuma política IAM alterada.
4. Revisão automática rejeitou push GitHub por não reconhecer autorização direta
   de publicação para o destino. Não houve tentativa alternativa de contornar.
5. Após autorização: publicar branches no repositório existente, abrir os PRs,
   executar CI no SHA final, revisar e promover pelo deploy protegido.
6. Conferir IAM e credencial com menor privilégio; validar amostra real e recibo
   no armazenamento canônico antes de ativar rotina recorrente.
7. Vincular o domínio existente ao Hosting aprovado e ao Firebase Authentication
   usando registros oficiais; validar TLS, login, tenant, APIs, logout e PWA.
   Não alterar atalhos funcionais antes desse teste no domínio final.

O instalador executável comercial assinado, a atualização do Mac e o teste iOS
no dispositivo continuam fora da comprovação desta etapa. A implementação atual
é um componente Python reaproveitável e uma PWA; não uma aplicação iOS nativa.

## Rollback

Suspender as chamadas ao componente preserva o cliente e suas fontes. O preparo
recusa substituir arquivos de versão já instalada com hashes divergentes.
Reverter o candidato web pelo fluxo protegido preserva dados e memberships;
tenants novos dependentes da claim precisam ficar suspensos durante rollback,
sem serem redirecionados à WMGJ. Preservar o endereço anterior até o domínio
final estar comprovadamente funcional.
