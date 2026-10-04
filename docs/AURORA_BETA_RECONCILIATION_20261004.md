# Reconciliação da beta — 04/10/2026

A main avançou de 52fb02862e31920d558733d99356e627b4109fd7 para 35a2d5218604f611470e6db3e176a0a6d4cc6736 durante a preparação do PR128.
Esta conciliação preserva exatamente o request pós-ingestão (blob 38f3d6fdb751759e892b02bd781ed8fed051edf2) e o recovery workflow (blob 5f8c871e2287affd32addecdb994a2c63e4a8119) da main nova. O teste estático do pós-ingestão passa a verificar o fechamento completo dos alvos e evidência real; as outras verificações são mantidas.
O workflow pós-ingestão proposto estende o PR126: inclui a rota de integração na decisão, lista funções por ID/região, publica funções antes do Hosting e usa resultados reais dos passos.

## Instalação comprovada no Windows
Em 2026-10-04T17:52:38.7655535Z, a instalação por usuário terminou com exit 0 e status WINDOWS_WEB_CLIENT_INSTALLED, versão 0.3.0-beta.20261004.1. Verificação de hashes e parser Windows PowerShell aprovada. O cliente abre o portal existente em janela Edge; não é um executável nativo nem uma réplica offline. O gateway físico de infraestrutura foi preservado.
O manifesto sourceCommit referencia a base do aplicativo examinada (52fb028...), não atesta qual SHA está implantado no servidor. Os arquivos instalados foram obtidos do commit beta 744fcea957d7ee1749c9842a38ddc2b3bb84e06e.

## Bloqueio cloud mais recente — não corrigido por simples troca de flags
Run 37221856821, job 111493631450, SHA 35a2d5218604f611470e6db3e176a0a6d4cc6736: conciliação e projeção SHADOW passaram; o teste autenticado devolveu NATIVE_INSIGHT_REVENUE_RISK_HTTP_409 com FIREBASE_NATIVE_CONTRACT_REQUIRED. A autenticação de sessão passou, mas o snapshot não satisfez o contrato nativo. O código exige nativeDataPlane.storage=FIRESTORE e sourceAccessDuringInference=false, sem fallback às fontes.
Não foi aplicado PATCH direto para fabricar esse contrato no Firestore. É necessário conferir/deployar a versão canônica do gerador de projeção, gerar novamente o snapshot com proveniência e reexecutar o teste autenticado. A rota integration/ping também estava 404 na verificação anônima do PC; a correção de fechamento de funções deste PR trata esse segundo problema.
O último passo do run também terminou com failure. O log por si só não distingue a verificação final de native_verified de uma falha anterior do kill switch; não declarar o kill switch final confirmado sem ler sua evidência própria.

Não houve nova carga massiva, migração local/cloud, merge ou deploy por esta execução. A reconciliação real confirmada refere-se à amostra HML existente de maio/2026, não à base financeira inteira. iOS nativo e atualização do Mac original permanecem fora da instalação realizada.
