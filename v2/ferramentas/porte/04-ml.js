// ---------- conversa com o servidor da integração (Edge Function "precificacao-ml") ----------
// A autorização de cada empresa e a senha da aplicação do Mercado Livre ficam no servidor, nunca
// nesta página. Os pedidos têm o mesmo formato da v1 ("ml=itens&offset=0&limit=50") e as
// respostas também: por isso o resto da integração (vínculos, taxas, envio, conferência,
// correção) é o mesmo código da v1.
async function mlChamar(params){
  if(!empresa) throw new Error('Abra uma empresa primeiro.');
  const corpo = {empresa_id: empresa.id};
  new URLSearchParams(params).forEach((v, k)=>{ corpo[k] = v; });
  const d = await V2.chamarML(corpo);
  if(d && d.erroML) throw new Error(d.erroML);
  if(d && d.ok === false) throw new Error(d.error || d.erro || 'O servidor da integração devolveu um erro.');
  if(!d || d.ok === undefined) throw new Error('O servidor da integração respondeu sem entender o pedido.');
  return d;
}
// avisar = a pessoa clicou (Verificar de novo / Já autorizei): diz o que encontrou, para o clique
// nunca parecer "sem efeito" quando a resposta é a mesma de antes.
async function mlAtualizarStatus(avisar){
  const botoes = [...document.querySelectorAll('#mlRecarregarStatus, #mlJaAutorizei')];
  botoes.forEach(b=>{ b.disabled = true; b.dataset.texto = b.textContent; b.textContent = 'Verificando...'; });
  try{
    mlEstado.status = await mlChamar('ml=status');
    const s = mlEstado.status;
    if(avisar){
      if(!s.configurado) toast('O servidor ainda não tem ' + (s.faltando || []).join(' e ') + '. Cadastre em Supabase → Edge Functions → Secrets e clique em "Verificar de novo".', 'warn', 'Mercado Livre');
      else if(s.conectado) toast('Conectado na conta ' + (s.apelido || s.userId) + '.', 'ok', 'Mercado Livre');
      else toast('Aplicação configurada. Agora clique em "Conectar ao Mercado Livre".', 'ok', 'Mercado Livre');
    }
  }catch(err){
    mlEstado.status = null;
    if(avisar) toast(err.message, 'err', 'Mercado Livre');
  }
  renderML();
}

// ---------- ações ----------
async function mlConectar(){
  try{
    const d = await mlChamar('ml=auth');
    window.open(d.url, '_blank', 'noopener');
    toast('Autorize na aba que abriu. Quando ela disser que deu certo, volte para cá e clique em "Já autorizei".', 'ok', 'Mercado Livre');
  }catch(err){ toast(err.message, 'err', 'Mercado Livre'); }
}
async function mlDesconectar(){
  if(!confirm('Desconectar esta empresa da conta do Mercado Livre? Os vínculos e as taxas já puxadas continuam aqui.')) return;
  try{ await mlChamar('ml=desconectar'); toast('Desconectado.', 'ok'); await mlAtualizarStatus(); }
  catch(err){ toast(err.message, 'err', 'Mercado Livre'); }
}
