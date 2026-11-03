// Dados da oficina: cada criança tem as gravações do personagem, do NPC, do cenário e quantos extras quiser.
// As tomadas (o áudio) ficam guardadas à parte, no navegador, pelo id da tomada.

export type TipoGravacao = 'personagem' | 'npc' | 'cenario' | 'extra';

export const NOME_TIPO: Record<TipoGravacao, string> = {
  personagem: 'Personagem',
  npc: 'NPC (pessoa do bairro)',
  cenario: 'Cenário',
  extra: 'Extra',
};

export const MAX_TOMADAS = 3;

export interface Tomada {
  id: string;
  criada: number;
  duracao: number;
  /** Corte (segundos). */
  inicio: number;
  fim: number;
}

export interface Gravacao {
  chave: string;
  tipo: TipoGravacao;
  /** Nome curto do extra (ex.: "pipa"). Nos outros tipos fica vazio. */
  rotulo: string;
  /** Texto para identificar o desenho (ex.: "menina de vestido rosa"). Não é a legenda. */
  anotacao: string;
  /** Nome do adulto da equipe que gravou no lugar da criança ('' = voz da criança). */
  vozAdulta: string;
  tomadas: Tomada[];
  favorita: string | null;
}

export interface Crianca {
  chave: string;
  apelido: string;
  anotacao: string;
  criada: number;
  gravacoes: Gravacao[];
}

export interface Oficina {
  versao_formato: 1;
  nome: string;
  criancas: Crianca[];
}

let contador = 0;
export function novaChave(prefixo: string): string {
  return `${prefixo}_${Date.now().toString(36)}${(contador++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function novaGravacao(tipo: TipoGravacao, rotulo = ''): Gravacao {
  return { chave: novaChave('g'), tipo, rotulo, anotacao: '', vozAdulta: '', tomadas: [], favorita: null };
}

export function novaCrianca(apelido: string): Crianca {
  return {
    chave: novaChave('c'), apelido, anotacao: '', criada: Date.now(),
    gravacoes: [novaGravacao('personagem'), novaGravacao('npc'), novaGravacao('cenario')],
  };
}

export function novaOficina(): Oficina {
  return { versao_formato: 1, nome: 'Oficina Meu Bairro', criancas: [] };
}

/** "Maria Clara" -> "maria_clara" (nome de arquivo sem acento). */
export function paraId(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'sem_nome';
}

/** A tomada que vai para o jogo: a da estrela; sem estrela, a última gravada. */
export function tomadaEscolhida(g: Gravacao): Tomada | undefined {
  return g.tomadas.find((t) => t.id === g.favorita) ?? g.tomadas.at(-1);
}

/** Nome do pacote da gravação: personagem, npc, cenario ou extra_<rotulo>. */
export function nomeDaGravacao(g: Gravacao): string {
  return g.tipo === 'extra' ? `extra_${paraId(g.rotulo || 'sem_nome')}` : g.tipo;
}

export function tituloDaGravacao(g: Gravacao): string {
  return g.tipo === 'extra' ? `Extra: ${g.rotulo || 'sem nome'}` : NOME_TIPO[g.tipo];
}
