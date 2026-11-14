// Estúdio Meu Bairro: grava as audiodescrições das crianças no dia da oficina.
// Cada criança: Personagem, NPC, Cenário e extras. Até 5 tomadas por gravação (nenhuma é obrigatória).
// Cada tomada pode ser editada como no Scratch (selecionar, apagar, silenciar, volume, fades),
// sem nunca mudar a gravação original.
import './estilo.css';
import { Gravador, type Microfone } from './audio/gravador';
import { TAXA, acharFala, ganhoParaNivelar, tirarRonco } from './audio/processar';
import { MAIS_ALTO, MAIS_BAIXO, aplicarEdicoes, ajustarCorteDepoisDeApagar, type Edicao } from './audio/edicao';
import { armazenamento } from './dados/armazenamento';
import {
  MAX_TOMADAS, novaChave, novaCrianca, novaGravacao, novaOficina, tituloDaGravacao, tomadaEscolhida,
  type Crianca, type Gravacao, type Oficina, type Tomada,
} from './dados/modelo';
import { exportarCrianca, exportarTudoEmBlob, importar, nomeDoZipDaCrianca } from './dados/pacote';
import { abrirJanela, avisar, confirmar, pedirTexto } from './interface/dialogos';
import { baixar, escolherArquivo, h, seg } from './interface/dom';
import { Onda, OndaAoVivo } from './interface/onda';

// ---------- Estado ----------

let oficina: Oficina = novaOficina();
let selecionada: string | null = null;      // chave da criança aberta
let cartaoAtivo: string | null = null;      // chave da gravação onde o Espaço grava
let gravandoEm: string | null = null;       // chave da gravação que está gravando agora
const tomadaVista = new Map<string, string>(); // gravação -> tomada mostrada na onda
// Só as últimas gravações abertas ficam na memória (as outras são lidas do disco quando precisar).
// Assim a página não vai ficando pesada com 60 ou mais gravações.
const MAXIMO_NA_MEMORIA = 8;
const cacheAudio = new Map<string, Float32Array>();
const cacheEditado = new Map<string, { chave: string; x: Float32Array }>();
function guardarNaMemoria<T>(mapa: Map<string, T>, id: string, valor: T): void {
  mapa.delete(id);
  mapa.set(id, valor);
  while (mapa.size > MAXIMO_NA_MEMORIA) mapa.delete(mapa.keys().next().value as string);
}
const gravador = new Gravador();
const ondaAoVivo = new OndaAoVivo();
let inicioGravacao = 0;
const DURACAO_LONGA = 60; // segundos: depois disso o relógio fica laranja (só um lembrete)

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const criancaAtual = (): Crianca | undefined => oficina.criancas.find((c) => c.chave === selecionada);

let tempoSalvar = 0;
function mudou(redesenharTudo = true): void {
  clearTimeout(tempoSalvar);
  tempoSalvar = window.setTimeout(() => {
    armazenamento.salvarOficina(oficina).catch((e) => avisar('Não foi possível salvar no navegador: ' + String(e), 'erro'));
  }, 300);
  const c = criancaAtual();
  if (c) c.mudou = Date.now();
  mostrarBackup();
  if (redesenharTudo) desenhar();
}

async function audio(id: string): Promise<Float32Array | null> {
  const guardado = cacheAudio.get(id);
  if (guardado) { guardarNaMemoria(cacheAudio, id, guardado); return guardado; }
  const lido = await armazenamento.lerAudio(id);
  if (lido) guardarNaMemoria(cacheAudio, id, lido);
  return lido;
}

/** O som da tomada com as edições (o original não muda). */
async function somEditado(t: Tomada): Promise<Float32Array | null> {
  const chave = JSON.stringify(t.edicoes ?? []);
  const guardado = cacheEditado.get(t.id);
  if (guardado && guardado.chave === chave) return guardado.x;
  const original = await audio(t.id);
  if (!original) return null;
  const x = aplicarEdicoes(original, t.edicoes);
  guardarNaMemoria(cacheEditado, t.id, { chave, x });
  return x;
}

