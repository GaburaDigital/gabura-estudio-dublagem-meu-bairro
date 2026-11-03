// Estúdio Meu Bairro: grava as audiodescrições das crianças no dia da oficina.
// Cada criança: Personagem, NPC, Cenário e extras. Até 3 tomadas por gravação (nenhuma é obrigatória).
import './estilo.css';
import { Gravador, type Microfone } from './audio/gravador';
import { TAXA, acharFala, prepararParaJogo } from './audio/processar';
import { armazenamento } from './dados/armazenamento';
import {
  MAX_TOMADAS, novaChave, novaCrianca, novaGravacao, novaOficina, tituloDaGravacao, tomadaEscolhida,
  type Crianca, type Gravacao, type Oficina,
} from './dados/modelo';
import { exportarCrianca, exportarTudo, importar, nomeDoZipDaCrianca } from './dados/pacote';
import { avisar, confirmar, pedirTexto } from './interface/dialogos';
import { baixar, escolherArquivo, h, seg } from './interface/dom';
import { Onda, OndaAoVivo } from './interface/onda';

// ---------- Estado ----------

let oficina: Oficina = novaOficina();
let selecionada: string | null = null;      // chave da criança aberta
let cartaoAtivo: string | null = null;      // chave da gravação onde o Espaço grava
let gravandoEm: string | null = null;       // chave da gravação que está gravando agora
const tomadaVista = new Map<string, string>(); // gravação -> tomada mostrada na onda
const cacheAudio = new Map<string, Float32Array>();
const gravador = new Gravador();
const ondaAoVivo = new OndaAoVivo();
let inicioGravacao = 0;
const DURACAO_LONGA = 30; // segundos: depois disso o relógio fica laranja (só um lembrete)

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const criancaAtual = (): Crianca | undefined => oficina.criancas.find((c) => c.chave === selecionada);

let tempoSalvar = 0;
function mudou(redesenharTudo = true): void {
  clearTimeout(tempoSalvar);
  tempoSalvar = window.setTimeout(() => {
    armazenamento.salvarOficina(oficina).catch((e) => avisar('Não foi possível salvar no navegador: ' + String(e), 'erro'));
  }, 300);
  if (redesenharTudo) desenhar();
}

async function audio(id: string): Promise<Float32Array | null> {
  const guardado = cacheAudio.get(id);
  if (guardado) return guardado;
  const lido = await armazenamento.lerAudio(id);
  if (lido) cacheAudio.set(id, lido);
  return lido;
}

// ---------- Tocar ----------

let ctxTocar: AudioContext | null = null;
let fonteTocando: AudioBufferSourceNode | null = null;
let aoPararTocar: (() => void) | null = null;

function pararSom(): void {
  try { fonteTocando?.stop(); } catch { /* já parou */ }
  fonteTocando = null;
  aoPararTocar?.();
  aoPararTocar = null;
}

function tocar(x: Float32Array, aoAcabar?: () => void): void {
  pararSom();
  ctxTocar ??= new AudioContext({ sampleRate: TAXA });
  void ctxTocar.resume();
  const b = ctxTocar.createBuffer(1, Math.max(1, x.length), TAXA);
  b.copyToChannel(x, 0);
  const s = ctxTocar.createBufferSource();
  s.buffer = b;
  s.connect(ctxTocar.destination);
  s.onended = () => { if (fonteTocando === s) { fonteTocando = null; aoPararTocar?.(); aoPararTocar = null; } };
  fonteTocando = s;
  aoPararTocar = aoAcabar ?? null;
  s.start();
}

// ---------- Microfone ----------

async function listarMicrofones(): Promise<void> {
  const sel = $<HTMLSelectElement>('microfone');
  let lista: Microfone[] = [];
  try { lista = await Gravador.listar(); } catch { /* sem permissão ainda */ }
  const guardado = (await armazenamento.lerConfig<string>('microfone')) ?? '';
  sel.replaceChildren(h('option', { value: '' }, 'Microfone padrão do computador'),
    ...lista.filter((m) => m.id && m.id !== 'default').map((m) => h('option', { value: m.id, selected: m.id === guardado }, m.nome)));
}

