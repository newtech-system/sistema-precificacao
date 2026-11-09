// ============================================================================
// Releitura automática: a regra de uma "fatia" de vínculos, sem nada de Deno nem de rede aqui
// dentro (quem fala com o Mercado Livre é passado de fora), para poder ser testada em qualquer lugar.
//
// Para cada vínculo: relê o envio (o ML devolve também a categoria e o tipo de HOJE), depois as
// taxas dessa categoria e tipo, e monta a linha que o banco grava (srv_aplicar_releitura). O banco
// só grava o que mudou.
// ============================================================================

export type Fontes = {
  frete(chaves: string[]): Promise<{ frete: Record<string, any>; faltou: string[] }>;
  taxas(chaves: string[]): Promise<{ taxas: Record<string, any>; faltou: string[] }>;
};

export const chaveDoItem = (l: any) => String(l.item_id) + (l.variacao_id ? ':' + l.variacao_id : '');

// Faixa vigente num preço: a última cuja entrada já passou (a primeira, se o preço é menor que todas).
// É a mesma conta da tela (freteNoPreco e a escolha da faixa de taxa).
function faixaNoPreco(faixas: any[], preco: number) {
  let achada = faixas[0];
  faixas.forEach((f) => { if (preco >= Number(f.min)) achada = f; });
  return achada;
}

// Preço em que o "retrato" (ml_pct, ml_fixo, ml_frete) é tirado: o do anúncio, se ele tem preço
// próprio; senão o que o ML mostra. (A tela usa o preço calculado pela margem; o retrato não entra
// em nenhuma conta, só acompanha o cadastro.)
export function precoDoRetrato(l: any, fr: any): number {
  if (l.modo === 'preco' && Number(l.preco_anuncio) > 0) return Number(l.preco_anuncio);
  return Number(l.preco_ml) || Number(fr && fr.precoML) || 0;
}

export function montarLinha(l: any, fr: any, faixasTaxa: any[]) {
  const p = precoDoRetrato(l, fr);
  const ft = faixaNoPreco(faixasTaxa, p);
  const envio = (fr.faixas || []).map((f: any) =>
    f.combinar ? { min: Number(f.min) || 0, custo: Number(f.custo) || 0, combinar: true }
               : { min: Number(f.min) || 0, custo: Number(f.custo) || 0 });
  const fe = envio.length ? faixaNoPreco(envio, p) : null;
  return {
    anuncio_id: l.anuncio_id,
    categoria: fr.categoria || l.categoria || '',
    tipo: fr.tipo || l.tipo || '',
    situacao: fr.situacao || l.situacao || '',
    faixas_taxa: faixasTaxa.map((f: any) => ({ min: Number(f.min) || 0, pct: Number(f.pct) || 0, fixo: Number(f.fixo) || 0 })),
    faixas_envio: envio,
    frete_gratis: !!fr.gratis,
    logistica: fr.logistica || '',
    envio_outra_opcao: Number(fr.outra) || 0,
    ml_pct: ft ? Number(ft.pct) || 0 : 0,
    ml_fixo: ft ? Number(ft.fixo) || 0 : 0,
    ml_frete: fe ? fe.custo : 0,
  };
}

export type Resultado = {
  aplicar: any[];        // linhas para o banco comparar e gravar
  processadas: number;   // quantas linhas, do começo, terminaram (o cursor anda até a última delas)
  erros: number;
  ultimoErro: string;
  cache: Record<string, any>;
  porLinha: { anuncio_id: string; chave: string; erro?: string }[];
};

