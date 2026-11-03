// Pacotes ZIP do estúdio.
//
// Uma criança  -> crianca_<apelido>.zip
//     crianca.json            dados da criança e das gravações (para importar de volta no estúdio)
//     personagem.zip          uma gravação = um ZIP pequeno, para abrir na ferramenta de recortes
//     npc.zip
//     cenario.zip
//     extra_<rotulo>.zip
// Cada gravação  -> gravacao.json + tomada_1.wav, tomada_2.wav... (WAV 48 kHz, voz sem corte; o corte vai no json)
//
// Tudo -> oficina_<data>.zip com criancas/crianca_<apelido>.zip para cada criança.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { criarWav, lerWav } from '../audio/wav';
import { TAXA } from '../audio/processar';
import { armazenamento } from './armazenamento';
import { nomeDaGravacao, novaChave, paraId, tituloDaGravacao, type Crianca, type Gravacao, type Tomada } from './modelo';

const LEIA_CRIANCA = `Pacote de gravações de uma criança (Estúdio Meu Bairro).
- Para continuar no estúdio: "Importar" este ZIP.
- Para a ferramenta de recortes: use o ZIP de cada desenho (personagem.zip, npc.zip, cenario.zip, extra_*.zip).
`;

interface TomadaJson { id: string; arquivo: string; duracao: number; inicio: number; fim: number; favorita: boolean }

export interface GravacaoJson {
  formato: 'meu-bairro-gravacao';
  versao_formato: 1;
  apelido: string;
  tipo: Gravacao['tipo'];
  rotulo: string;
  titulo: string;
  anotacao: string;
  voz_adulta: string;
  escolhida: string;
  tomadas: TomadaJson[];
}

interface CriancaJson {
  formato: 'meu-bairro-crianca';
  versao_formato: 1;
  chave: string;
  apelido: string;
  anotacao: string;
  criada: number;
  gravacoes: { chave: string; tipo: Gravacao['tipo']; rotulo: string; anotacao: string; voz_adulta: string; pacote: string }[];
}

async function zipDaGravacao(c: Crianca, g: Gravacao): Promise<Uint8Array | null> {
  if (g.tomadas.length === 0) return null;
  const arquivos: Zippable = {};
  const tomadas: TomadaJson[] = [];
  let escolhida = '';
  for (const [i, t] of g.tomadas.entries()) {
    const audio = await armazenamento.lerAudio(t.id);
    if (!audio) continue;
    const arquivo = `tomada_${i + 1}.wav`;
    arquivos[arquivo] = [criarWav(audio, TAXA, 24), { level: 0 }];
    const favorita = t.id === g.favorita;
    if (favorita || (!g.favorita && i === g.tomadas.length - 1)) escolhida = arquivo;
    tomadas.push({ id: t.id, arquivo, duracao: t.duracao, inicio: t.inicio, fim: t.fim, favorita });
  }
  if (tomadas.length === 0) return null;
  const json: GravacaoJson = {
    formato: 'meu-bairro-gravacao', versao_formato: 1, apelido: c.apelido, tipo: g.tipo, rotulo: g.rotulo,
    titulo: tituloDaGravacao(g), anotacao: g.anotacao, voz_adulta: g.vozAdulta, escolhida, tomadas,
  };
  arquivos['gravacao.json'] = strToU8(JSON.stringify(json, null, 2));
  return zipSync(arquivos);
}

/** ZIP de uma criança (serve para o estúdio e, por dentro, para a ferramenta de recortes). */
export async function exportarCrianca(c: Crianca): Promise<Uint8Array> {
  const arquivos: Zippable = {};
  const usados = new Set<string>();
  const gravacoes: CriancaJson['gravacoes'] = [];
  for (const g of c.gravacoes) {
    let nome = nomeDaGravacao(g);
    for (let n = 2; usados.has(nome); n++) nome = `${nomeDaGravacao(g)}_${n}`;
    usados.add(nome);
    const zip = await zipDaGravacao(c, g);
    if (zip) arquivos[`${nome}.zip`] = [zip, { level: 0 }];
    gravacoes.push({ chave: g.chave, tipo: g.tipo, rotulo: g.rotulo, anotacao: g.anotacao, voz_adulta: g.vozAdulta, pacote: zip ? `${nome}.zip` : '' });
  }
  const json: CriancaJson = {
    formato: 'meu-bairro-crianca', versao_formato: 1, chave: c.chave, apelido: c.apelido, anotacao: c.anotacao, criada: c.criada, gravacoes,
  };
  arquivos['crianca.json'] = strToU8(JSON.stringify(json, null, 2));
  arquivos['LEIA.txt'] = strToU8(LEIA_CRIANCA);
  return zipSync(arquivos);
}

