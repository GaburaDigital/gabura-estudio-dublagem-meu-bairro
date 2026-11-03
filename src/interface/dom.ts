// Ajudantes pequenos para montar a interface sem framework.

type Filho = Node | string | number | null | undefined | false;
type Atributos = Record<string, unknown>;

/** Cria um elemento: h('button', { class: 'bt', onclick: f }, 'Gravar'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Atributos = {}, ...filhos: (Filho | Filho[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : String(f));
  }
  return el;
}

/** Segundos como "3,8 s". */
export function seg(s: number): string {
  return s.toFixed(1).replace('.', ',') + ' s';
}

/** Baixa um arquivo gerado pelo app. */
export function baixar(dados: Uint8Array | string, nome: string, tipo: string): void {
  const blob = new Blob([typeof dados === 'string' ? dados : (dados as unknown as BlobPart)], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Abre o seletor de arquivo e devolve os bytes. */
export function escolherArquivo(aceita: string): Promise<{ nome: string; bytes: Uint8Array } | null> {
  return new Promise((ok) => {
    const inp = h('input', { type: 'file', accept: aceita, style: { display: 'none' } });
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      inp.remove();
      if (!f) return ok(null);
      ok({ nome: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    });
    inp.addEventListener('cancel', () => { inp.remove(); ok(null); });
    document.body.append(inp);
    inp.click();
  });
}
