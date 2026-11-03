// Tratamento das gravações das crianças: só o necessário para a voz ficar clara e com volume parecido.
// Nada de efeito de voz: a voz da criança vai natural para o jogo.
// (cortar e acharFala vêm do Estúdio de Dublagem Gabura.)

export const TAXA = 48000;

/** Corta a gravação entre início e fim (segundos), com esmaecimento curtinho nas pontas para não estalar. */
export function cortar(x: Float32Array, inicio: number, fim: number, taxa = TAXA): Float32Array {
  const a = Math.max(0, Math.floor(inicio * taxa));
  const b = Math.min(x.length, Math.ceil(fim * taxa));
  const y = x.slice(a, Math.max(a, b));
  const entrada = Math.min(Math.floor(taxa * 0.005), Math.floor(y.length / 4)); // 5 ms
  const saida = Math.min(Math.floor(taxa * 0.015), Math.floor(y.length / 4)); // 15 ms
  for (let i = 0; i < entrada; i++) y[i] *= i / entrada;
  for (let i = 0; i < saida; i++) y[y.length - 1 - i] *= i / saida;
  return y;
}

/** Acha início e fim da fala (tira silêncio do começo e do fim, deixando 0,12 s de folga). */
export function acharFala(x: Float32Array, taxa = TAXA): { inicio: number; fim: number } {
  const bloco = Math.floor(taxa * 0.01);
  const niveis: number[] = [];
  for (let i = 0; i + bloco <= x.length; i += bloco) {
    let s = 0;
    for (let j = 0; j < bloco; j++) s += x[i + j] * x[i + j];
    niveis.push(Math.sqrt(s / bloco));
  }
  if (niveis.length === 0) return { inicio: 0, fim: x.length / taxa };
  const ordenados = [...niveis].sort((a, b) => a - b);
  const fundo = ordenados[Math.floor(ordenados.length * 0.1)];
  const maior = ordenados[ordenados.length - 1];
  const limiar = Math.max(fundo * 3, maior * 0.06);
  let a = niveis.findIndex((n) => n > limiar);
  let b = niveis.length - 1 - [...niveis].reverse().findIndex((n) => n > limiar);
  if (a < 0) { a = 0; b = niveis.length - 1; }
  const folga = 0.12;
  return {
    inicio: Math.max(0, (a * bloco) / taxa - folga),
    fim: Math.min(x.length / taxa, ((b + 1) * bloco) / taxa + folga),
  };
}

/** Tira o ronco grave (vento, mesa, ar-condicionado): filtro passa-altas de 80 Hz. */
export function tirarRonco(x: Float32Array, taxa = TAXA): Float32Array {
  const rc = 1 / (2 * Math.PI * 80);
  const dt = 1 / taxa;
  const a = rc / (rc + dt);
  const y = new Float32Array(x.length);
  let anteriorX = 0, anteriorY = 0;
  for (let i = 0; i < x.length; i++) {
    anteriorY = a * (anteriorY + x[i] - anteriorX);
    anteriorX = x[i];
    y[i] = anteriorY;
  }
  return y;
}

/** Deixa todas as vozes com volume parecido (média da fala perto de -18 dB, sem passar de -1 dB no pico). */
export function nivelar(x: Float32Array): Float32Array {
  let soma = 0, n = 0, pico = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > pico) pico = a;
    if (a > 0.01) { soma += x[i] * x[i]; n++; }
  }
  if (n === 0 || pico === 0) return x.slice();
  const rms = Math.sqrt(soma / n);
  const ganho = Math.min(0.126 / rms, 0.89 / pico, 8);
  return x.map((v) => v * ganho);
}

/** O áudio que vai para o jogo: corte + sem ronco + volume nivelado. */
export function prepararParaJogo(x: Float32Array, inicio: number, fim: number): Float32Array {
  return nivelar(tirarRonco(cortar(x, inicio, fim)));
}
