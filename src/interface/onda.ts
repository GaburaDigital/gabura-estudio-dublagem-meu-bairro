// Desenho da onda do som em barrinhas (como no editor de sons do Scratch),
// com as alças de corte (início e fim) e a agulha do que está tocando.

import { TAXA } from '../audio/processar';

export interface OpcoesOnda {
  amostras: Float32Array;
  inicio?: number;
  fim?: number;
  /** Chamado ao arrastar as alças de corte. */
  aoCortar?: (inicio: number, fim: number) => void;
  cor?: string;
}

const COR_ATIVA = '#1f5fc4';
const COR_FORA = '#c9c2a3';
const COR_ALCA = '#e8590c';

/** Picos por coluna, para desenhar rápido. */
function picos(x: Float32Array, colunas: number): Float32Array {
  const p = new Float32Array(colunas);
  const passo = x.length / colunas;
  for (let c = 0; c < colunas; c++) {
    let m = 0;
    const a = Math.floor(c * passo), b = Math.min(x.length, Math.floor((c + 1) * passo));
    for (let i = a; i < b; i++) { const v = Math.abs(x[i]); if (v > m) m = v; }
    p[c] = m;
  }
  return p;
}

export class Onda {
  readonly el: HTMLCanvasElement;
  private o: OpcoesOnda;
  private agulha = -1;
  private arrastando: 'inicio' | 'fim' | null = null;

  constructor(o: OpcoesOnda) {
    this.o = o;
    this.el = document.createElement('canvas');
    this.el.className = 'onda';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', 'Onda do som da tomada');
    new ResizeObserver(() => this.desenhar()).observe(this.el);
    if (o.aoCortar) this.ligarArraste();
  }

  get duracao(): number { return this.o.amostras.length / TAXA; }

  trocar(o: Partial<OpcoesOnda>): void { this.o = { ...this.o, ...o }; this.desenhar(); }
  marcarAgulha(segundos: number): void { this.agulha = segundos; this.desenhar(); }

  private xDe(s: number, w: number): number { return (s / Math.max(0.001, this.duracao)) * w; }

  private ligarArraste(): void {
    const posSeg = (e: PointerEvent) => {
      const r = this.el.getBoundingClientRect();
      return Math.max(0, Math.min(this.duracao, ((e.clientX - r.left) / r.width) * this.duracao));
    };
    this.el.addEventListener('pointerdown', (e) => {
      const s = posSeg(e);
      const ini = this.o.inicio ?? 0, fim = this.o.fim ?? this.duracao;
      this.arrastando = Math.abs(s - ini) < Math.abs(s - fim) ? 'inicio' : 'fim';
      this.el.setPointerCapture(e.pointerId);
      this.mover(s);
    });
    this.el.addEventListener('pointermove', (e) => { if (this.arrastando) this.mover(posSeg(e)); });
    const soltar = () => {
      if (!this.arrastando) return;
      this.arrastando = null;
      this.o.aoCortar?.(this.o.inicio ?? 0, this.o.fim ?? this.duracao);
    };
    this.el.addEventListener('pointerup', soltar);
    this.el.addEventListener('pointercancel', soltar);
  }

  private mover(s: number): void {
    const ini = this.o.inicio ?? 0, fim = this.o.fim ?? this.duracao;
    if (this.arrastando === 'inicio') this.o.inicio = Math.min(s, fim - 0.1);
    else this.o.fim = Math.max(s, ini + 0.1);
    this.desenhar();
  }

  desenhar(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, this.el.clientWidth), hh = Math.max(10, this.el.clientHeight);
    if (this.el.width !== Math.round(w * dpr)) this.el.width = Math.round(w * dpr);
    if (this.el.height !== Math.round(hh * dpr)) this.el.height = Math.round(hh * dpr);
    const g = this.el.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    const larguraBarra = 3, espaco = 2;
    const colunas = Math.max(1, Math.floor(w / (larguraBarra + espaco)));
    const p = picos(this.o.amostras, colunas);
    let maior = 0.02;
    for (const v of p) maior = Math.max(maior, v);
    const ini = this.o.inicio ?? 0, fim = this.o.fim ?? this.duracao;
    for (let c = 0; c < colunas; c++) {
      const s = ((c + 0.5) / colunas) * this.duracao;
      const alt = Math.max(2, (p[c] / maior) * (hh - 12));
      g.fillStyle = s >= ini && s <= fim ? (this.o.cor ?? COR_ATIVA) : COR_FORA;
      const x = c * (larguraBarra + espaco);
      g.beginPath();
      g.roundRect(x, (hh - alt) / 2, larguraBarra, alt, 1.5);
      g.fill();
    }
    if (this.o.aoCortar) {
      for (const s of [ini, fim]) {
        const x = this.xDe(s, w);
        g.fillStyle = COR_ALCA;
        g.fillRect(x - 1, 0, 2, hh);
        g.beginPath(); g.roundRect(x - 6, hh / 2 - 12, 12, 24, 4); g.fill();
      }
    }
    if (this.agulha >= 0) {
      g.fillStyle = '#1d1d1b';
      g.fillRect(this.xDe(this.agulha, w), 0, 2, hh);
    }
  }
}

/** Onda ao vivo durante a gravação: barrinhas entrando pela direita. */
export class OndaAoVivo {
  readonly el: HTMLCanvasElement;
  private barras: number[] = [];
  private acumulado = 0;
  private picoBloco = 0;

  constructor() {
    this.el = document.createElement('canvas');
    this.el.className = 'onda ao-vivo';
    this.el.setAttribute('aria-label', 'Onda ao vivo da gravação');
  }

  limpar(): void { this.barras = []; this.acumulado = 0; this.picoBloco = 0; this.desenhar(); }

  /** Recebe amostras novas do microfone. */
  adicionar(x: Float32Array): void {
    const porBarra = Math.floor(TAXA * 0.03);
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > this.picoBloco) this.picoBloco = a;
      if (++this.acumulado >= porBarra) { this.barras.push(this.picoBloco); this.acumulado = 0; this.picoBloco = 0; }
    }
    this.desenhar();
  }

  desenhar(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, this.el.clientWidth), hh = Math.max(10, this.el.clientHeight);
    if (this.el.width !== Math.round(w * dpr)) { this.el.width = Math.round(w * dpr); this.el.height = Math.round(hh * dpr); }
    const g = this.el.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    const passo = 5, colunas = Math.floor(w / passo);
    const visiveis = this.barras.slice(-colunas);
    visiveis.forEach((v, i) => {
      const alt = Math.max(2, Math.min(1, v * 1.4) * (hh - 10));
      g.fillStyle = v > 0.95 ? '#c92a2a' : '#1f5fc4';
      g.beginPath(); g.roundRect(i * passo, (hh - alt) / 2, 3, alt, 1.5); g.fill();
    });
  }
}