async function ligarMicrofone(): Promise<boolean> {
  const sel = $<HTMLSelectElement>('microfone');
  try {
    await gravador.ligar(sel.value, $<HTMLInputElement>('limpeza').checked);
    gravador.monitorar($<HTMLInputElement>('retorno').checked);
    await armazenamento.salvarConfig('microfone', sel.value);
    await listarMicrofones();
    sel.value = gravador.microfoneAtual && [...sel.options].some((o) => o.value === gravador.microfoneAtual) ? gravador.microfoneAtual : sel.value;
    $('ligar-microfone').textContent = 'Microfone ligado';
    $('ligar-microfone').classList.add('ligado');
    return true;
  } catch (e) {
    avisar('Não foi possível ligar o microfone. Confira se ele está conectado e se o navegador tem permissão. (' + String((e as Error).message ?? e) + ')', 'erro');
    return false;
  }
}

gravador.aoNivel = (pico, novas) => {
  const medidor = $('medidor');
  const db = 20 * Math.log10(Math.max(pico, 1e-5));
  const largura = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  medidor.style.setProperty('--nivel', `${largura}%`);
  medidor.dataset.faixa = db > -3 ? 'alto' : db > -18 ? 'bom' : 'baixo';
  if (novas) ondaAoVivo.adicionar(novas);
};

// ---------- Gravar ----------

async function alternarGravacao(g: Gravacao): Promise<void> {
  if (gravandoEm === g.chave) return pararGravacao(g);
  if (gravandoEm) return avisar('Já tem uma gravação acontecendo. Pare antes.', 'info');
  if (g.tomadas.length >= MAX_TOMADAS) return avisar(`Já tem ${MAX_TOMADAS} tomadas. Apague uma para gravar outra.`, 'info');
  if (!gravador.ligado && !(await ligarMicrofone())) return;
  pararSom();
  cartaoAtivo = g.chave;
  ondaAoVivo.limpar();
  gravador.comecar();
  gravandoEm = g.chave;
  inicioGravacao = performance.now();
  desenhar();
  relogio();
}

function relogio(): void {
  if (!gravandoEm) return;
  const s = (performance.now() - inicioGravacao) / 1000;
  const el = document.querySelector<HTMLElement>('.relogio');
  if (el) {
    el.textContent = seg(s);
    el.classList.toggle('longo', s > DURACAO_LONGA);
  }
  requestAnimationFrame(relogio);
}

async function pararGravacao(g: Gravacao): Promise<void> {
  const x = await gravador.parar();
  gravandoEm = null;
  if (x.length < TAXA * 0.3) {
    avisar('A gravação ficou curtinha demais e não foi guardada.', 'info');
    desenhar();
    return;
  }
  const corte = acharFala(x);
  const id = novaChave('t');
  try {
    await armazenamento.salvarAudio(id, x);
  } catch (e) {
    avisar('Não foi possível guardar a tomada: ' + String(e), 'erro');
    desenhar();
    return;
  }
  cacheAudio.set(id, x);
  g.tomadas.push({ id, criada: Date.now(), duracao: x.length / TAXA, inicio: corte.inicio, fim: corte.fim });
  if (!g.favorita) g.favorita = id; // a primeira já vale; se gravar de novo, você escolhe a estrela
  tomadaVista.set(g.chave, id);
  mudou();
  avisar(`Tomada ${g.tomadas.length} guardada.`, 'ok');
}

async function apagarTomada(g: Gravacao, id: string): Promise<void> {
  const i = g.tomadas.findIndex((t) => t.id === id);
  if (!(await confirmar(`Apagar a tomada ${i + 1}?`, 'Esta gravação será apagada deste computador. Não dá para desfazer.'))) return;
  pararSom();
  g.tomadas.splice(i, 1);
  await armazenamento.apagarAudio(id);
  cacheAudio.delete(id);
  if (g.favorita === id) g.favorita = g.tomadas.at(-1)?.id ?? null;
  if (tomadaVista.get(g.chave) === id) tomadaVista.delete(g.chave);
  mudou();
}

