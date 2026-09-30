// Extrai do index.html (versão 1), SEM ALTERAR, as funções que leem e organizam os dados da
// planilha (normalizeState e tudo de que ela depende), e monta o módulo da v2 que a importação
// usa. Assim a importação enxerga exatamente os mesmos produtos que o cliente vê na v1.
const fs = require('fs');
const V1 = require('path').join(__dirname, '..', '..', 'index.html');
const SAIDA = require('path').join(__dirname, '..', 'js', 'v1-leitura.js');
const h = fs.readFileSync(V1, 'utf8');

// Na v1, todo bloco de primeiro nível termina com '}' (ou '};') sozinho no começo da linha.
// É mais seguro que contar chaves, que se perde em expressões regulares com aspas (ex.: /^'/).
function blocoApartirDe(marcador){
  const ini = h.indexOf('\n' + marcador);
  if(ini < 0) throw new Error('não achei ' + marcador);
  const resto = h.slice(ini + 1);
  // constante (objeto): vai até a primeira linha que termina em '};'
  if(marcador.startsWith('const ')){
    const linhas = resto.split('\n'), bloco = [];
    for(const l of linhas){ bloco.push(l); if(/\};\s*$/.test(l)) break; }
    return bloco.join('\n');
  }
  // função de uma linha só (ex.: novoId, toBool): o bloco é só essa linha
  const primeira = resto.split(/\r?\n/)[0];
  const abre = (primeira.match(/\{/g) || []).length, fecha = (primeira.match(/\}/g) || []).length;
  if(abre > 0 && abre === fecha) return primeira;
  const m = resto.match(/\n\};?(?=\r?\n)/);
  if(!m) throw new Error('não achei o fim de ' + marcador);
  return resto.slice(0, m.index + m[0].length);
}

const FUNCOES = ['toBool', 'novoId', 'slugDoRotulo', 'idsDosMarketplaces', 'skuBase', 'idPeloNome',
  'normalizeSku', 'normalizeProfile', 'normalizePadroes', 'normalizeListing', 'normalizeProduct',
  'agruparEmProdutos', 'defaultProfiles', 'normalizeState', 'visaoDoAnuncio'];
const partes = [blocoApartirDe('const PRESET_TIKTOK = '), blocoApartirDe('const MISSING_PROFILE = ')]
  .concat(FUNCOES.map(n => blocoApartirDe('function ' + n + '(')));

const modulo = `// ============================================================================
// Leitura dos dados da versão 1 -- GERADO a partir do index.html por extrair-v1.js.
// NÃO EDITE À MÃO: cópia literal das funções da v1 que transformam o que vem da planilha
// (linhas planas, textos 'TRUE', faixas em JSON) em produtos com seus anúncios. A
// importação usa exatamente a mesma regra que o cliente vê na v1.
// ============================================================================

${partes.join('\n\n')}

export { normalizeState, agruparEmProdutos, normalizeProfile, normalizeProduct, normalizeListing, skuBase,
  visaoDoAnuncio, MISSING_PROFILE };
`;
fs.writeFileSync(SAIDA, modulo);
console.log('v1-leitura.js gerado:', FUNCOES.length, 'funções + PRESET_TIKTOK,', modulo.split('\n').length, 'linhas');