// ---------- Tocar ----------

let ctxTocar: AudioContext | null = null;
let fonteTocando: AudioBufferSourceNode | null = null;
let aoPararTocar: (() => void) | null = null;

function pararSom(): void {
  try { fonteTocando?.stop(); } catch { /* já parou */ }
  fonteTocando = null;
  const fim = aoPararTocar;
  aoPararTocar = null;
  fim?.();
}

/** Toca um som. aoAndar recebe os segundos já tocados (para a agulha andar na onda). */
function tocar(x: Float32Array, aoAcabar?: () => void, aoAndar?: (s: number) => void): void {
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
  const ctx = ctxTocar;
  const comeco = ctx.currentTime;
  s.start();
  if (aoAndar) {
    const andar = () => {
      if (fonteTocando !== s) return;
      aoAndar(Math.min(x.length / TAXA, ctx.currentTime - comeco));
      requestAnimationFrame(andar);
    };
    requestAnimationFrame(andar);
  }
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
  guardarNaMemoria(cacheAudio, id, x);
  g.tomadas.push({ id, criada: Date.now(), duracao: x.length / TAXA, inicio: corte.inicio, fim: corte.fim, corteOriginal: corte });
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
  cacheEditado.delete(id);
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
      precisaBackup(c) ? h('span', { class: 'sem-backup', title: 'Tem gravação sem backup' }, '●') : null,
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
  if (editorTocando) pararSom();
  editores.clear();
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
  else if (vista) void montarEditor(c, g, vista, corpoOnda);
  else corpoOnda.append(h('p', { class: 'nota' }, 'Ainda não gravado.'));

  const adulto = h('input', { type: 'checkbox', checked: !!g.vozAdulta });
  const nomeAdulto = h('input', { class: 'campo', value: g.vozAdulta === '-' ? '' : g.vozAdulta, placeholder: 'Nome do adulto', hidden: !g.vozAdulta });
  adulto.addEventListener('change', () => { g.vozAdulta = adulto.checked ? (nomeAdulto.value.trim() || '-') : ''; nomeAdulto.hidden = !adulto.checked; if (adulto.checked) nomeAdulto.focus(); mudou(false); });
  nomeAdulto.addEventListener('input', () => { g.vozAdulta = nomeAdulto.value.trim() || '-'; mudou(false); });

  const el = h('section', {
    class: 'cartao' + (pronta(g) ? ' pronto' : '') + (cartaoAtivo === g.chave ? ' ativo' : '') + (ampliados.has(g.chave) ? ' ampliado' : ''),
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

// ---------- Editor da tomada (como o editor de sons do Scratch) ----------

interface Editor {
  gravacao: Gravacao;
  tomada: Tomada;
  onda: Onda;
  x: Float32Array;            // o som editado que está na tela
  botoes: Record<string, HTMLButtonElement>;
}
/** O editor aberto em cada cartão (pela chave da gravação). */
const editores = new Map<string, Editor>();
/** Seleção e lugar de começar a tocar, por tomada (sobrevivem quando a tela é redesenhada). */
const selecoes = new Map<string, { a: number; b: number } | null>();
const cursores = new Map<string, number>();
/** Desfazer: fotos de antes de cada edição, por tomada (só enquanto a página estiver aberta). */
const historico = new Map<string, { edicoes: Edicao[]; inicio: number; fim: number }[]>();
let editorTocando: Editor | null = null;
/** Cartões abertos em tamanho grande (a onda ocupa a largura toda, bom para entrevistas longas). */
const ampliados = new Set<string>();

async function montarEditor(c: Crianca, g: Gravacao, t: Tomada, corpo: HTMLElement): Promise<void> {
  const x = await somEditado(t);
  if (!x) return;
  const onda = new Onda({
    amostras: x, inicio: t.inicio, fim: t.fim,
    aoCortar: (a, b) => { guardarHistorico(t); t.inicio = a; t.fim = b; mudou(false); desenharTomadasDuracao(); atualizarBotoes(ed); },
    aoSelecionar: (sel, clique) => {
      selecoes.set(t.id, sel);
      if (!sel) cursores.set(t.id, clique);
      atualizarBotoes(ed);
      if (editorTocando === ed) pararSom();
    },
  });
  const sel = selecoes.get(t.id) ?? null;
  onda.selecionar(sel);
  const cursor = cursores.get(t.id);
  if (cursor !== undefined && !sel) onda.marcarAgulha(cursor);

  const bt = (texto: string, titulo: string, acao: () => void, classe = '') =>
    h('button', { class: 'bt pequeno ' + classe, type: 'button', title: titulo, onclick: acao }, texto);
  const botoes: Record<string, HTMLButtonElement> = {
    tocar: bt('▶ Tocar', 'Toca a seleção (ou do ponto marcado até o fim). Atalho: P', () => void tocarEditor(ed), 'principal'),
    apagar: bt('✂ Apagar', 'Apaga o trecho selecionado (o resto se junta). Atalho: Delete', () => editar(ed, 'apagar')),
    silenciar: bt('🔇 Silenciar', 'Deixa o trecho selecionado em silêncio (o tempo continua igual)', () => editar(ed, 'silenciar')),
    alto: bt('🔊 Mais alto', 'Sem seleção, vale para a gravação toda', () => editar(ed, 'volume', MAIS_ALTO)),
    baixo: bt('🔉 Mais baixo', 'Sem seleção, vale para a gravação toda', () => editar(ed, 'volume', MAIS_BAIXO)),
    entrada: bt('◢ Fade de entrada', 'O som começa baixinho e vai subindo', () => editar(ed, 'fade_entrada')),
    saida: bt('◣ Fade de saída', 'O som vai abaixando até sumir', () => editar(ed, 'fade_saida')),
    copiar: bt('⧉ Copiar para…', 'Copia o trecho selecionado como uma tomada nova de outro desenho', () => void copiarTrecho(c, ed)),
    desfazer: bt('↶ Desfazer', 'Desfaz a última edição. Atalho: Ctrl+Z', () => desfazer(ed)),
    original: bt('Voltar ao original', 'Tira todas as edições desta tomada', () => void voltarAoOriginal(ed), 'perigo-texto'),
    ampliar: bt(ampliados.has(g.chave) ? '⤡ Diminuir' : '⤢ Ampliar', 'Abre a onda grande, na largura toda (bom para gravações longas)', () => {
      if (ampliados.has(g.chave)) ampliados.delete(g.chave); else ampliados.add(g.chave);
      cartaoAtivo = g.chave;
      desenharCrianca();
      document.querySelector(`[data-chave="${g.chave}"]`)?.scrollIntoView({ block: 'nearest' });
    }),
  };
  const ed: Editor = { gravacao: g, tomada: t, onda, x, botoes };
  editores.set(g.chave, ed);
  corpo.replaceChildren(onda.el, h('div', { class: 'info-selecao', 'aria-live': 'polite' }),
    h('div', { class: 'barra-edicao', role: 'toolbar', 'aria-label': 'Editar a tomada' },
      botoes.tocar, botoes.apagar, botoes.silenciar, botoes.alto, botoes.baixo, botoes.entrada, botoes.saida),
    h('div', { class: 'barra-edicao' }, botoes.copiar, botoes.desfazer, botoes.original, botoes.ampliar,
      h('span', { class: 'dica-onda' }, (t.edicoes?.length ? `${t.edicoes.length} edição(ões) · ` : '') +
        'Arraste sobre a onda para selecionar. Alças laranja: começo e fim.')));
  atualizarBotoes(ed);
}

function atualizarBotoes(ed: Editor): void {
  const temSelecao = !!selecoes.get(ed.tomada.id);
  ed.botoes.apagar.disabled = !temSelecao;
  ed.botoes.silenciar.disabled = !temSelecao;
  ed.botoes.copiar.disabled = !temSelecao;
  ed.botoes.desfazer.disabled = !(historico.get(ed.tomada.id)?.length);
  ed.botoes.original.disabled = !(ed.tomada.edicoes?.length);
  ed.botoes.tocar.textContent = editorTocando === ed ? '■ Parar' : temSelecao ? '▶ Tocar seleção' : '▶ Tocar';
  const info = ed.onda.el.parentElement?.querySelector('.info-selecao');
  const sel = selecoes.get(ed.tomada.id);
  if (info) info.textContent = sel ? `Seleção: ${seg(sel.a)} até ${seg(sel.b)} (${seg(sel.b - sel.a)})` : `Gravação: ${seg(ed.x.length / TAXA)} · vai para o jogo: ${seg(ed.tomada.fim - ed.tomada.inicio)}`;
}

function guardarHistorico(t: Tomada): void {
  const h = historico.get(t.id) ?? [];
  h.push({ edicoes: [...(t.edicoes ?? [])], inicio: t.inicio, fim: t.fim });
  if (h.length > 50) h.shift();
  historico.set(t.id, h);
}

async function recarregarEditor(ed: Editor): Promise<void> {
  const x = await somEditado(ed.tomada);
  if (!x) return;
  ed.x = x;
  ed.onda.trocar({ amostras: x, inicio: ed.tomada.inicio, fim: ed.tomada.fim });
  ed.onda.selecionar(selecoes.get(ed.tomada.id) ?? null);
  atualizarBotoes(ed);
  desenharTomadasDuracao();
  const dica = ed.onda.el.parentElement?.querySelector('.dica-onda');
  if (dica) dica.textContent = (ed.tomada.edicoes?.length ? `${ed.tomada.edicoes.length} edição(ões) · ` : '') +
    'Arraste sobre a onda para selecionar. Alças laranja: começo e fim.';
}

/** Aplica uma edição no trecho selecionado (sem seleção: no trecho entre as alças laranja). */
function editar(ed: Editor, tipo: Edicao['tipo'], ganho?: number): void {
  const t = ed.tomada;
  const sel = selecoes.get(t.id) ?? null;
  if (!sel && (tipo === 'apagar' || tipo === 'silenciar')) return avisar('Primeiro selecione um trecho: arraste sobre a onda.', 'info');
  const trecho = sel ?? { a: t.inicio, b: t.fim };
  pararSom();
  guardarHistorico(t);
  const e: Edicao = { tipo, a: trecho.a, b: trecho.b, ...(ganho ? { ganho } : {}) };
  t.edicoes = [...(t.edicoes ?? []), e];
  if (tipo === 'apagar') {
    const corte = ajustarCorteDepoisDeApagar(t.inicio, t.fim, trecho.a, trecho.b);
    t.inicio = corte.inicio; t.fim = corte.fim;
    selecoes.set(t.id, null);
    cursores.set(t.id, trecho.a);
  }
  mudou(false);
  void recarregarEditor(ed).then(() => { if (tipo === 'apagar') ed.onda.marcarAgulha(trecho.a); });
}

function desfazer(ed: Editor): void {
  const foto = historico.get(ed.tomada.id)?.pop();
  if (!foto) return;
  pararSom();
  ed.tomada.edicoes = foto.edicoes.length ? foto.edicoes : undefined;
  ed.tomada.inicio = foto.inicio; ed.tomada.fim = foto.fim;
  selecoes.set(ed.tomada.id, null);
  mudou(false);
  void recarregarEditor(ed);
}

async function voltarAoOriginal(ed: Editor): Promise<void> {
  const t = ed.tomada;
  if (!(await confirmar('Voltar ao original?', 'Todas as edições desta tomada serão tiradas. A gravação volta a ser como foi gravada. (Dá para desfazer com "↶ Desfazer".)', 'Voltar ao original'))) return;
  pararSom();
  guardarHistorico(t);
  const original = await audio(t.id);
  const corte = t.corteOriginal ?? (original ? acharFala(original) : { inicio: 0, fim: t.duracao });
  t.edicoes = undefined;
  t.inicio = corte.inicio; t.fim = corte.fim;
  selecoes.set(t.id, null);
  mudou(false);
  void recarregarEditor(ed);
}

/** Toca a seleção; sem seleção, do ponto marcado (ou da alça do começo) até a alça do fim. A agulha anda junto. */
async function tocarEditor(ed: Editor): Promise<void> {
  if (editorTocando === ed) { pararSom(); return; }
  const t = ed.tomada;
  const sel = selecoes.get(t.id) ?? null;
  const cursor = cursores.get(t.id);
  let a = sel?.a ?? t.inicio, b = sel?.b ?? t.fim;
  if (!sel && cursor !== undefined && cursor > t.inicio && cursor < t.fim - 0.05) a = cursor;
  if (!sel && cursor !== undefined && cursor >= t.fim - 0.05) { a = cursor; b = ed.x.length / TAXA; }
  // Ouve como vai para o jogo: sem o ronco grave e com o volume nivelado pelo trecho entre as alças.
  const ia = Math.floor(a * TAXA), ib = Math.min(ed.x.length, Math.ceil(b * TAXA));
  const regiao = ed.x.subarray(Math.floor(t.inicio * TAXA), Math.ceil(t.fim * TAXA));
  const ganho = ganhoParaNivelar(regiao);
  const y = tirarRonco(ed.x.subarray(ia, ib));
  for (let i = 0; i < y.length; i++) y[i] = Math.max(-1, Math.min(1, y[i] * ganho));
  editorTocando = ed;
  atualizarBotoes(ed);
  tocar(y, () => {
    editorTocando = null;
    ed.onda.marcarAgulha(sel ? -1 : (cursores.get(t.id) ?? -1));
    atualizarBotoes(ed);
  }, (s) => ed.onda.marcarAgulha(a + s));
}

/** Ouvir pelo botão ▶ da lista de tomadas: mostra a tomada e toca com a agulha. */
async function ouvir(g: Gravacao, id: string): Promise<void> {
  const t = g.tomadas.find((x) => x.id === id);
  if (!t) return;
  if (tomadaVista.get(g.chave) !== id || editores.get(g.chave)?.tomada !== t) {
    tomadaVista.set(g.chave, id);
    cartaoAtivo = g.chave;
    desenharCrianca();
    for (let i = 0; i < 40 && editores.get(g.chave)?.tomada !== t; i++) await new Promise((r) => setTimeout(r, 25));
  }
  const ed = editores.get(g.chave);
  if (ed && ed.tomada === t) { selecoes.set(t.id, null); cursores.delete(t.id); ed.onda.selecionar(null); await tocarEditor(ed); }
}

/** Copia o trecho selecionado como uma tomada nova de outro desenho (ou de um extra novo). */
async function copiarTrecho(c: Crianca, ed: Editor): Promise<void> {
  const sel = selecoes.get(ed.tomada.id);
  if (!sel) return avisar('Primeiro selecione um trecho: arraste sobre a onda.', 'info');
  const destino = await escolherDestino(c, ed.gravacao);
  if (!destino) return;
  let g = destino === 'novo' ? null : destino;
  if (!g) {
    const rotulo = await pedirTexto('Novo extra', 'O que é este desenho? (ex.: pipa, cachorro)');
    if (!rotulo) return;
    g = novaGravacao('extra', rotulo);
    c.gravacoes.push(g);
  }
  const trecho = ed.x.slice(Math.floor(sel.a * TAXA), Math.ceil(sel.b * TAXA));
  const id = novaChave('t');
  try { await armazenamento.salvarAudio(id, trecho); } catch (e) { return avisar('Não foi possível guardar: ' + String(e), 'erro'); }
  guardarNaMemoria(cacheAudio, id, trecho);
  const dur = trecho.length / TAXA;
  g.tomadas.push({ id, criada: Date.now(), duracao: dur, inicio: 0, fim: dur, corteOriginal: { inicio: 0, fim: dur } });
  if (!g.favorita) g.favorita = id;
  tomadaVista.set(g.chave, id);
  mudou();
  avisar(`Trecho copiado para ${tituloDaGravacao(g)} (tomada ${g.tomadas.length}).`, 'ok');
}

function escolherDestino(c: Crianca, origem: Gravacao): Promise<Gravacao | 'novo' | null> {
  return new Promise((ok) => {
    let j: { fechar: () => void } | null = null;
    const fim = (v: Gravacao | 'novo' | null) => { j?.fechar(); ok(v); };
    const opcoes = c.gravacoes.map((g) => {
      const cheio = g.tomadas.length >= MAX_TOMADAS;
      return h('button', { class: 'bt largo', type: 'button', disabled: cheio, onclick: () => fim(g) },
        tituloDaGravacao(g) + (g === origem ? ' (este mesmo)' : '') + (cheio ? ` · já tem ${MAX_TOMADAS} tomadas` : ` · ${g.tomadas.length} tomada(s)`));
    });
    const corpo = h('div', { class: 'modal-corpo' },
      h('h3', {}, 'Copiar o trecho para…'),
      h('p', { class: 'nota' }, 'O trecho vira uma tomada nova. A gravação de onde ele saiu continua igual.'),
      h('div', { class: 'lista-destinos' }, ...opcoes,
        h('button', { class: 'bt largo', type: 'button', onclick: () => fim('novo') }, '+ Novo extra…')),
      h('div', { class: 'modal-bts' }, h('button', { class: 'bt', type: 'button', onclick: () => fim(null) }, 'Cancelar')));
    j = abrirJanela(corpo);
  });
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
  c.backup = Date.now();
  void armazenamento.salvarOficina(oficina).catch(() => {});
  mostrarBackup(); desenharLista();
  avisar(`ZIP de ${c.apelido} pronto.`, 'ok');
}

// ---------- Backup e espaço ----------

/** A criança tem gravação ou mudança depois do último backup? */
function precisaBackup(c: Crianca): boolean {
  const temAudio = c.gravacoes.some((g) => g.tomadas.length > 0);
  return temAudio && (c.mudou ?? c.criada) > (c.backup ?? 0);
}

function tomadasSemBackup(): number {
  let n = 0;
  for (const c of oficina.criancas) for (const g of c.gravacoes) for (const t of g.tomadas) if (t.criada > (c.backup ?? 0)) n++;
  return n;
}

/** Lembrete no topo: quantas gravações ainda não têm backup. */
function mostrarBackup(): void {
  const el = document.getElementById('estado-backup');
  if (!el) return;
  const n = tomadasSemBackup();
  const criancas = oficina.criancas.filter(precisaBackup).length;
  el.textContent = n > 0 ? `${n} gravação(ões) sem backup` : criancas > 0 ? `${criancas} criança(s) com mudanças sem backup` : 'Backup em dia ✓';
  el.dataset.estado = n >= 10 ? 'alerta' : n > 0 || criancas > 0 ? 'atencao' : 'ok';
}

/** Espaço usado no navegador e se ele está protegido contra limpeza automática. */
async function mostrarEspaco(): Promise<void> {
  const el = document.getElementById('estado-espaco');
  if (!el || !navigator.storage?.estimate) return;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const protegido = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const mb = (b: number) => b >= 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : Math.round(b / 1e6) + ' MB';
    el.textContent = `Usando ${mb(usage)} · cabe ${mb(Math.max(0, quota - usage))}`;
    el.title = protegido
      ? 'O Chrome marcou estas gravações como protegidas: ele não apaga sozinho, mesmo com o disco cheio.'
      : 'O Chrome ainda não protegeu os dados. Instale o estúdio como app (ícone na barra de endereço) e faça backups.';
    el.dataset.estado = !protegido || quota - usage < 500e6 ? 'atencao' : 'ok';
  } catch { /* sem informação de espaço */ }
}

interface PastaDeBackup {
  name: string;
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  getFileHandle(nome: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(d: Blob | BufferSource): Promise<void>; close(): Promise<void> }> }>;
}
type ComPasta = Window & { showDirectoryPicker?: (o: { mode: 'readwrite'; id?: string }) => Promise<PastaDeBackup> };

/**
 * Salvar tudo (backup):
 * - No Chrome: grava um ZIP por criança direto numa pasta (pendrive, HD externo...). A pasta fica
 *   lembrada: das outras vezes é só clicar. Cada criança é montada e gravada uma por vez, então a
 *   memória não enche, mesmo com muitas gravações.
 * - Em outros navegadores: baixa um ZIP só com tudo.
 */
async function salvarTudo(trocarPasta = false): Promise<void> {
  if (oficina.criancas.length === 0) return avisar('Ainda não tem nenhuma criança.', 'info');
  const w = window as ComPasta;
  if (!w.showDirectoryPicker) {
    avisar('Juntando as gravações...', 'info');
    baixar(await exportarTudoEmBlob(oficina.criancas), `oficina_meu_bairro_${data()}.zip`, 'application/zip');
    marcarBackupDeTodas();
    return avisar('Tudo salvo num ZIP. Guarde uma cópia em outro lugar (pendrive ou nuvem).', 'ok');
  }
  let pasta = trocarPasta ? undefined : await armazenamento.lerConfig<PastaDeBackup>('pasta_backup');
  if (pasta && (await pasta.queryPermission({ mode: 'readwrite' })) !== 'granted'
    && (await pasta.requestPermission({ mode: 'readwrite' }).catch(() => 'denied')) !== 'granted') pasta = undefined;
  if (!pasta) {
    try { pasta = await w.showDirectoryPicker({ mode: 'readwrite', id: 'backup-meu-bairro' }); } catch { return; }
    await armazenamento.salvarConfig('pasta_backup', pasta).catch(() => {});
  }
  const usados = new Set<string>();
  let feitas = 0;
  try {
    for (const c of oficina.criancas) {
      let nome = nomeDoZipDaCrianca(c).replace(/\.zip$/, '');
      const base = nome;
      for (let n = 2; usados.has(nome); n++) nome = `${base}_${n}`;
      usados.add(nome);
      if (!c.gravacoes.some((g) => g.tomadas.length)) continue;
      avisar(`Salvando ${c.apelido || 'criança'} (${++feitas})...`, 'info');
      const zip = await exportarCrianca(c);
      const arq = await (await pasta.getFileHandle(`${nome}.zip`, { create: true })).createWritable();
      await arq.write(new Blob([zip as BlobPart]));
      await arq.close();
      c.backup = Date.now();
    }
  } catch (e) {
    await armazenamento.salvarOficina(oficina).catch(() => {});
    mostrarBackup(); desenharLista();
    return avisar('O backup parou no meio: ' + String((e as Error).message ?? e) + '. Confira se o pendrive está conectado e tente de novo.', 'erro');
  }
  await armazenamento.salvarOficina(oficina).catch(() => {});
  mostrarBackup(); desenharLista();
  avisar(`Backup salvo na pasta "${pasta.name}": ${feitas} criança(s), um ZIP para cada.`, 'ok');
}

function marcarBackupDeTodas(): void {
  const agora = Date.now();
  for (const c of oficina.criancas) c.backup = agora;
  void armazenamento.salvarOficina(oficina).catch(() => {});
  mostrarBackup(); desenharLista();
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
    const agora = Date.now() + 1; // veio de um backup: já conta como salvo
    for (const c of criancas) c.backup = agora;
    await armazenamento.salvarOficina(oficina);
    mostrarBackup(); desenharLista();
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
  const ed = g ? editores.get(g.chave) : undefined;
  if (e.code === 'Space' && g) { e.preventDefault(); void alternarGravacao(g); }
  else if (e.key === 'Escape') pararSom();
  else if ((e.key === 'p' || e.key === 'P') && g) {
    if (ed) void tocarEditor(ed);
    else { const t = g.tomadas.find((x) => x.id === tomadaVista.get(g.chave)) ?? tomadaEscolhida(g); if (t) void ouvir(g, t.id); }
  }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && ed && selecoes.get(ed.tomada.id)) { e.preventDefault(); editar(ed, 'apagar'); }
  else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && ed) { e.preventDefault(); desfazer(ed); }
});