// ---------- Crianças ----------

async function adicionarCrianca(): Promise<void> {
  const apelido = await pedirTexto('Nova criança', 'Nome ou apelido da criança');
  if (!apelido) return;
  const c = novaCrianca(apelido);
  oficina.criancas.push(c);
  selecionada = c.chave;
  cartaoAtivo = c.gravacoes[0].chave;
  mudou();
}

async function apagarCrianca(c: Crianca): Promise<void> {
  const total = c.gravacoes.reduce((s, g) => s + g.tomadas.length, 0);
  if (!(await confirmar(`Apagar ${c.apelido || 'esta criança'}?`, `Todas as gravações dela (${total} tomada(s)) serão apagadas deste computador. Não dá para desfazer. Se quiser guardar, use "Exportar esta criança" antes.`))) return;
  for (const g of c.gravacoes) for (const t of g.tomadas) { await armazenamento.apagarAudio(t.id); cacheAudio.delete(t.id); }
  oficina.criancas = oficina.criancas.filter((x) => x !== c);
  selecionada = oficina.criancas.at(-1)?.chave ?? null;
  mudou();
}

async function adicionarExtra(c: Crianca): Promise<void> {
  const rotulo = await pedirTexto('Áudio extra', 'O que é este desenho? (ex.: pipa, cachorro, sorveteiro)');
  if (!rotulo) return;
  const g = novaGravacao('extra', rotulo);
  c.gravacoes.push(g);
  cartaoAtivo = g.chave;
  mudou();
}

async function removerExtra(c: Crianca, g: Gravacao): Promise<void> {
  if (!(await confirmar(`Remover o extra "${g.rotulo}"?`, `O extra e ${g.tomadas.length} tomada(s) serão apagados deste computador.`))) return;
  for (const t of g.tomadas) { await armazenamento.apagarAudio(t.id); cacheAudio.delete(t.id); }
  c.gravacoes = c.gravacoes.filter((x) => x !== g);
  mudou();
}

function pronta(g: Gravacao): boolean { return g.tomadas.length > 0; }

// ---------- Desenho da tela ----------

function desenhar(): void {
  desenharLista();
  desenharCrianca();
}

function desenharLista(): void {
  const lista = $('lista-criancas');
  $('total-criancas').textContent = String(oficina.criancas.length);
  lista.replaceChildren(...oficina.criancas.map((c) => {
    const fixas = c.gravacoes.filter((g) => g.tipo !== 'extra');
    const feitas = fixas.filter(pronta).length;
    const extras = c.gravacoes.filter((g) => g.tipo === 'extra').length;
    const b = h('button', { type: 'button', class: 'item-crianca', 'aria-pressed': String(c.chave === selecionada), onclick: () => { selecionada = c.chave; cartaoAtivo = c.gravacoes[0]?.chave ?? null; desenhar(); } },
      h('span', { class: 'apelido' }, c.apelido || 'sem apelido'),
      h('span', { class: 'progresso' + (feitas === fixas.length ? ' completo' : '') }, `${feitas}/${fixas.length}${extras ? ` +${extras}` : ''}`));
    return h('li', {}, b);
  }));
}

function campoTexto(rotulo: string, valor: string, aoMudar: (v: string) => void, dica = ''): HTMLElement {
  const id = novaChave('campo');
  const inp = h('input', { id, class: 'campo', value: valor, placeholder: dica, autocomplete: 'off' });
  inp.addEventListener('input', () => { aoMudar(inp.value); mudou(false); });
  return h('label', { class: 'rotulo', for: id }, rotulo, inp);
}

