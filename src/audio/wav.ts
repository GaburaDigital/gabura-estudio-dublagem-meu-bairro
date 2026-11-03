// WAV: o formato das gravações (sem perda). A Godot importa WAV e comprime sozinha (QOA).
// (Copiado do Estúdio de Dublagem Gabura.)

// ---------------- WAV ----------------

/** Cria um WAV mono. bits = 16 ou 24. */
export function criarWav(x: Float32Array, taxa: number, bits: 16 | 24 = 24): Uint8Array {
  const bytes = bits / 8;
  const dados = x.length * bytes;
  const out = new Uint8Array(44 + dados);
  const v = new DataView(out.buffer);
  const txt = (pos: number, s: string) => { for (let i = 0; i < s.length; i++) out[pos + i] = s.charCodeAt(i); };
  txt(0, 'RIFF'); v.setUint32(4, 36 + dados, true); txt(8, 'WAVE');
  txt(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, taxa, true); v.setUint32(28, taxa * bytes, true); v.setUint16(32, bytes, true); v.setUint16(34, bits, true);
  txt(36, 'data'); v.setUint32(40, dados, true);
  let pos = 44;
  for (let i = 0; i < x.length; i++) {
    const s = Math.max(-1, Math.min(1, x[i]));
    if (bits === 16) { v.setInt16(pos, Math.round(s * 32767), true); pos += 2; }
    else {
      const n = Math.round(s * 8388607);
      out[pos] = n & 0xff; out[pos + 1] = (n >> 8) & 0xff; out[pos + 2] = (n >> 16) & 0xff; pos += 3;
    }
  }
  return out;
}

/** Lê um WAV PCM (16, 24 ou 32 bits float) e devolve mono + taxa. Usado ao importar um projeto. */
export function lerWav(dados: Uint8Array): { amostras: Float32Array; taxa: number } {
  const v = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
  let pos = 12, taxa = 48000, canais = 1, bits = 16, formato = 1;
  while (pos + 8 <= dados.length) {
    const id = String.fromCharCode(dados[pos], dados[pos + 1], dados[pos + 2], dados[pos + 3]);
    const tam = v.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      formato = v.getUint16(pos + 8, true); canais = v.getUint16(pos + 10, true);
      taxa = v.getUint32(pos + 12, true); bits = v.getUint16(pos + 22, true);
    } else if (id === 'data') {
      const b = bits / 8, n = Math.floor(tam / (b * canais));
      const am = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = pos + 8 + i * b * canais;
        if (formato === 3) am[i] = v.getFloat32(p, true);
        else if (bits === 16) am[i] = v.getInt16(p, true) / 32768;
        else { let s = dados[p] | (dados[p + 1] << 8) | (dados[p + 2] << 16); if (s & 0x800000) s -= 0x1000000; am[i] = s / 8388608; }
      }
      return { amostras: am, taxa };
    }
    pos += 8 + tam + (tam & 1);
  }
  throw new Error('WAV sem dados de áudio.');
}

