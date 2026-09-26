// Diagnóstico leve: mostra as chaves e tamanhos do config sem devolver
// o payload gigante (útil para confirmar se portfolio/produtos/imagens
// estão realmente salvos no Gist, sem depender de ferramentas que
// truncam JSON grande ao inspecionar).
app.get('/config-debug', async (req, res) => {
  try {
    const config = await lerConfig();
    if (!config) return res.json({ ok: false, erro: 'config vazio ou ilegível' });
    const resumo = {};
    for (const k of Object.keys(config)) {
      const v = config[k];
      if (Array.isArray(v)) {
        resumo[k] = { tipo: 'array', tamanho: v.length, chavesPrimeiroItem: v[0] ? Object.keys(v[0]) : [] };
        // Inspeção extra: se o primeiro item tiver um campo "fotos" ou "midias",
        // mostra o formato de cada entrada (string vs objeto) sem despejar o conteúdo.
        if (v[0]) {
          for (const campo of ['fotos', 'midias']) {
            const val = v[0][campo];
            if (val === undefined) continue;
            if (Array.isArray(val)) {
              resumo[k][`${campo}Formato`] = { tipoContainer: 'array', tamanho: val.length, itens: val.map(item => {
                if (typeof item === 'string') return { tipo: 'string', tamanho: item.length, amostra: item.slice(0, 30) };
                if (item && typeof item === 'object') return { tipo: 'object', chaves: Object.keys(item), amostra: JSON.stringify(item).slice(0, 60) };
                return { tipo: typeof item };
              })};
            } else if (typeof val === 'string') {
              resumo[k][`${campo}Formato`] = { tipoContainer: 'string', tamanho: val.length, amostra: val.slice(0, 60) };
            } else if (val && typeof val === 'object') {
              resumo[k][`${campo}Formato`] = { tipoContainer: 'object', chaves: Object.keys(val), amostra: JSON.stringify(val).slice(0, 100) };
            } else {
              resumo[k][`${campo}Formato`] = { tipoContainer: typeof val, valor: val };
            }
          }
        }
      } else if (typeof v === 'string') {
        resumo[k] = { tipo: 'string', tamanho: v.length, amostra: v.slice(0, 40) };
      } else if (typeof v === 'object' && v !== null) {
        resumo[k] = { tipo: 'object', chaves: Object.keys(v) };
      } else {
        resumo[k] = { tipo: typeof v, valor: v };
      }
    }
    res.json({ ok: true, tamanhoTotalJSON: JSON.stringify(config).length, chaves: resumo });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});
