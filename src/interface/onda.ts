// Desenho da onda do som em barrinhas (como no editor de sons do Scratch),
// com as alças de corte (início e fim), a seleção de trechos e a agulha do que está tocando.

import { TAXA } from '../audio/processar';

export interface OpcoesOnda {
  amostras: Float32Array;
  inicio?: number;
  fim?: number;
  /** Chamado ao soltar uma alça de corte. */
  aoCortar?: (inicio: number, fim: number) => void;
  /** Chamado ao terminar de arrastar uma seleção (null = clique sem arrastar, a seleção some). */
  aoSelecionar?: (selecao: { a: number; b: number } | null, clique: number) => void;
  cor?: string;
}

const COR_ATIVA = '#1f5fc4';
const COR_SELECIONADA = '#0b3a85';
const COR_FORA = '#c9c2a3';
const COR_ALCA = '#e8590c';
const COR_FUNDO_SELECAO = '#ffd16688';
const PEGAR_ALCA = 9; // pixels: perto assim da alça laranja, arrasta a alça

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

/**
 * Onda de uma tomada, com:
 * - alças laranja de corte (começo e fim);
 * - seleção de um trecho: arraste o mouse sobre a onda (fica amarelo);
 * - clique sem arrastar: tira a seleção e marca dali o lugar de começar a tocar;
 * - agulha preta que anda enquanto toca.
 */
export class Onda {
  readonly el: HTMLCanvasElement;
  private o: OpcoesOnda;
  private agulha = -1;
  private selecao: { a: number; b: number } | null = null;
  private arrastando: 'inicio' | 'fim' | 'selecao' | null = null;
  private ancora = 0;
  private xInicial = 0;
  private picosGuardados: { colunas: number; amostras: Float32Array; p: Float32Array } | null = null;

  constructor(o: OpcoesOnda) {
    this.o = o;
    this.el = document.createElement('canvas');
    this.el.className = 'onda';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', 'Onda do som da tomada');
    new ResizeObserver(() => this.desenhar()).observe(this.el);
    if (o.aoCortar || o.aoSelecionar) this.ligarArraste();
  }

  get duracao(): number { return this.o.amostras.length / TAXA; }
  get trechoSelecionado(): { a: number; b: number } | null { return this.selecao; }

  trocar(o: Partial<OpcoesOnda>): void { this.o = { ...this.o, ...o }; this.desenhar(); }
  marcarAgulha(segundos: number): void { this.agulha = segundos; this.desenhar(); }
  selecionar(sel: { a: number; b: number } | null): void { this.selecao = sel; this.desenhar(); }

  private xDe(s: number, w: number): number { return (s / Math.max(0.001, this.duracao)) * w; }

  private ligarArraste(): void {
    const posSeg = (e: PointerEvent) => {
      const r = this.el.getBoundingClientRect();
      return Math.max(0, Math.min(this.duracao, ((e.clientX - r.left) / r.width) * this.duracao));
    };
    const pertoDaAlca = (e: PointerEvent): 'inicio' | 'fim' | null => {
      if (!this.o.aoCortar) return null;
      const r = this.el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const xi = this.xDe(this.o.inicio ?? 0, r.width), xf = this.xDe(this.o.fim ?? this.duracao, r.width);
      if (Math.abs(x - xi) <= PEGAR_ALCA && Math.abs(x - xi) <= Math.abs(x - xf)) return 'inicio';
      if (Math.abs(x - xf) <= PEGAR_ALCA) return 'fim';
      return null;
    };
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.el.setPointerCapture(e.pointerId);
      const alca = pertoDaAlca(e);
      this.xInicial = e.clientX;
      if (alca) { this.arrastando = alca; this.moverAlca(posSeg(e)); return; }
      this.arrastando = 'selecao';
      this.ancora = posSeg(e);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!this.arrastando) { this.el.style.cursor = pertoDaAlca(e) ? 'ew-resize' : 'text'; return; }
      if (this.arrastando === 'selecao') {
        if (Math.abs(e.clientX - this.xInicial) < 4) return;
        const s = posSeg(e);
        this.selecao = { a: Math.min(this.ancora, s), b: Math.max(this.ancora, s) };
        this.desenhar();
      } else this.moverAlca(posSeg(e));
    });
    const soltar = (e: PointerEvent) => {
      const tipo = this.arrastando;
      if (!tipo) return;
      this.arrastando = null;
      if (tipo === 'selecao') {
        const clique = Math.abs(e.clientX - this.xInicial) < 4;
        if (clique) { this.selecao = null; this.agulha = this.ancora; this.desenhar(); }
        else if (this.selecao && this.selecao.b - this.selecao.a < 0.05) this.selecao = null;
        this.o.aoSelecionar?.(this.selecao, this.ancora);
      } else this.o.aoCortar?.(this.o.inicio ?? 0, this.o.fim ?? this.duracao);
    };
    this.el.addEventListener('pointerup', soltar);
    this.el.addEventListener('pointercancel', soltar);
  }

  private moverAlca(s: number): void {
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
    // Os picos só são recalculados quando o som ou a largura mudam (a agulha redesenha 60 vezes por segundo).
    if (!this.picosGuardados || this.picosGuardados.colunas !== colunas || this.picosGuardados.amostras !== this.o.amostras) {
      this.picosGuardados = { colunas, amostras: this.o.amostras, p: picos(this.o.amostras, colunas) };
    }
    const p = this.picosGuardados.p;
    let maior = 0.02;
    for (const v of p) maior = Math.max(maior, v);
    const ini = this.o.inicio ?? 0, fim = this.o.fim ?? this.duracao;
    const sel = this.selecao;
    if (sel) {
      g.fillStyle = COR_FUNDO_SELECAO;
      const xa = this.xDe(sel.a, w);
      g.fillRect(xa, 0, Math.max(2, this.xDe(sel.b, w) - xa), hh);
    }
    for (let c = 0; c < colunas; c++) {
      const s = ((c + 0.5) / colunas) * this.duracao;
      const alt = Math.max(2, (p[c] / maior) * (hh - 12));
      const dentro = s >= ini && s <= fim;
      g.fillStyle = !dentro ? COR_FORA : sel && s >= sel.a && s <= sel.b ? COR_SELECIONADA : (this.o.cor ?? COR_ATIVA);
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
      const x = this.xDe(this.agulha, w);
      g.fillStyle = '#1d1d1b';
      g.fillRect(x - 1, 0, 3, hh);
      g.beginPath(); g.moveTo(x - 6, 0); g.lineTo(x + 7, 0); g.lineTo(x + 0.5, 8); g.closePath(); g.fill();
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
