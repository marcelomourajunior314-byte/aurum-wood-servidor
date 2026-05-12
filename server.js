const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.options('*', cors());

const HANDLE = 'aurumwood';
const SITE_URL = process.env.SITE_URL || 'https://aurumwood.netlify.app';
const RAILWAY_URL = process.env.RAILWAY_URL || 'https://aurum-wood-servidor-production.up.railway.app';
const PORT = process.env.PORT || 3000;
const NUMEROS_SORTE = [75, 80];
const GIST_ID = process.env.GIST_ID || '2d866d61320ce44aea56e1f80658fd2e';
const GIST_USER = 'marcelomourajunior314-byte';

let processados = new Set();
let vendidosCache = [];

// ── LÊ VENDIDOS VIA API (sem cache) ──
async function lerVendidos() {
  const TOKEN = process.env.GITHUB_TOKEN;
  try {
    const headers = TOKEN ? { 'Authorization': 'token ' + TOKEN } : {};
    const r = await fetch('https://api.github.com/gists/' + GIST_ID, { headers });
    const data = await r.json();
    const content = data.files && data.files['vendidos.json'] && data.files['vendidos.json'].content;
    if (content) {
      const parsed = JSON.parse(content);
      vendidosCache = parsed.vendidos || [];
      console.log('Vendidos lidos via API:', vendidosCache);
      return vendidosCache;
    }
  } catch (err) { console.error('Erro lerVendidos:', err.message); }
  return vendidosCache;
}

// ── ESCREVE VENDIDOS VIA API ──
async function salvarVendidos(lista) {
  const TOKEN = process.env.GITHUB_TOKEN;
  if (!TOKEN) { console.log('GITHUB_TOKEN não configurado!'); return false; }
  try {
    const r = await fetch('https://api.github.com/gists/' + GIST_ID, {
      method: 'PATCH',
      headers: { 'Authorization': 'token ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { 'vendidos.json': { content: JSON.stringify({ vendidos: lista }) } } })
    });
    const ok = r.status === 200;
    console.log('Gist salvo! Status:', r.status, '| Lista:', lista);
    return ok;
  } catch (err) { console.error('Erro salvarVendidos:', err.message); return false; }
}

// ── NOTIFICA TELEGRAM ──
async function notificarTelegram(nome, wpp, nums, total, isSorte, numsSorte) {
  try {
    const user = '@marcelomjunior';
    let header = '🎟️ NOVA VENDA RIFA AURUM WOOD!';
    let extra = '';
    if (isSorte && numsSorte.length > 0) {
      header = '⭐🚨 NÚMERO DA SORTE VENDIDO! 🚨⭐';
      extra = '\n🎁 Premiados: ' + numsSorte.join(', ') + '\n💸 ENVIAR PIX AO CLIENTE!';
    }
    const valor = parseFloat(total/100).toFixed(2);
    const msg = encodeURIComponent(header + '\n\n👤 ' + nome + '\n📱 ' + wpp + '\n🔢 Números: ' + nums + '\n💰 R$ ' + valor + extra);
    const r = await fetch('https://api.callmebot.com/text.php?user=' + user + '&text=' + msg);
    console.log('Telegram status:', r.status);
  } catch (err) { console.error('Erro Telegram:', err.message); }
}

// ── CRIAR COBRANÇA ──
app.post('/criar-cobranca', async (req, res) => {
  try {
    const { nome, wpp, email, total, nums } = req.body;
    if (!nome || !total || !nums) return res.status(400).json({ erro: 'Dados incompletos' });

    const vendidosAtuais = await lerVendidos();
    const numArray = nums.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    const conflitos = numArray.filter(n => vendidosAtuais.includes(n));
    if (conflitos.length > 0) return res.status(400).json({ erro: 'Numeros indisponiveis', numeros: conflitos });

    const totalCents = Math.round(parseFloat(total) * 100);
    const orderNsu = 'rifa-' + Date.now();

    const redirectUrl = SITE_URL + '/obrigado.html'
      + '?nome=' + encodeURIComponent(nome)
      + '&nums=' + encodeURIComponent(nums)
      + '&total=' + encodeURIComponent(parseFloat(total).toFixed(2))
      + '&order_nsu=' + encodeURIComponent(orderNsu);

    const payload = {
      handle: HANDLE,
      redirect_url: redirectUrl,
      webhook_url: RAILWAY_URL + '/webhook',
      order_nsu: orderNsu,
      items: [{ quantity: 1, price: totalCents, description: 'Rifa Aurum Wood | Nos: ' + nums + ' | Nome: ' + nome + ' | WPP: ' + (wpp||'') }]
    };

    const r = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!r.ok || !data.url) { console.error('Erro InfinitePay:', data); return res.status(500).json({ erro: 'Erro InfinitePay', detalhe: data }); }

    console.log('Cobrança criada:', orderNsu, '| R$', parseFloat(total), '| Nums:', nums);
    res.json({ url: data.url, order_nsu: orderNsu });
  } catch (err) { console.error('Erro:', err); res.status(500).json({ erro: err.message }); }
});

// ── WEBHOOK ──
app.post('/webhook', async (req, res) => {
  res.status(200).json({ success: true, message: null });
  try {
    console.log('Webhook:', JSON.stringify(req.body));
    const { order_nsu, amount, items } = req.body;
    if (!order_nsu) return;
    if (processados.has(order_nsu)) { console.log('Já processado:', order_nsu); return; }

    let nums = '', nome = '', wpp = '', numArray = [];

    if (items && items[0] && items[0].description) {
      const desc = items[0].description;
      console.log('Description:', desc);
      const nosM = desc.match(/Nos:\s*([0-9,\s]+?)(?:\s*\||\s*$)/);
      if (nosM) { nums = nosM[1].trim(); numArray = nums.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)); }
      const nomM = desc.match(/Nome:\s*([^|]+?)(?:\s*\||\s*$)/);
      if (nomM) nome = nomM[1].trim();
      const wppM = desc.match(/WPP:\s*([^|]+?)(?:\s*\||\s*$)/);
      if (wppM) wpp = wppM[1].trim();
    }

    if (numArray.length === 0) { console.log('Nenhum número no webhook!'); return; }

    // Lê vendidos ATUAIS via API (sem cache)
    const vendidosAtuais = await lerVendidos();
    numArray.forEach(n => { if (!vendidosAtuais.includes(n)) vendidosAtuais.push(n); });
    vendidosAtuais.sort((a, b) => a - b);
    vendidosCache = vendidosAtuais;

    // Salva via API
    const saved = await salvarVendidos(vendidosAtuais);
    console.log('PAGO!', nome, '| Nums:', nums, '| Gist salvo:', saved, '| Total vendidos:', vendidosAtuais);

    processados.add(order_nsu);

    const numsSorte = numArray.filter(n => NUMEROS_SORTE.includes(n));
    await notificarTelegram(nome, wpp, nums, amount || 0, numsSorte.length > 0, numsSorte);

  } catch (err) { console.error('Erro webhook:', err); }
});

// ── VENDIDOS — lê via API para garantir dados frescos ──
app.get('/vendidos', async (req, res) => {
  const v = await lerVendidos();
  res.json({ vendidos: v });
});

// ── HEALTH ──
app.get('/', (req, res) => {
  res.json({ status: 'ok', vendidos: vendidosCache.length, processados: processados.size, gist_id: GIST_ID });
});

app.listen(PORT, () => {
  console.log('Servidor Aurum Wood porta', PORT);
  lerVendidos().then(v => console.log('Vendidos iniciais:', v));
});