function desenharCrianca(): void {
  const area = $('crianca');
  const c = criancaAtual();
  if (!c) {
    area.replaceChildren(h('div', { class: 'vazio' },
      h('p', {}, oficina.criancas.length ? 'Escolha uma criança na lista.' : 'Comece clicando em "+ Nova criança".'),
      h('button', { class: 'bt principal', type: 'button', onclick: adicionarCrianca }, '+ Nova criança')));
    return;
  }
  const cabecalho = h('div', { class: 'cabecalho-crianca' },
    campoTexto('Nome ou apelido', c.apelido, (v) => { c.apelido = v; desenharLista(); }),
    campoTexto('Anotação (opcional)', c.anotacao, (v) => { c.anotacao = v; }, 'ex.: turma da tarde, 7 anos'),
    h('div', { class: 'linha-bts' },
      h('button', { class: 'bt', type: 'button', onclick: () => void exportarUma(c) }, 'Exportar esta criança'),
      h('button', { class: 'bt perigo-texto', type: 'button', onclick: () => void apagarCrianca(c) }, 'Apagar criança')));
  const cartoes = h('div', { class: 'cartoes' }, ...c.gravacoes.map((g) => cartao(c, g)),
    h('button', { class: 'cartao novo-extra', type: 'button', onclick: () => void adicionarExtra(c) }, '+ Adicionar extra'));
  area.replaceChildren(cabecalho, cartoes);
}

function cartao(c: Crianca, g: Gravacao): HTMLElement {
  const gravando = gravandoEm === g.chave;
  const cheio = g.tomadas.length >= MAX_TOMADAS;
  const vista = g.tomadas.find((t) => t.id === tomadaVista.get(g.chave)) ?? tomadaEscolhida(g);

  const titulo = g.tipo === 'extra'
    ? campoTexto('Extra: o que é', g.rotulo, (v) => { g.rotulo = v; desenharLista(); })
    : h('h3', {}, tituloDaGravacao(g));

  const botaoGravar = h('button', {
    class: 'bt gravar' + (gravando ? ' gravando' : ''), type: 'button', disabled: (!gravando && (cheio || !!gravandoEm)),
    onclick: () => void alternarGravacao(g),
  }, gravando ? '■ Parar' : '● Gravar');

  const tomadas = h('div', { class: 'tomadas', role: 'list' }, ...g.tomadas.map((t, i) => {
    const ehFavorita = t.id === g.favorita;
    return h('div', { class: 'tomada' + (vista?.id === t.id ? ' vista' : ''), role: 'listitem' },
      h('button', { class: 'bt-tomada', type: 'button', onclick: () => { tomadaVista.set(g.chave, t.id); cartaoAtivo = g.chave; desenharCrianca(); } },
        `Tomada ${i + 1}`, h('small', {}, seg(t.fim - t.inicio))),
      h('button', { class: 'bt-icone', type: 'button', title: 'Ouvir (como vai para o jogo)', 'aria-label': `Ouvir a tomada ${i + 1}`, onclick: () => void ouvir(g, t.id) }, '▶'),
      h('button', { class: 'bt-icone estrela' + (ehFavorita ? ' marcada' : ''), type: 'button', title: 'Escolhida para o jogo', 'aria-label': `Escolher a tomada ${i + 1}`, 'aria-pressed': String(ehFavorita), onclick: () => { g.favorita = t.id; mudou(); } }, '★'),
      h('button', { class: 'bt-icone perigo-texto', type: 'button', title: 'Apagar', 'aria-label': `Apagar a tomada ${i + 1}`, onclick: () => void apagarTomada(g, t.id) }, '🗑'));
  }));

  const corpoOnda = h('div', { class: 'area-onda' });
  if (gravando) corpoOnda.append(ondaAoVivo.el, h('span', { class: 'relogio' }, '0,0 s'));
  else if (vista) {
    void audio(vista.id).then((x) => {
      if (!x) return;
      const onda = new Onda({ amostras: x, inicio: vista.inicio, fim: vista.fim, aoCortar: (a, b) => { vista.inicio = a; vista.fim = b; mudou(false); desenharTomadasDuracao(); } });
      corpoOnda.append(onda.el, h('span', { class: 'dica-onda' }, 'Arraste as alças laranja para cortar o começo e o fim.'));
    });
  } else corpoOnda.append(h('p', { class: 'nota' }, 'Ainda não gravado.'));

  const adulto = h('input', { type: 'checkbox', checked: !!g.vozAdulta });
  const nomeAdulto = h('input', { class: 'campo', value: g.vozAdulta === '-' ? '' : g.vozAdulta, placeholder: 'Nome do adulto', hidden: !g.vozAdulta });
  adulto.addEventListener('change', () => { g.vozAdulta = adulto.checked ? (nomeAdulto.value.trim() || '-') : ''; nomeAdulto.hidden = !adulto.checked; if (adulto.checked) nomeAdulto.focus(); mudou(false); });
  nomeAdulto.addEventListener('input', () => { g.vozAdulta = nomeAdulto.value.trim() || '-'; mudou(false); });

  const el = h('section', {
    class: 'cartao' + (pronta(g) ? ' pronto' : '') + (cartaoAtivo === g.chave ? ' ativo' : ''),
    'aria-label': tituloDaGravacao(g), 'data-chave': g.chave,
    onpointerdown: () => { if (cartaoAtivo !== g.chave) { cartaoAtivo = g.chave; document.querySelectorAll('.cartao.ativo').forEach((x) => x.classList.remove('ativo')); el.classList.add('ativo'); } },
  },
    h('div', { class: 'topo-cartao' }, titulo, h('span', { class: 'selo' + (pronta(g) ? ' ok' : '') }, pronta(g) ? '✓ gravado' : 'falta')),
    campoTexto('O que é o desenho (para identificar)', g.anotacao, (v) => { g.anotacao = v; }, 'ex.: menina de vestido rosa'),
    h('div', { class: 'linha-gravar' }, botaoGravar,
      h('span', { class: 'nota' }, cheio && !gravando ? `${MAX_TOMADAS} tomadas: apague uma para gravar outra.` : `${g.tomadas.length} de ${MAX_TOMADAS} tomadas`)),
    corpoOnda,
    tomadas,
    h('label', { class: 'marcar' }, adulto, 'Voz de adulto da equipe'), nomeAdulto,
    g.tipo === 'extra' ? h('button', { class: 'bt perigo-texto pequeno', type: 'button', onclick: () => void removerExtra(c, g) }, 'Remover extra') : null);
  return el;
}

