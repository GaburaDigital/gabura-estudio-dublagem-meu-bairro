# Meu Bairro – Gravações

Estúdio para gravar, **no dia da oficina**, as audiodescrições que as crianças fazem dos próprios desenhos
para o jogo **Meu Bairro Vira Game**. É uma versão adaptada do
[Estúdio de Dublagem Gabura](https://github.com/GaburaDigital/gabura-estudio-dublagem): reaproveita o gravador,
a onda com alças de corte e o jeito de guardar, mas organizado **por criança**.

> Link: `https://gaburadigital.github.io/gabura-estudio-dublagem-meu-bairro/` (depois de publicar).
> Feito para o Chrome no computador (Linux). Depois da primeira visita, abre **sem internet**.

## No dia da oficina

1. **Ligar microfone** e escolher o microfone USB. A barrinha deve ficar verde quando a criança fala.
2. **+ Nova criança**: escreva o nome ou apelido.
3. Cada criança tem três cartões: **Personagem**, **NPC** e **Cenário**. Clique em **● Gravar**, peça para a
   criança contar o que desenhou e clique em **■ Parar** (a barra de espaço também grava e para).
4. Até **3 tomadas** por desenho, nenhuma é obrigatória. A **★** marca a que vai para o jogo (a primeira já vem marcada).
5. O silêncio do começo e do fim é cortado sozinho; dá para ajustar arrastando as alças laranja.
6. Desenho a mais: **+ Adicionar extra** e escreva o que é (ex.: pipa).
7. Se a gravação da criança não der certo, grave com alguém da equipe e marque **Voz de adulto da equipe**.
8. O campo **O que é o desenho** serve só para identificar depois (não é a legenda).
9. Tudo fica guardado sozinho no navegador. No fim do dia: **Salvar tudo** e guarde o ZIP em outro lugar também.

O relógio da gravação fica laranja depois de 30 segundos, só como lembrete para audiodescrições curtas.

### Fone de retorno

- Microfone USB com saída de fone: ligue o fone **no microfone** e deixe **Ouvir minha voz no fone** desligado.
- Só o headset: ligue **Ouvir minha voz no fone** para escutar a própria voz.
- **Tirar ruído** usa a limpeza do próprio Chrome (ajuda em lugar barulhento; deixe desligado em sala silenciosa).

## Salvar, importar e exportar

| Botão | O que faz |
| --- | --- |
| **Salvar tudo** | `oficina_meu_bairro_<data>.zip` com todas as crianças (o backup do dia) |
| **Exportar esta criança** | `crianca_<apelido>.zip` só com a criança aberta |
| **Importar** | abre um dos dois ZIPs acima (em outro computador, por exemplo) |

Dentro do ZIP de cada criança há **um ZIP por desenho**: `personagem.zip`, `npc.zip`, `cenario.zip` e `extra_<nome>.zip`.
Cada um tem as tomadas em WAV (48 kHz, sem corte) e um `gravacao.json` com o corte, a tomada escolhida,
o apelido e a anotação.

## Depois da oficina: na ferramenta de recortes

Na [ferramenta de recortes](https://github.com/GaburaDigital/meu-bairro-recortes), em **Audiodescrição gravada**,
clique em **Importar gravação do estúdio** e escolha o `personagem.zip` (ou o ZIP da criança inteira e escolha o desenho).
Ouça as tomadas, escolha uma e escreva a **legenda** (o que foi falado). O ZIP exportado para o jogo leva o desenho,
o áudio (`apresentacao.wav` ou `audiodescricao.wav`) e a legenda.

O áudio vai para o jogo **cortado, sem ronco e com o volume nivelado** (todas as vozes com volume parecido).
Nenhum efeito de voz: a voz da criança vai natural. A Godot importa o WAV e comprime sozinha.

## Atalhos

| Tecla | Ação |
| --- | --- |
| Espaço | grava / para no desenho escolhido (o cartão com borda azul) |
| P | ouve a tomada |
| Esc | para o som |

## Para programar

```
npm install
npm run dev      # http://localhost:5173/gabura-estudio-dublagem-meu-bairro/
npm run build    # gera docs/ (o GitHub Actions faz isso sozinho ao publicar)
```

### Publicar no GitHub Pages (GitHub Actions)

1. Crie o repositório **gabura-estudio-dublagem-meu-bairro** e envie estes arquivos.
2. Mova `publicar.yml` para **`.github/workflows/publicar.yml`** (`Ctrl+H` mostra as pastas com ponto).
3. No GitHub: **Settings → Pages → Source: GitHub Actions**.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `src/main.ts` | a tela: crianças, cartões, gravar, tomadas |
| `src/audio/gravador.ts` | microfone, medidor, gravação em 48 kHz e retorno no fone (do estúdio original) |
| `src/audio/processar.ts` | corte do silêncio, tirar ronco e nivelar volume |
| `src/audio/wav.ts` | ler e criar WAV (do estúdio original) |
| `src/dados/pacote.ts` | ZIPs de exportar e importar |
| `src/dados/armazenamento.ts` | guarda tudo no navegador |
| `src/interface/onda.ts` | onda do som com alças de corte (do estúdio original) |

## Licença

Código sob a licença MIT (arquivo `LICENSE`). Fontes Atkinson Hyperlegible e Chewy sob a SIL Open Font License.
As **vozes e os nomes das crianças** não fazem parte deste repositório e não estão sob a licença MIT.
