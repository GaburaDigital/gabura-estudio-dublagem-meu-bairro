// Configuração do Vite. O "base" precisa ser o nome do repositório para funcionar no GitHub Pages.
// Depois do build, o sw.js recebe a lista de arquivos: assim o estúdio abre mesmo sem internet.
import { defineConfig, type Plugin } from 'vite';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SAIDA = 'docs';

function listaOffline(): Plugin {
  return {
    name: 'lista-offline',
    apply: 'build',
    closeBundle() {
      const todos: string[] = [];
      const andar = (d: string) => {
        for (const n of readdirSync(d)) {
          const c = join(d, n);
          if (statSync(c).isDirectory()) andar(c);
          else if (n !== 'sw.js') todos.push('./' + relative(SAIDA, c).replace(/\\/g, '/'));
        }
      };
      andar(SAIDA);
      todos.push('./');
      const versao = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
      const sw = readFileSync(join(SAIDA, 'sw.js'), 'utf8').replace('__VERSAO__', versao).replace('__ARQUIVOS__', JSON.stringify(todos, null, 2));
      writeFileSync(join(SAIDA, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  base: '/gabura-estudio-dublagem-meu-bairro/',
  define: {
    __VERSAO_APP__: JSON.stringify(new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', dateStyle: 'short', timeStyle: 'short' })),
  },
  plugins: [listaOffline()],
  build: { outDir: SAIDA, emptyOutDir: true },
});
