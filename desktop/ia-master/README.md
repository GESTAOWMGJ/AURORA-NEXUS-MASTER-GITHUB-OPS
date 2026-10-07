# IA Master local — 1.0.1

Incremento AURORA-IA-MASTER-001, baseline `68467209b55f1f8e281ecb5d21acb9a8211757cf`.
O titular solicitou usar o PC como servidor físico da IA dentro do mesmo AURORA.
Este componente reutiliza o núcleo TypeScript do produto e a instalação Windows
existente. Não cria banco operacional nem substitui o aplicativo principal.

## Escopo e limites

- Regras nativas: prévia de snapshot sanitizado, explicitamente sem autenticação
  de origem. Firebase continua sendo a autoridade operacional canônica.
- Modelo local: propostas de engenharia em português, com método AURORA-MO-001,
  cache em memória de 16 resultados e nenhuma chamada a provedores externos.
- O método é contexto versionado, não treinamento de pesos nem memória autônoma.
  O registro sanitizado privado fica em `integration/state/ia-master/knowledge/knowledge_registry.v1.json` e é selecionado por relevância, orçamento, versão e hash; troca de corpus invalida o cache.
  Propostas não executam comandos, não alteram fonte e não publicam releases.
- Melhorias seguem patch isolado, testes, revisão, CI, HML e rollback existentes.
- Integrações enumeradas são capacidades/receitas. Cada conexão no runtime exige
  identidade própria, escopo e teste; plugins desta conversa não cedem credenciais.
- O portal recebe a seção IA Master. O acesso ao modelo funciona somente no PC
  servidor. Não há acesso LAN, endpoint público, túnel ou inferência no celular.
- Serviço por usuário: inicia ao entrar no Windows e depende de PC ligado,
  usuário conectado e ausência de suspensão. Não é alta disponibilidade.

## Instalação verificável

1. Validar o SHA exato em CI. Instalar Node >=22 e runtime oficial Ollama v0.35.1
   standalone em `%LOCALAPPDATA%\AuroraNexus\components\ollama\0.35.1`.
   Conferir digest da release oficial e assinatura Authenticode do fabricante.
2. Iniciar Ollama apenas em `127.0.0.1:11435`, `OLLAMA_NO_CLOUD=1` e modelos em
   `components\ollama-models`. Baixar `qwen3:8b` pela API local; registrar digest.
3. Em checkout limpo do SHA validado: `npm ci --prefix firebase-migration/functions`
   e `python3 desktop/ia-master/build.py --output <novo-diretorio>`.
4. Conferir SHA256 do ZIP transferido. No pacote, rodar
   `node manage.cjs install <org-autorizada>`. Instalações/estados já existentes interrompem
   o procedimento para revisão; não são sobrescritos.
5. Rodar `node manage.cjs start`. Usar `IA Master - Acesso local.cmd` na pasta AURORA para
   abrir uma sessão privada no navegador desse PC. A chave nunca precisa ser copiada.

O gerenciador Node confere hashes e proprietários das portas. O instalador cria um
arquivo CMD de inicialização para o usuário atual, preservando o atalho principal.
Não modifica ExecutionPolicy; usa PowerShell somente para consultar processos/portas.
O pacote contém o código compilado compartilhado, sem dependências npm no runtime.

## Proteções e modelo de ameaça

Servidor Node em `127.0.0.1:38765`, Host e Origin estritos, sem CORS; requisições
de escrita exigem JSON e cabeçalho próprio. Chave aleatória fica em pasta ACL
restrita ao usuário Windows atual e SYSTEM. Pareamento usa ticket descartável de
60 segundos; sessão HttpOnly/SameSite=Strict expira após 8 horas. Cookies não usam
Secure porque o endpoint é HTTP loopback. Auditoria persiste hashes, nunca prompts,
respostas ou credenciais; propostas/cache ficam em memória até exportação explícita.

Somente contexto PUBLIC/INTERNAL é aceito. O filtro de alguns padrões de segredo
é defesa adicional, não detector completo de dados pessoais. Não inserir dados
clínicos, identificáveis, financeiros reais ou credenciais. A inferência não tem
shell, ferramentas, acesso a credenciais cloud nem fallback externo.

Ollama permanece na porta loopback própria, sem autenticação nativa. A fronteira
de confiança inclui a conta/sessão Windows e os processos locais. Esta versão não
isola usuários hostis que compartilhem a máquina e não oferece MFA local. Não
representa liberação comercial multiusuário ou certificação de segurança.

## Validação e reversão

`AURORA_TEST_BUILD=<pacote> node --test desktop/ia-master/server.test.cjs` verifica
autenticação, pareamento, origem, tamanho, tenant, cache, fila e ausência de fallback.
Os testes TypeScript verificam integração ao motor, registro nativo e navegação.
CI existente executa build e regressões; testes não baixam modelos.

No dispositivo, validar modelo real, métricas, cache, 401 anônimo, 403 cross-origin,
portas loopback e preservação do cliente. Registrar evidência com SHA/digest/horário,
sem chave local. CI, instalação, publicação cloud e sincronização têm provas próprias.

Reversão: executar `node manage.cjs stop --disable-startup` desta versão. Encerra apenas
processos correspondentes ao componente/runtime nas suas portas e remove somente
o atalho de inicialização verificado. Preserva dados, modelos, auditoria, cliente e
integrações. Para retomar manualmente, usar `IA Master - Iniciar.cmd`.
Reverter o PR restaura a seção/registro anterior no próximo deploy; não muda IAM,
DNS, credenciais ou dados. A publicação HML continua sujeita aos gates existentes.
