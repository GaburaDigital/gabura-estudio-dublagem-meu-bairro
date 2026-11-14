// Edição de uma tomada, do jeito do editor de sons do Scratch: selecionar um trecho e
// apagar, silenciar, deixar mais alto ou mais baixo, ou fazer o som entrar/sair devagar (fade).
//
// A gravação original NUNCA é mudada. A tomada guarda só a lista de edições, e o som editado
// é refeito a partir do original sempre que precisa (é rápido). Assim dá para desfazer tudo
// e "voltar ao original" a qualquer momento.
//
// Cada edição usa os tempos (segundos) do som como ele estava naquele momento, já com as
// edições anteriores aplicadas — igual a quando você edita no Scratch, uma coisa depois da outra.
import { TAXA } from './processar';

export type TipoEdicao = 'apagar' | 'silenciar' | 'volume' | 'fade_entrada' | 'fade_saida';

export interface Edicao {
  tipo: TipoEdicao;
  /** Começo e fim do trecho, em segundos. */
  a: number;
  b: number;
  /** Só no "volume": 1.25 = mais alto, 0.8 = mais baixo. */
  ganho?: number;
}

export const MAIS_ALTO = 1.25;
export const MAIS_BAIXO = 0.8;

const BORDA = Math.floor(TAXA * 0.005); // 5 ms: emenda suave, sem estalo

/** Aplica uma edição e devolve um som novo (o de entrada não muda). */
export function aplicarEdicao(x: Float32Array, e: Edicao, taxa = TAXA): Float32Array {
  const a = Math.max(0, Math.min(x.length, Math.round(e.a * taxa)));
  const b = Math.max(a, Math.min(x.length, Math.round(e.b * taxa)));
  if (b - a < 2) return x;
  if (e.tipo === 'apagar') {
    const y = new Float32Array(x.length - (b - a));
    y.set(x.subarray(0, a), 0);
    y.set(x.subarray(b), a);
    // Emenda: esmaece um pouquinho dos dois lados do corte.
    const n = Math.min(BORDA, a, y.length - a);
    for (let i = 0; i < n; i++) {
      const k = i / n;
      y[a - 1 - i] *= k; // o fim da parte de antes some devagar
      y[a + i] *= k;     // e a parte de depois entra devagar
    }
    return y;
  }
  const y = x.slice();
  const tam = b - a;
  for (let i = a; i < b; i++) {
    const p = (i - a) / tam; // 0 no começo do trecho, 1 no fim
    let g = 1;
    if (e.tipo === 'silenciar') g = 0;
    else if (e.tipo === 'volume') g = e.ganho ?? 1;
    else if (e.tipo === 'fade_entrada') g = p;
    else if (e.tipo === 'fade_saida') g = 1 - p;
    y[i] *= g;
  }
  if (e.tipo === 'silenciar' || e.tipo === 'volume') {
    // Bordas suaves, para o volume não "pular".
    const g = e.tipo === 'silenciar' ? 0 : (e.ganho ?? 1);
    const n = Math.min(BORDA, Math.floor(tam / 4));
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const meio = g + (1 - g) * (1 - k); // de 1 até g
      y[a + i] = x[a + i] * meio;
      y[b - 1 - i] = x[b - 1 - i] * meio;
    }
  }
  for (let i = 0; i < y.length; i++) if (y[i] > 1) y[i] = 1; else if (y[i] < -1) y[i] = -1;
  return y;
}

/** O som editado: o original com todas as edições, na ordem. */
export function aplicarEdicoes(original: Float32Array, edicoes: readonly Edicao[] | undefined, taxa = TAXA): Float32Array {
  let x = original;
  for (const e of edicoes ?? []) x = aplicarEdicao(x, e, taxa);
  return x;
}

/** Depois de apagar um trecho, as alças de corte (início e fim) andam junto com o som. */
export function ajustarCorteDepoisDeApagar(inicio: number, fim: number, a: number, b: number): { inicio: number; fim: number } {
  const tira = b - a;
  const mover = (s: number) => (s <= a ? s : s >= b ? s - tira : a);
  const ini = mover(inicio), f = mover(fim);
  return { inicio: ini, fim: Math.max(f, ini + 0.1) };
}

export const NOME_EDICAO: Record<TipoEdicao, string> = {
  apagar: 'Apagar',
  silenciar: 'Silenciar',
  volume: 'Volume',
  fade_entrada: 'Fade de entrada',
  fade_saida: 'Fade de saída',
};
