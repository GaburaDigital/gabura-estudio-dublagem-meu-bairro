# PROJETO

- linha: livre (edital de cultura; exceção Brincolar com licença MIT)
- nome: Meu Bairro – Gravações (Estúdio Meu Bairro)
- repositorio: gabura-estudio-dublagem-meu-bairro
- publico: o autor, operando no dia da oficina; ferramenta de produção, não é jogo
- plataforma: web (Chrome no computador Linux), offline depois da 1ª visita
- licenca_codigo: MIT
- engine: Vite + TypeScript, sem framework; Web Audio; fflate (ZIP)
- origem: adaptação do gabura-estudio-dublagem (gravador, WAV, onda, armazenamento)

## Resumo
Grava as audiodescrições das crianças por criança: Personagem, NPC, Cenário e extras com rótulo.
Até 5 tomadas por desenho (opcionais), estrela na escolhida, corte automático do silêncio, voz de adulto
da equipe como substituta. Editor como o do Scratch (agulha ao tocar, seleção, apagar, silenciar, volume,
fades, copiar trecho para outro desenho, desfazer, voltar ao original; o áudio original nunca muda).
Áudio guardado em 16 bits no IndexedDB, só 8 gravações na memória; backup em pasta (um ZIP por criança)
com lembrete de "gravações sem backup" e indicador de espaço. Exporta ZIP da criança (com um ZIP por desenho, para a ferramenta de recortes)
e ZIP de tudo (backup). A legenda é escrita depois, na ferramenta de recortes.
