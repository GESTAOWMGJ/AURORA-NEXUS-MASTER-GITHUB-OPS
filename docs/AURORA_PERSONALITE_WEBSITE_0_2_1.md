# Personalité — Website 0.2.1 candidato

Base: 8e85f895da55cb88d9be753a1a8da8bc90188658 (correção independente de revogação, PR #343).

O exportador existente passa a gerar uma página responsiva com apresentação, serviços, duração, contato, navegação acessível e impressão. Preserva a identidade Personalité e usa exclusivamente os campos públicos do negócio aprovados pelo fluxo existente. Não cria backend, coleta, rastreador, provedor de IA nem outro tenant. Não publica preços automaticamente. E-mail é codificado como dado de URI, evitando inclusão de cabeçalhos por delimitadores.

Validação local: TypeScript compilado; 25 testes de operações Personalité e resultado confiável passaram. Regressões incluem isolamento, revogação, permissões, idempotência, confirmação e exclusão de registros privados do HTML. Não corresponde a validação visual em navegador, CI deste candidato, deploy ou homologação com identidade real.

Estado: IMPLEMENTED / TESTED. CI, revisão independente do incremento, homologação e publicação pendentes. Gates de ativação permanecem inalterados. O módulo operacional permanece 0.2.0 e sintético; 0.2.1 identifica apenas o exportador web.

Publicação requer artefato aprovado da organização correta, domínio registrado, DNS e HTTPS verificados. Disponibilidade de domínio é temporária e não equivale a registro, pagamento ou controle da zona. Conta administrativa do registrador não concede acesso a dados de outro consultório. Não incluir credenciais em HTML, documentos públicos ou repositório.

Ativação real exige recibos do provisionador existente, autorização validada, operador e revisor independentes habilitados, identidade da titular verificada com MFA, escopos próprios dos conectores e teste autenticado de recuperação/revogação. Aprovação de intenção não substitui esses estados executáveis. A entrega de credenciais depende de emissão real; nenhum segredo de acesso foi criado por este incremento.

Rollback: reverter o commit deste exportador; nenhum esquema persistido ou instalação alterado. Não modificar a correção de revogação da base.
