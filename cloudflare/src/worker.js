// Aurum Wood – Servidor Rifa v5.0 (Cloudflare Workers)
// Mesmas rotas do server.js (Railway): /criar-cobranca, /webhook, /vendidos, /config,
// /config-debug, /chat, /deploy-admin, /deploy-site e /.
// Dados continuam no mesmo GitHub Gist.

const VERSAO = '5.0-cloudflare';
const ARQUIVOS_COLECOES = { portfolio: 'portfolio.json', produtos: 'produtos.json', andamento: 'andamento.json' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });
const rawJson = (text, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });

// ---------------- Gist ----------------
function ghHeaders(env) {
  const h = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'aurum-wood-worker' };
  if (env.GITHUB_TOKEN) h['Authorization'] = `token ${env.GITHUB_TOKEN}`;
  return h;
}
async function buscarGist(env) {
  const r = await fetch(`https://api.github.com/gists/${env.GIST_ID}`, { headers: ghHeaders(env) });
  if (!r.ok) { console.error('buscarGist HTTP', r.status, await r.text().catch(() => '')); return null; }
  return r.json();
}
// Conteúdo completo de um arquivo do Gist (a API corta o "content" acima de ~1MB)
async function lerArquivoGist(env, gist, nome) {
  const f = gist?.files?.[nome];
  if (!f) return null;
  if (!f.truncated) return f.content ?? null;
  if (!f.raw_url) return null;
  const r = await fetch(f.raw_url, { headers: ghHeaders(env) });
  return r.ok ? r.text() : null;
}

// Monta o config SEM fazer JSON.parse do arquivo grande (economiza CPU no Worker):
// acrescenta as coleções no fim do objeto. Em JSON com chave repetida vale a última,
// exatamente como o merge que o server.js fazia.
async function configTexto(env, gist) {
  gist = gist || await buscarGist(env);
  if (!gist) return null;
  let base = await lerArquivoGist(env, gist, 'config-site.json');
  if (!base) return null;
  base = base.trim();
  const fim = base.lastIndexOf('}');
  if (fim < 0) return null;
  let extra = '';
  for (const [chave, arquivo] of Object.entries(ARQUIVOS_COLECOES)) {
    const raw = await lerArquivoGist(env, gist, arquivo);
    if (raw && raw.trim()) extra += `,${JSON.stringify(chave)}:${raw.trim()}`;
  }
  const corpo = base.slice(0, fim).trim();
  const vazio = corpo === '{';
  if (vazio && extra) extra = extra.slice(1);
  return corpo + extra + '}';
}

async function lerVendidos(env, gist) {
  try {
    gist = gist || await buscarGist(env);
    const raw = await lerArquivoGist(env, gist, 'vendidos.json');
    return raw ? (JSON.parse(raw).vendidos || []) : [];
  } catch (e) { console.error('lerVendidos', e.message); return []; }
}
async function salvarVendidos(env, lista) {
  if (!env.GITHUB_TOKEN) { console.error('GITHUB_TOKEN ausente'); return false; }
  const r = await fetch(`https://api.github.com/gists/${env.GIST_ID}`, {
    method: 'PATCH',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: { 'vendidos.json': { content: JSON.stringify({ vendidos: lista }) } } }),
  });
  console.log('Gist salvo', r.status, lista);
  return r.ok;
}