// ---------- Começo ----------

$('nova-crianca').addEventListener('click', () => void adicionarCrianca());
$('salvar-tudo').addEventListener('click', () => void salvarTudo());
$('importar').addEventListener('click', () => void importarZip());
$('ligar-microfone').addEventListener('click', () => void ligarMicrofone());
$('microfone').addEventListener('change', () => { if (gravador.ligado) void ligarMicrofone(); });
$('limpeza').addEventListener('change', () => {
  void armazenamento.salvarConfig('limpeza', $<HTMLInputElement>('limpeza').checked);
  if (gravador.ligado) void ligarMicrofone();
});
$('pasta-backup').addEventListener('click', () => void salvarTudo(true));
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
    $<HTMLInputElement>('limpeza').checked = (await armazenamento.lerConfig<boolean>('limpeza')) ?? true;
  } catch {
    avisar('O navegador não deixou guardar dados. As gravações podem se perder ao fechar.', 'erro');
  }
  selecionada = oficina.criancas.at(-1)?.chave ?? null;
  cartaoAtivo = criancaAtual()?.gravacoes[0]?.chave ?? null;
  await listarMicrofones();
  desenhar();
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
  mostrarBackup();
  void mostrarEspaco();
  setInterval(() => void mostrarEspaco(), 30000);
}
void comecar();

