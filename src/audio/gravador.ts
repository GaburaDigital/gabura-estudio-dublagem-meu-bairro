// Microfone: escolhe o aparelho, mostra o nível (medidor) e grava a voz limpa em 48 kHz mono.
// A gravação usa um AudioWorklet, que entrega as amostras sem compressão (melhor que o MediaRecorder,
// que grava comprimido).

import { TAXA } from './processar';

// O código do worklet vai como texto para funcionar também no app de arquivo único.
const CODIGO_WORKLET = `
class Coletor extends AudioWorkletProcessor {
  constructor() { super(); this.gravando = false; this.port.onmessage = (e) => { this.gravando = e.data === 'gravar'; }; }
  process(entradas) {
    const c = entradas[0] && entradas[0][0];
    if (c) {
      let pico = 0; for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > pico) pico = a; }
      this.port.postMessage({ pico, amostras: this.gravando ? c.slice() : null });
    }
    return true;
  }
}
registerProcessor('coletor-gabura', Coletor);
`;

export interface Microfone { id: string; nome: string; }

export class Gravador {
  private ctx: AudioContext | null = null;
  private fluxo: MediaStream | null = null;
  private no: AudioNode | null = null;
  private fonte: MediaStreamAudioSourceNode | null = null;
  private retorno: GainNode | null = null;
  private querRetorno = false;
  private avisarNo: (msg: string) => void = () => {};
  private pedacos: Float32Array[] = [];
  private gravando = false;
  /** Chamado a cada ~3 ms com o pico do som (0 a 1) e, se gravando, as amostras novas. */
  aoNivel: (pico: number, novas: Float32Array | null) => void = () => {};
  microfoneAtual = '';
  private taxaReal = TAXA;

  get ligado(): boolean { return this.ctx !== null; }
  get estaGravando(): boolean { return this.gravando; }

  /** Lista os microfones. Os nomes só aparecem depois da primeira permissão. */
  static async listar(): Promise<Microfone[]> {
    const lista = await navigator.mediaDevices.enumerateDevices();
    return lista.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, nome: d.label || `Microfone ${i + 1}` }));
  }

  /** Liga o microfone escolhido. limpezaDoNavegador = supressão de ruído do próprio Chrome. */
  async ligar(idMicrofone: string, limpezaDoNavegador: boolean): Promise<void> {
    await this.desligar();
    try {
      await this.ligarDeVerdade(idMicrofone, limpezaDoNavegador);
    } catch (e) {
      await this.desligar();
      throw e;
    }
  }

  private async ligarDeVerdade(idMicrofone: string, limpezaDoNavegador: boolean): Promise<void> {
    this.fluxo = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: idMicrofone ? { exact: idMicrofone } : undefined,
        channelCount: 1,
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: limpezaDoNavegador,
        sampleRate: TAXA,
      },
    });
    this.microfoneAtual = this.fluxo.getAudioTracks()[0]?.getSettings().deviceId ?? idMicrofone;
    // Tenta 48 kHz direto; se o navegador não aceitar misturar taxas, grava na taxa do aparelho e converte no fim.
    let fonte: MediaStreamAudioSourceNode;
    try {
      this.ctx = new AudioContext({ sampleRate: TAXA, latencyHint: 'interactive' });
      fonte = this.ctx.createMediaStreamSource(this.fluxo);
    } catch {
      await this.ctx?.close().catch(() => {});
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      fonte = this.ctx.createMediaStreamSource(this.fluxo);
    }
    this.taxaReal = this.ctx.sampleRate;
    this.fonte = fonte;
    this.monitorar(this.querRetorno);
    try {
      await this.ligarWorklet(fonte);
    } catch {
      // Aberto como arquivo (file://) o Chrome não carrega worklets: usa o ScriptProcessor, mais antigo mas funciona igual.
      this.ligarScriptProcessor(fonte);
    }
  }

  private receber(pico: number, amostras: Float32Array | null): void {
    if (amostras && this.gravando) this.pedacos.push(amostras);
    this.aoNivel(pico, this.gravando ? amostras : null);
  }

  private async ligarWorklet(fonte: MediaStreamAudioSourceNode): Promise<void> {
    const ctx = this.ctx!;
    const url = URL.createObjectURL(new Blob([CODIGO_WORKLET], { type: 'text/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const no = new AudioWorkletNode(ctx, 'coletor-gabura', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
    no.port.onmessage = (e: MessageEvent<{ pico: number; amostras: Float32Array | null }>) => this.receber(e.data.pico, e.data.amostras);
    fonte.connect(no);
    this.no = no;
    this.avisarNo = (msg) => no.port.postMessage(msg);
  }

  private ligarScriptProcessor(fonte: MediaStreamAudioSourceNode): void {
    const ctx = this.ctx!;
    const proc = ctx.createScriptProcessor(1024, 1, 1);
    const mudo = ctx.createGain();
    mudo.gain.value = 0;
    proc.onaudioprocess = (e) => {
      const c = e.inputBuffer.getChannelData(0);
      let pico = 0;
      for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > pico) pico = a; }
      this.receber(pico, this.gravando ? c.slice() : null);
    };
    fonte.connect(proc).connect(mudo).connect(ctx.destination);
    this.no = proc;
    this.avisarNo = () => {};
  }

  /**
   * Retorno pelo computador: manda a voz do microfone para o fone.
   * Use só quando o microfone NÃO tem saída de fone própria (senão a voz chega duas vezes).
   */
  monitorar(ligar: boolean): void {
    this.querRetorno = ligar;
    if (!this.ctx || !this.fonte) return;
    if (ligar && !this.retorno) {
      this.retorno = this.ctx.createGain();
      this.retorno.gain.value = 1;
      this.fonte.connect(this.retorno).connect(this.ctx.destination);
      void this.ctx.resume();
    } else if (!ligar && this.retorno) {
      this.fonte.disconnect(this.retorno);
      this.retorno.disconnect();
      this.retorno = null;
    }
  }

  async desligar(): Promise<void> {
    this.gravando = false;
    this.fluxo?.getTracks().forEach((t) => t.stop());
    this.fluxo = null;
    if (this.ctx) await this.ctx.close().catch(() => {});
    this.ctx = null; this.no = null; this.fonte = null; this.retorno = null;
  }

  comecar(): void {
    if (!this.no) throw new Error('Ligue o microfone primeiro.');
    void this.ctx?.resume();
    this.pedacos = [];
    this.gravando = true;
    this.avisarNo('gravar');
  }

  /** Para e devolve tudo o que foi gravado, sempre em 48 kHz. */
  async parar(): Promise<Float32Array> {
    this.gravando = false;
    this.avisarNo('parar');
    const total = this.pedacos.reduce((a, p) => a + p.length, 0);
    const out = new Float32Array(total);
    let pos = 0;
    for (const p of this.pedacos) { out.set(p, pos); pos += p.length; }
    this.pedacos = [];
    if (this.taxaReal === TAXA || out.length === 0) return out;
    // converte para 48 kHz
    const n = Math.round((out.length * TAXA) / this.taxaReal);
    const off = new OfflineAudioContext(1, n, TAXA);
    const b = off.createBuffer(1, out.length, this.taxaReal);
    b.copyToChannel(out, 0);
    const s = off.createBufferSource(); s.buffer = b; s.connect(off.destination); s.start();
    return (await off.startRendering()).getChannelData(0).slice();
  }
}
