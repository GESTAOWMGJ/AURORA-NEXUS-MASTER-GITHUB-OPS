# Aurora Nexus Hosting

Este diretório existe apenas para satisfazer a estrutura do Firebase Hosting.

A política operacional é **login-first**:

- nenhuma landing pública;
- nenhuma demonstração pública;
- nenhuma página estática com dado operacional;
- todas as rotas são reescritas para `auroraNexusAuthGate`;
- somente `__sessionLogin` e `__sessionLogout` são endpoints públicos técnicos, sem exposição de dado interno.

O login é renderizado pela Cloud Function. O acesso operacional exige Firebase Auth, cookie de sessão `__session` HttpOnly e e-mail presente no secret `AURORA_NEXUS_ALLOWED_EMAILS`.