// Ganchos para os testes automáticos.
declare global { interface Window { __estudio: unknown } }
window.__estudio = {
  oficina: () => oficina,
  adicionar: (apelido: string) => { const c = novaCrianca(apelido); oficina.criancas.push(c); selecionada = c.chave; cartaoAtivo = c.gravacoes[0].chave; mudou(); return c.chave; },
  /** Para o teste de carga: põe uma tomada pronta (sem microfone). */
  async tomadaDeTeste(chaveCrianca: string, indiceGravacao: number, x: Float32Array) {
    const c = oficina.criancas.find((k) => k.chave === chaveCrianca)!;
    const g = c.gravacoes[indiceGravacao];
    const id = novaChave('t');
    await armazenamento.salvarAudio(id, x);
    const corte = acharFala(x);
    g.tomadas.push({ id, criada: Date.now(), duracao: x.length / TAXA, inicio: corte.inicio, fim: corte.fim, corteOriginal: corte });
    if (!g.favorita) g.favorita = id;
    mudou(false);
    await armazenamento.salvarOficina(oficina);
  },
  selecionar: (chave: string) => { selecionada = chave; cartaoAtivo = criancaAtual()?.gravacoes[0]?.chave ?? null; desenhar(); },
  editores: () => editores, selecoes, cursores, editar, desfazer, tocarEditor, exportarCrianca, salvarTudo, importar,
  memoria: () => ({ originais: cacheAudio.size, editados: cacheEditado.size }),
};
