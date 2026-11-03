// Guarda tudo no próprio navegador (IndexedDB): funciona sem internet e aguenta áudio.
// Cada tomada é salva assim que a gravação para. Para levar a outro computador, use "Salvar tudo".
// (Baseado no Estúdio de Dublagem Gabura.)
import type { Oficina } from './modelo';

const NOME_BANCO = 'gabura_estudio_meu_bairro';

let bancoAberto: Promise<IDBDatabase> | null = null;

function banco(): Promise<IDBDatabase> {
  if (!bancoAberto) {
    bancoAberto = new Promise((ok, erro) => {
      const req = indexedDB.open(NOME_BANCO, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('oficina')) db.createObjectStore('oficina');
        if (!db.objectStoreNames.contains('audios')) db.createObjectStore('audios');
        if (!db.objectStoreNames.contains('config')) db.createObjectStore('config');
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => erro(req.error);
    });
  }
  return bancoAberto;
}

function pedir<T>(loja: string, modo: IDBTransactionMode, acao: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return banco().then((db) => new Promise<T>((ok, erro) => {
    const tx = db.transaction(loja, modo);
    const req = acao(tx.objectStore(loja));
    tx.oncomplete = () => ok(req.result as T);
    tx.onerror = () => erro(tx.error);
    tx.onabort = () => erro(tx.error ?? new Error('Não foi possível salvar (o disco pode estar cheio).'));
  }));
}

export const armazenamento = {
  salvarOficina: (o: Oficina) => pedir<IDBValidKey>('oficina', 'readwrite', (s) => s.put(structuredClone(o), 'atual')),
  lerOficina: () => pedir<Oficina | undefined>('oficina', 'readonly', (s) => s.get('atual')),

  salvarAudio: (id: string, x: Float32Array) => pedir<IDBValidKey>('audios', 'readwrite', (s) => s.put(x.slice().buffer, id)),
  async lerAudio(id: string): Promise<Float32Array | null> {
    const b = await pedir<ArrayBuffer | undefined>('audios', 'readonly', (s) => s.get(id));
    return b ? new Float32Array(b) : null;
  },
  apagarAudio: (id: string) => pedir<undefined>('audios', 'readwrite', (s) => s.delete(id)),
  listarAudios: () => pedir<IDBValidKey[]>('audios', 'readonly', (s) => s.getAllKeys()),

  salvarConfig: (chave: string, valor: unknown) => pedir<IDBValidKey>('config', 'readwrite', (s) => s.put(valor, chave)),
  lerConfig: <T>(chave: string) => pedir<T | undefined>('config', 'readonly', (s) => s.get(chave)),
};
