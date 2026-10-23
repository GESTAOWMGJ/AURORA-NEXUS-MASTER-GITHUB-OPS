# AURORA iOS — preparação verificável de distribuição

Referência: 15/10/2026. Baseline de engenharia:
`967d32a493b9930d77cac1030642c6fca28bb1f3`.
A baseline de código não é apresentada como versão já instalada ou publicada.

## Desafio e limite atual

O titular solicitou aplicativo iOS nativo e link efetivo da App Store. O fluxo
existente gerava apenas simulador unsigned, com assinatura desabilitada e sem
arquivamento do target app. O portal/PWA não satisfaz o requisito nativo.

Nesta verificação, a conexão de navegador não disponibilizou sessão Apple; os
Macs estavam offline. A consulta de configurações e nomes de segredos do repositório
não encontrou entradas Apple/iOS correspondentes. Nenhuma credencial foi lida,
criada ou exposta, nem foi executado pagamento, ativação de conta ou aceite Apple.
Isso não prova inexistência de uma conta ou certificado fora desses acessos.

## Incremento

- `distribution.py`: preparo opt-in, identidade fechada, perfil/certificado/ícone
  explícitos, SHA revisado, arquivo de export local e verificação posterior do IPA.
- `configure.py`: somente app/Release permite assinatura manual; scheme arquiva
  somente o app. O fluxo padrão de simulador preserva seu comportamento unsigned.
- Proveniência/central: solicitação de assinatura não vira assinatura comprovada,
  certificado registral Aurora, TestFlight ou aceite nativo.
- `AppStore/identity.json`: configuração intencionalmente incompleta/bloqueada.
- `AppStore/metadata.pt-BR.json` e runbook: textos de loja, pendências jurídicas,
  privacidade, recursos visuais, requisitos Apple e procedimento de envio.
- `ios.yml`: executa os testes Python adicionais sem receber secrets de assinatura.

Nenhuma política de navegação, login/MFA, permissão, backend, DNS, dado institucional,
identidade Mac, assinatura de release Aurora ou instalação existente foi alterada.
Não há upload automático para a Apple neste incremento.

## Validação e evidência

A rodada local no Windows executou **35 testes Python**, todos aprovados, incluindo
os 10 testes preexistentes. Seis testes adicionais de export usam ferramentas Apple
simuladas: validam recibos/recusas, não comprovam codesign/Xcode/IPA reais.
O workflow nativo deve executar Swift/Foundation e Simulator no SHA final do PR.
O estado de CI deve ser consultado no próprio PR; não é inferido desta rodada local.

Estados preservados no Release Cockpit e no aceite do produto:

| Marco | Estado deste incremento |
|---|---|
| Código e testes locais | IMPLEMENTED / TESTED, conforme rodada acima |
| Swift, Xcode e Simulator do SHA final | Exigem resultado de CI próprio |
| Account Holder / membership / identidade Apple | PENDENTE DE VERIFICAÇÃO AUTENTICADA |
| Certificado/perfil/ícone de distribuição | PENDENTE DE ENTRADAS APROVADAS |
| IPA assinada e validada de verdade | NÃO EXECUTADA |
| Upload/processamento TestFlight | NÃO EXECUTADO |
| Teste em dispositivo físico / App Review / App Store | PENDENTE |

Não promover flags de publicação ou instalação no motor por existência deste patch.
A capacidade abstrata registrada é: cada plataforma exige prova independente de
assinatura, distribuição e adoção; build de simulador nunca fecha o gate iOS.
Este registro não cria executor, serviço recorrente ou aprendizagem implantada.

## Próximo gate e reversão

Account Holder confirma/regulariza membership e acordos, identifica o registro iOS
correto e provisiona a identidade de assinatura por canal seguro. O pacote AppStore
explica os campos e os recursos visuais restantes. Revisão humana, CI do SHA final,
archive/export real e recibo Apple precedem o anúncio de TestFlight ou App Store.

Manter o incremento em PR draft até revisão e reconciliação com a main corrente.
Reversão: revert do PR, sem alteração dos apps instalados. Artefatos assinados futuros
permanecem em staging privado, com hashes e recibos preservados; não sobrescrever
archive/export anterior nem reutilizar número de build enviado à Apple.
