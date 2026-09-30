  // Conexão da EMPRESA com a conta dela no Mercado Livre. A aplicação do ML (Client ID e Secret) é
  // uma só para todas as empresas e fica configurada no servidor pelo administrador.
  const conexao = !st
    ? `<p class="sub">Não consegui falar com o servidor da integração agora.</p>
       <div class="form-actions"><button class="btn" id="mlRecarregarStatus">Tentar de novo</button></div>`
    : !st.configurado
    ? `<p class="sub">A integração ainda não foi configurada no servidor: falta cadastrar a aplicação do Mercado Livre. É o administrador quem faz, uma vez só, e vale para todas as empresas.</p>
       <ol class="steps" style="margin-top:8px;">
         <li>No Supabase, abra <b>Edge Functions → Secrets</b> e cadastre ${(st.faltando || ['ML_CLIENT_ID', 'ML_CLIENT_SECRET']).map(n=> '<code>' + esc(n) + '</code>').join(' e ')}, com o Client ID e o Client Secret da aplicação do Mercado Livre (o nome tem que ser exatamente esse).</li>
         <li>Na aplicação do Mercado Livre, cadastre a URL de retorno <code>${esc(st.redirect || '')}</code>.</li>
         <li>Clique em "Verificar de novo".</li>
       </ol>
       <div class="form-actions"><button class="btn" id="mlRecarregarStatus">Verificar de novo</button></div>`
    : `
      <div class="form-actions">
        <button class="btn primary" id="mlConectar" ${podeEditar ? '' : 'disabled title="Seu acesso é só de consulta"'}>${st.conectado ? 'Conectar outra conta' : 'Conectar ao Mercado Livre'}</button>
        <button class="btn" id="mlJaAutorizei">Já autorizei</button>
        ${st.conectado && podeEditar ? '<button class="btn danger" id="mlDesconectar">Desconectar</button>' : ''}
      </div>
      <p class="sub" style="margin:10px 0 0;">${st.conectado
        ? `<span class="pos">Conectado</span> na conta <b>${esc(st.apelido || st.userId)}</b>.`
        : 'Ainda não autorizado. Clique em Conectar, autorize na aba que abrir e volte aqui em "Já autorizei".'}</p>`;