export function nomeDoZipDaCrianca(c: Crianca): string {
  return `crianca_${paraId(c.apelido || 'sem_apelido')}.zip`;
}

/** ZIP com todas as crianças (o "salvar tudo"). */
export async function exportarTudo(criancas: Crianca[], aoAndar: (feitas: number) => void = () => {}): Promise<Uint8Array> {
  const arquivos: Zippable = {};
  const usados = new Set<string>();
  for (const [i, c] of criancas.entries()) {
    let nome = nomeDoZipDaCrianca(c).replace(/\.zip$/, '');
    const base = nome;
    for (let n = 2; usados.has(nome); n++) nome = `${base}_${n}`;
    usados.add(nome);
    arquivos[`criancas/${nome}.zip`] = [await exportarCrianca(c), { level: 0 }];
    aoAndar(i + 1);
  }
  arquivos['oficina.json'] = strToU8(JSON.stringify({ formato: 'meu-bairro-oficina', versao_formato: 1, criancas: criancas.length, salvo: new Date().toISOString() }, null, 2));
  return zipSync(arquivos);
}

/** Lê um ZIP (de uma criança ou de tudo) e devolve as crianças; os áudios já ficam guardados no navegador. */
export async function importar(bytes: Uint8Array): Promise<Crianca[]> {
  const raiz = unzipSync(bytes);
  if (raiz['crianca.json']) return [await lerCrianca(raiz)];
  const criancas: Crianca[] = [];
  for (const [nome, dados] of Object.entries(raiz)) {
    if (nome.endsWith('.zip') && nome.startsWith('criancas/')) {
      const interno = unzipSync(dados);
      if (interno['crianca.json']) criancas.push(await lerCrianca(interno));
    }
  }
  if (criancas.length === 0) {
    if (raiz['gravacao.json']) throw new Error('Este ZIP é de um desenho só (para a ferramenta de recortes). Importe o ZIP da criança.');
    throw new Error('Este ZIP não é do Estúdio Meu Bairro.');
  }
  return criancas;
}

async function lerCrianca(arquivos: Record<string, Uint8Array>): Promise<Crianca> {
  const dados = JSON.parse(strFromU8(arquivos['crianca.json'])) as CriancaJson;
  const gravacoes: Gravacao[] = [];
  for (const g of dados.gravacoes) {
    const gravacao: Gravacao = { chave: g.chave, tipo: g.tipo, rotulo: g.rotulo, anotacao: g.anotacao, vozAdulta: g.voz_adulta, tomadas: [], favorita: null };
    const zip = g.pacote ? arquivos[g.pacote] : undefined;
    if (zip) {
      const interno = unzipSync(zip);
      const info = JSON.parse(strFromU8(interno['gravacao.json'])) as GravacaoJson;
      for (const t of info.tomadas) {
        const wav = interno[t.arquivo];
        if (!wav) continue;
        const id = t.id || novaChave('t');
        await armazenamento.salvarAudio(id, lerWav(wav).amostras);
        const tomada: Tomada = { id, criada: Date.now(), duracao: t.duracao, inicio: t.inicio, fim: t.fim };
        gravacao.tomadas.push(tomada);
        if (t.favorita) gravacao.favorita = id;
      }
    }
    gravacoes.push(gravacao);
  }
  return { chave: dados.chave, apelido: dados.apelido, anotacao: dados.anotacao, criada: dados.criada, gravacoes };
}
