// Janelas de confirmação, pedido de texto e avisos rápidos (toast).
// Todo "apagar" passa por confirmar(), com o botão de apagar em vermelho.

import { h } from './dom';

function janela(conteudo: HTMLElement, aoFechar: () => void): { fechar: () => void } {
  const anterior = document.activeElement as HTMLElement | null;
  const fundo = h('div', { class: 'modal-fundo', role: 'presentation' });
  const caixa = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, conteudo);
  fundo.append(caixa);
  const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); aoFechar(); } };
  const fechar = () => { document.removeEventListener('keydown', tecla, true); fundo.remove(); anterior?.focus(); };
  document.addEventListener('keydown', tecla, true);
  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) { fechar(); aoFechar(); } });
  document.body.append(fundo);
  return { fechar };
}

/** Pergunta antes de fazer algo. Devolve true se confirmou. */
export function confirmar(titulo: string, texto: string, botaoSim = 'Apagar', perigo = true): Promise<boolean> {
  return new Promise((ok) => {
    const sim = h('button', { class: perigo ? 'bt perigo' : 'bt lima', type: 'button' }, botaoSim);
    const nao = h('button', { class: 'bt', type: 'button' }, 'Cancelar');
    const corpo = h('div', { class: 'modal-corpo' },
      h('h3', {}, titulo), h('p', {}, texto), h('div', { class: 'modal-bts' }, nao, sim));
    const j = janela(corpo, () => ok(false));
    sim.onclick = () => { j.fechar(); ok(true); };
    nao.onclick = () => { j.fechar(); ok(false); };
    nao.focus();
  });
}

/** Pede um texto (ex.: nome do preset). */
export function pedirTexto(titulo: string, rotulo: string, valor = ''): Promise<string | null> {
  return new Promise((ok) => {
    const campo = h('input', { id: 'campo-dialogo', class: 'campo', value: valor, type: 'text' });
    const sim = h('button', { class: 'bt lima', type: 'submit' }, 'Salvar');
    const nao = h('button', { class: 'bt', type: 'button' }, 'Cancelar');
    const form = h('form', { class: 'modal-corpo' },
      h('h3', {}, titulo), h('label', { for: 'campo-dialogo', class: 'rotulo' }, rotulo), campo, h('div', { class: 'modal-bts' }, nao, sim));
    const j = janela(form, () => ok(null));
    form.addEventListener('submit', (e) => { e.preventDefault(); const v = campo.value.trim(); if (!v) return; j.fechar(); ok(v); });
    nao.onclick = () => { j.fechar(); ok(null); };
    campo.focus(); campo.select();
  });
}

/** Mostra um conteúdo qualquer numa janela (ex.: ajustes). */
export function abrirJanela(conteudo: HTMLElement): { fechar: () => void } {
  return janela(conteudo, () => {});
}

let caixaAvisos: HTMLElement | null = null;
/** Aviso rápido no canto da tela. */
export function avisar(texto: string, tipo: 'ok' | 'erro' | 'info' = 'info'): void {
  if (!caixaAvisos) { caixaAvisos = h('div', { class: 'avisos', 'aria-live': 'polite' }); document.body.append(caixaAvisos); }
  const a = h('div', { class: 'aviso ' + tipo }, texto);
  caixaAvisos.append(a);
  setTimeout(() => a.remove(), tipo === 'erro' ? 7000 : 3500);
}