// Números da sorte sem fazer parse do config inteiro
function numerosSorte(env, cfgTexto) {
  const padrao = String(env.NUMS_SORTE || '75,80').split(',').map(n => parseInt(n)).filter(n => !isNaN(n));
  if (!cfgTexto) return padrao;
  const m = cfgTexto.match(/"rifas"\s*:\s*\[\s*\{[\s\S]*?"sorte"\s*:\s*\[([^\]]*)\]/);
  if (m) { const v = m[1].split(',').map(s => parseInt(s.replace(/["\s]/g, ''))).filter(n => !isNaN(n)); if (v.length) return v; }
  const s = cfgTexto.match(/"sorteItens"\s*:\s*\[([\s\S]*?)\]/);
  if (s) { const v = [...s[1].matchAll(/"numero"\s*:\s*"?(\d+)/g)].map(x => parseInt(x[1])); if (v.length) return v; }
  return padrao;
}

async function telegram(env, msg) {
  if (!env.TG_BOT_TOKEN) { console.error('TG_BOT_TOKEN ausente'); return; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text: msg }),
    });
    const d = await r.json();
    if (!d.ok) console.error('Telegram erro', JSON.stringify(d));
  } catch (e) { console.error('Telegram falhou', e.message); }
}

async function dispararHook(url) {
  if (!url) return { ok: true, msg: 'Nada a publicar: o site lê os dados direto do servidor.' };
  const r = await fetch(url, { method: 'POST' });
  return { ok: r.ok, status: r.status };
}

// ---------------- Rotas ----------------
async function criarCobranca(req, env, origin) {
  const { nome, wpp, email, total, nums } = await req.json().catch(() => ({}));
  if (!nome || !total || !nums) return json({ erro: 'Dados incompletos' }, 400);
  const vendidos = await lerVendidos(env);
  const numArray = String(nums).split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
  const conflitos = numArray.filter(n => vendidos.includes(n));
  if (conflitos.length) return json({ erro: 'Numeros indisponiveis', numeros: conflitos }, 400);

  const cents = Math.round(parseFloat(total) * 100);
  const orderNsu = `rifa-${Date.now()}`;
  const redirect = `${env.SITE_URL}/?nome=${encodeURIComponent(nome)}&nums=${encodeURIComponent(nums)}&total=${encodeURIComponent(parseFloat(total).toFixed(2))}&order_nsu=${encodeURIComponent(orderNsu)}`;
  const payload = {
    handle: env.HANDLE,
    redirect_url: redirect,
    webhook_url: `${origin}/webhook`,
    order_nsu: orderNsu,
    customer: { name: nome, ...(email ? { email } : {}) },
    items: [{ quantity: 1, price: cents, description: `Rifa Aurum Wood | Nos: ${nums} | Nome: ${nome} | WPP: ${wpp || ''}` }],
  };
  const r = await fetch('https://api.checkout.infinitepay.io/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.url) { console.error('InfinitePay', JSON.stringify(data)); return json({ erro: 'Erro InfinitePay', detalhe: data }, 500); }
  console.log(`Cobrança ${orderNsu} R$${total} Nums ${nums}`);
  return json({ url: data.url, order_nsu: orderNsu });
}

async function processarWebhook(body, env) {
  const { order_nsu, amount, items } = body || {};
  if (!order_nsu) return;
  const desc = items?.[0]?.description || '';
  const nums = (desc.match(/Nos:\s*([0-9,\s]+?)(?:\s*\||$)/)?.[1] || '').trim();
  const nome = (desc.match(/Nome:\s*([^|]+?)(?:\s*\||$)/)?.[1] || 'Desconhecido').trim();
  const wpp  = (desc.match(/WPP:\s*([^|]+?)(?:\s*\||$)/)?.[1] || '').trim();
  const numArray = nums.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
  if (!numArray.length) { console.log('Webhook sem números'); return; }

  const gist = await buscarGist(env);
  const vendidos = await lerVendidos(env, gist);
  // Se todos os números já estão vendidos, é reenvio do mesmo pagamento: não duplica aviso
  if (numArray.every(n => vendidos.includes(n))) { console.log('Já processado', order_nsu); return; }
  numArray.forEach(n => { if (!vendidos.includes(n)) vendidos.push(n); });
  vendidos.sort((a, b) => a - b);
  await salvarVendidos(env, vendidos);

  const cfg = await configTexto(env, gist).catch(() => null);
  const sorte = numerosSorte(env, cfg);
  const premiados = numArray.filter(n => sorte.includes(n));
  const valor = ((amount || 0) / 100).toFixed(2);
  const msg = premiados.length
    ? `⭐🚨 NÚMERO DA SORTE!\n👤${nome}\n📱${wpp}\n🔢${nums}\n💰R$${valor}\n🎁Premiados:${premiados.join(',')}\n💸ENVIAR PIX!`
    : `🎟️ NOVA VENDA!\n👤${nome}\n📱${wpp}\n🔢${nums}\n💰R$${valor}`;
  await telegram(env, msg);
  if (env.DEPLOY_HOOK_ADMIN) await dispararHook(env.DEPLOY_HOOK_ADMIN).catch(() => {});
}

async function configDebug(env) {
  const txt = await configTexto(env);
  if (!txt) return json({ ok: false, erro: 'config vazio ou ilegível' });
  const config = JSON.parse(txt);
  const resumo = {};
  for (const [k, v] of Object.entries(config)) {
    if (Array.isArray(v)) resumo[k] = { tipo: 'array', tamanho: v.length, chavesPrimeiroItem: v[0] && typeof v[0] === 'object' ? Object.keys(v[0]) : [] };
    else if (typeof v === 'string') resumo[k] = { tipo: 'string', tamanho: v.length, amostra: v.slice(0, 40) };
    else if (v && typeof v === 'object') resumo[k] = { tipo: 'object', chaves: Object.keys(v) };
    else resumo[k] = { tipo: typeof v, valor: v };
  }
  return json({ ok: true, debugVersion: VERSAO, tamanhoTotalJSON: txt.length, chaves: resumo });
}

async function chat(req) {
  const { apiKey, model, max_tokens, system, messages } = await req.json().catch(() => ({}));
  if (!apiKey) return json({ erro: 'API Key ausente' }, 400);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens, system, messages }),
  });
  return rawJson(await r.text(), r.status);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (p === '/' && req.method === 'GET')
        return json({ status: 'ok', versao: VERSAO, token_ok: !!env.GITHUB_TOKEN, telegram_ok: !!env.TG_BOT_TOKEN, gist_id: env.GIST_ID });
      if (p === '/vendidos' && req.method === 'GET') return json({ vendidos: await lerVendidos(env) });
      if (p === '/config' && req.method === 'GET') { const t = await configTexto(env); return t ? rawJson(t) : json({}); }
      if (p === '/config-debug' && req.method === 'GET') return configDebug(env);
      if (p === '/criar-cobranca' && req.method === 'POST') return criarCobranca(req, env, url.origin);
      if (p === '/webhook' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        console.log('Webhook', JSON.stringify(body));
        ctx.waitUntil(processarWebhook(body, env).catch(e => console.error('webhook', e.message)));
        return json({ success: true });
      }
      if (p === '/chat' && req.method === 'POST') return chat(req);
      if (p === '/deploy-admin' && req.method === 'POST') return json({ ...(await dispararHook(env.DEPLOY_HOOK_ADMIN)), msg: 'Deploy disparado' });
      if (p === '/deploy-site' && req.method === 'POST') return json(await dispararHook(env.DEPLOY_HOOK_SITE || env.DEPLOY_HOOK_ADMIN));
      return json({ erro: 'Rota não encontrada' }, 404);
    } catch (e) {
      console.error('erro', p, e.message);
      return json({ erro: e.message }, 500);
    }
  },
};