function desenharTomadasDuracao(): void {
  // Atualiza só as durações mostradas (sem redesenhar a onda que está sendo arrastada).
  const c = criancaAtual();
  if (!c) return;
  for (const g of c.gravacoes) {
    const el = document.querySelector(`[data-chave="${g.chave}"]`);
    el?.querySelectorAll('.bt-tomada small').forEach((s, i) => { const t = g.tomadas[i]; if (t) s.textContent = seg(t.fim - t.inicio); });
  }
}

async function ouvir(g: Gravacao, id: string): Promise<void> {
  const t = g.tomadas.find((x) => x.id === id);
  const x = t && (await audio(id));
  if (!t || !x) return;
  tomadaVista.set(g.chave, id);
  tocar(prepararParaJogo(x, t.inicio, t.fim));
}

// ---------- Salvar, importar, exportar ----------

function data(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`;
}

async function exportarUma(c: Crianca): Promise<void> {
  if (!c.apelido.trim()) return avisar('Escreva o nome ou apelido da criança antes.', 'erro');
  baixar(await exportarCrianca(c), nomeDoZipDaCrianca(c), 'application/zip');
  avisar(`ZIP de ${c.apelido} pronto.`, 'ok');
}

async function salvarTudo(): Promise<void> {
  if (oficina.criancas.length === 0) return avisar('Ainda não tem nenhuma criança.', 'info');
  avisar('Juntando as gravações...', 'info');
  baixar(await exportarTudo(oficina.criancas), `oficina_meu_bairro_${data()}.zip`, 'application/zip');
  avisar('Tudo salvo num ZIP. Guarde uma cópia em outro lugar (pendrive ou nuvem).', 'ok');
}

async function importarZip(): Promise<void> {
  const arq = await escolherArquivo('.zip,application/zip');
  if (!arq) return;
  try {
    const criancas = await importar(arq.bytes);
    const repetidas = criancas.filter((c) => oficina.criancas.some((x) => x.chave === c.chave));
    if (repetidas.length && !(await confirmar('Algumas crianças já estão aqui',
      `${repetidas.map((c) => c.apelido).join(', ')} já existe(m) neste computador. Importar vai trocar as gravações delas pelas do arquivo.`, 'Importar e trocar', false))) return;
    for (const c of criancas) {
      const i = oficina.criancas.findIndex((x) => x.chave === c.chave);
      if (i >= 0) oficina.criancas[i] = c; else oficina.criancas.push(c);
    }
    selecionada = criancas[0].chave;
    mudou();
    avisar(`${criancas.length} criança(s) importada(s).`, 'ok');
  } catch (e) {
    avisar('Não foi possível importar: ' + String((e as Error).message ?? e), 'erro');
  }
}

// ---------- Teclado ----------

document.addEventListener('keydown', (e) => {
  const alvo = e.target as HTMLElement;
  if (alvo.closest('input, textarea, select, .modal')) return;
  const c = criancaAtual();
  const g = c?.gravacoes.find((x) => x.chave === cartaoAtivo);
  if (e.code === 'Space' && g) { e.preventDefault(); void alternarGravacao(g); }
  else if (e.key === 'Escape') pararSom();
  else if ((e.key === 'p' || e.key === 'P') && g) {
    const t = g.tomadas.find((x) => x.id === tomadaVista.get(g.chave)) ?? tomadaEscolhida(g);
    if (t) void ouvir(g, t.id);
  }
});

// ---------- Começo ----------

$('nova-crianca').addEventListener('click', () => void adicionarCrianca());
$('salvar-tudo').addEventListener('click', () => void salvarTudo());
$('importar').addEventListener('click', () => void importarZip());
$('ligar-microfone').addEventListener('click', () => void ligarMicrofone());
$('microfone').addEventListener('change', () => { if (gravador.ligado) void ligarMicrofone(); });
$('limpeza').addEventListener('change', () => { if (gravador.ligado) void ligarMicrofone(); });
$('retorno').addEventListener('change', () => {
  const ligar = $<HTMLInputElement>('retorno').checked;
  gravador.monitorar(ligar);
  void armazenamento.salvarConfig('retorno', ligar);
});
$('abrir-ajuda').addEventListener('click', () => $<HTMLDialogElement>('ajuda').showModal());
$('versao').textContent = __VERSAO_APP__;

async function comecar(): Promise<void> {
  try {
    oficina = (await armazenamento.lerOficina()) ?? novaOficina();
    $<HTMLInputElement>('retorno').checked = (await armazenamento.lerConfig<boolean>('retorno')) ?? false;
  } catch {
    avisar('O navegador não deixou guardar dados. As gravações podem se perder ao fechar.', 'erro');
  }
  selecionada = oficina.criancas.at(-1)?.chave ?? null;
  cartaoAtivo = criancaAtual()?.gravacoes[0]?.chave ?? null;
  await listarMicrofones();
  desenhar();
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (navigator.storage?.persist) void navigator.storage.persist();
}
void comecar();

// Ganchos para os testes automáticos.
declare global { interface Window { __estudio: unknown } }
window.__estudio = { oficina: () => oficina, adicionar: (apelido: string) => { const c = novaCrianca(apelido); oficina.criancas.push(c); selecionada = c.chave; cartaoAtivo = c.gravacoes[0].chave; mudou(); return c.chave; } };