// Relê uma fatia. Se o ML não responder a tempo para alguma linha ("faltou"), a fatia termina antes
// dela: ela volta na próxima chamada, e nada depois dela é gravado fora de ordem.
export async function relerFatia(linhas: any[], cacheDeEntrada: Record<string, any>, f: Fontes): Promise<Resultado> {
  const cache: Record<string, any> = { ...(cacheDeEntrada || {}) };
  const chaves = linhas.map(chaveDoItem);
  const fretes: Record<string, any> = {};
  let limite = linhas.length;   // linhas [0, limite) terminam nesta chamada

  // 1) o envio, de 4 em 4
  for (let i = 0; i < linhas.length && limite === linhas.length; i += 4) {
    const grupo = chaves.slice(i, i + 4);
    const r = await f.frete([...new Set(grupo)]);
    Object.assign(fretes, r.frete || {});
    const faltou = new Set(r.faltou || []);
    if (faltou.size) {
      const j = grupo.findIndex((c) => faltou.has(c) || !fretes[c]);
      if (j >= 0) limite = i + j;
    } else {
      const j = grupo.findIndex((c) => !fretes[c]);   // resposta sem a chave: trata como não respondida
      if (j >= 0) limite = i + j;
    }
  }

  // 2) as taxas das categorias que ainda não estão no cache desta volta, de 6 em 6
  const precisam: string[] = [];
  for (let i = 0; i < limite; i++) {
    const fr = fretes[chaves[i]];
    if (!fr || fr.erro) continue;
    const k = (fr.categoria || linhas[i].categoria) + '|' + (fr.tipo || linhas[i].tipo);
    if (k !== '|' && !cache[k] && !precisam.includes(k)) precisam.push(k);
  }
  for (let i = 0; i < precisam.length; i += 6) {
    const grupo = precisam.slice(i, i + 6);
    const r = await f.taxas(grupo);
    Object.entries(r.taxas || {}).forEach(([k, v]) => { cache[k] = v; });
  }
  // linha cuja categoria não deu para consultar agora (faltou tempo): termina a fatia antes dela
  for (let i = 0; i < limite; i++) {
    const fr = fretes[chaves[i]];
    if (!fr || fr.erro) continue;
    const k = (fr.categoria || linhas[i].categoria) + '|' + (fr.tipo || linhas[i].tipo);
    if (k !== '|' && !cache[k]) { limite = i; break; }
  }

  // 3) monta as linhas
  const aplicar: any[] = [];
  const porLinha: Resultado['porLinha'] = [];
  let erros = 0, ultimoErro = '';
  for (let i = 0; i < limite; i++) {
    const l = linhas[i], fr = fretes[chaves[i]];
    const k = fr && !fr.erro ? (fr.categoria || l.categoria) + '|' + (fr.tipo || l.tipo) : '';
    const tx = k ? cache[k] : null;
    if (!fr || fr.erro) { erros++; ultimoErro = fr && fr.erro ? String(fr.erro) : 'sem resposta do ML'; porLinha.push({ anuncio_id: l.anuncio_id, chave: chaves[i], erro: ultimoErro }); continue; }
    if (!tx || tx.erro || !tx.faixas || !tx.faixas.length) {
      erros++; ultimoErro = tx && tx.erro ? String(tx.erro) : 'o ML não devolveu as taxas da categoria';
      porLinha.push({ anuncio_id: l.anuncio_id, chave: chaves[i], erro: ultimoErro }); continue;
    }
    aplicar.push(montarLinha(l, fr, tx.faixas));
    porLinha.push({ anuncio_id: l.anuncio_id, chave: chaves[i] });
  }
  return { aplicar, processadas: limite, erros, ultimoErro, cache, porLinha };
}

// Só para a simulação: o que mudaria numa linha, comparando com o que está gravado.
const canon = (v: any): any => Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
  : typeof v === 'number' ? Number(v) : v;
export const igual = (a: any, b: any) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
export function diferencas(atual: any, nova: any) {
  const d: Record<string, { antes: any; depois: any }> = {};
  for (const k of ['categoria', 'tipo', 'situacao', 'faixas_taxa', 'faixas_envio', 'frete_gratis', 'logistica', 'envio_outra_opcao']) {
    if (!igual(atual[k], nova[k])) d[k] = { antes: atual[k], depois: nova[k] };
  }
  return d;
}
