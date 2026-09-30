// Restaurar um backup troca o catálogo inteiro da empresa, para todo mundo: só o dono (ou o
// administrador) pode, e com confirmação. A gravação é a de sempre (só o que difere do banco), e
// cada alteração fica no histórico.
document.getElementById('importFile').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  if(!podeGerenciarEquipe()){ toast('Só o dono da empresa (ou o administrador) restaura um backup.', 'err'); return; }
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const parsed = normalizeState(JSON.parse(reader.result));
      if(!parsed) throw new Error('formato inválido -- o arquivo precisa ter as listas de marketplaces e produtos');
      if(!confirm(`Restaurar este backup troca TODO o catálogo de "${empresa.nome}" pelo do arquivo (${parsed.products.length} produto(s), ${parsed.profiles.length} marketplace(s)), para todas as pessoas da empresa. O que não estiver no arquivo será excluído. Tudo fica registrado no histórico.\n\nContinuar?`)) return;
      aplicarDados(dadosDe(parsed));
      saveState();
      toast('Backup restaurado. Gravando no banco...', 'ok');
    }catch(err){
      toast(err.message, 'err', 'Não foi possível importar o backup');
    }
  };
  reader.readAsText(file);
});
