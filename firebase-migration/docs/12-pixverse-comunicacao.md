# PixVerse — comunicação institucional, fora do runtime

## Limite

PixVerse não participa de ingestão, auditoria, classificação, dashboard, decisão ou armazenamento clínico. Seu uso possível é um vídeo institucional baseado em dados totalmente sintéticos, após aprovação separada de custo e roteiro.

Nenhuma geração foi iniciada neste PR.

## Brief futuro

- audiência: direção hospitalar, auditoria e parceiros;
- formato-base: apresentação executiva 16:9, cerca de 45 segundos;
- mensagem: evidência → captura → validação → projeção → achado de IA → decisão humana;
- estética: azul-petróleo, off-white, dourado discreto; tipografia exata aplicada em pós-produção;
- proibições: paciente identificável, prontuário, CPF/CNS, documento real, logo de terceiro sem autorização, promessa de autonomia clínica.

## Sequência de seis beats

1. documento sintético entra com hash e origem;
2. fila separa estado, risco e revisão;
3. Firestore consolida projeções por organização;
4. dashboard mostra stale/partial/alerta sem esconder incerteza;
5. IA prepara rascunho referenciado e para em revisão;
6. humano aprova/rejeita; expansão ocorre somente após gates.

## Rota de produção

Tratar como produção curta multi-shot, pois identidade visual e continuidade importam. Preparar boards sintéticos, validar textos/logos fora da geração e só então compor a fila de vídeo. Antes de qualquer etapa paga, executar preflight/quote do PixVerse e apresentar tarefas, rota, modelos compatíveis com a conta e balance state. A geração exige aprovação explícita em uma nova etapa.
