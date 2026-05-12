// Aurum Wood - Servidor Rifa v3.0
// Deploy forçado: 2026-05-12
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));
app.options('*', cors());

// ── CONSTANTES ──
const HANDLE        = 'aurumwood';
const WPP_DONO      = '5547991498489';
const TELEGRAM_USER = '@marcelomjunior';
const GIST_ID       = '2d866d61320ce44aea56e1f80658fd2e';
const GIST_USER     = 'marcelomourajunior314-byte';
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN  || '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';
const RAILWAY_URL   = process.env.RAILWAY_URL   || 'https://aurum-wood-servidor-production.up.railway.app';
const SITE_URL      = process.env.SITE_URL      || 'https://aurumwood.netlify.app';
const PORT          = process.env.PORT          || 3000;
const NUMS_SORTE    = [75, 80];

// ── ESTADO ──
const processados = new Set();

// ── GIST: LER ──
async function lerVendidos() {
  try {
    const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!r.ok) { console.error('lerVendidos HTTP:', r.status); return []; }
    const data = await r.json();
    const raw = data.files?.['vendidos.json']?.content;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    console.log('Vendidos lidos:', parsed.vendidos);
    return parsed.vendidos || [];
  } catch (e) { console.error('lerVendidos erro:', e.message); return []; }
}

// ── GIST: SALVAR ──
async function salvarVendidos(lista) {
  try {
    const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { 'vendidos.json': { content: JSON.stringify({ vendidos: lista }) } } })
    });
    console.log('Gist salvo! Status:', r.status, '| Lista:', lista);
    return r.ok;
  } catch (e) { console.error('salvarVendidos erro:', e.message); return false; }
}

// ── TELEGRAM ──
async function telegram(msg) {
  try {
    const url = `https://api.callmebot.com/text.php?user=${TELEGRAM_USER}&text=${encodeURIComponent(msg)}`;
    const r = await fetch(url);
    console.log('Telegram status:', r.status);
  } catch (e) { console.error('Telegram erro:', e.message); }
}

// ── POST /criar-cobranca ──
app.post('/criar-cobranca', async (req, res) => {
  try {
    const { nome, wpp, email, total, nums } = req.body;
    if (!nome || !total || !nums) return res.status(400).json({ erro: 'Dados incompletos' });

    const vendidos    = await lerVendidos();
    const numArray    = nums.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    const conflitos   = numArray.filter(n => vendidos.includes(n));
    if (conflitos.length) return res.status(400).json({ erro: 'Numeros indisponiveis', numeros: conflitos });

    const cents    = Math.round(parseFloat(total) * 100);
    const orderNsu = `rifa-${Date.now()}`;
    const redirect = `${SITE_URL}/obrigado.html?nome=${encodeURIComponent(nome)}&nums=${encodeURIComponent(nums)}&total=${encodeURIComponent(parseFloat(total).toFixed(2))}&order_nsu=${encodeURIComponent(orderNsu)}`;

    // Monta payload COM dados do cliente para pré-preencher o checkout
    const payload = {
      handle: HANDLE,
      redirect_url: redirect,
      webhook_url: `${RAILWAY_URL}/webhook`,
      order_nsu: orderNsu,
      customer: {
        name: nome,
        ...(email ? { email } : {})
      },
      items: [{
        quantity: 1,
        price: cents,
        description: `Rifa Aurum Wood | Nos: ${nums} | Nome: ${nome} | WPP: ${wpp || ''}`
      }]
    };

    const r = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();

    if (!r.ok || !data.url) {
      console.error('InfinitePay erro:', JSON.stringify(data));
      return res.status(500).json({ erro: 'Erro InfinitePay', detalhe: data });
    }

    console.log(`Cobrança: ${orderNsu} | R$${total} | Nums: ${nums}`);
    res.json({ url: data.url, order_nsu: orderNsu });

  } catch (e) { console.error('criar-cobranca erro:', e); res.status(500).json({ erro: e.message }); }
});

// ── POST /webhook ──
app.post('/webhook', async (req, res) => {
  res.status(200).json({ success: true });
  try {
    console.log('Webhook raw:', JSON.stringify(req.body));
    const { order_nsu, amount, items } = req.body;
    if (!order_nsu) return;
    if (processados.has(order_nsu)) { console.log('Já processado:', order_nsu); return; }

    // Extrai dados da descrição
    const desc     = items?.[0]?.description || '';
    const nosM     = desc.match(/Nos:\s*([0-9,\s]+?)(?:\s*\||$)/);
    const nomeM    = desc.match(/Nome:\s*([^|]+?)(?:\s*\||$)/);
    const wppM     = desc.match(/WPP:\s*([^|]+?)(?:\s*\||$)/);
    const nums     = nosM ? nosM[1].trim() : '';
    const nome     = nomeM ? nomeM[1].trim() : 'Desconhecido';
    const wpp      = wppM ? wppM[1].trim() : '';
    const numArray = nums.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));

    console.log(`Extraído — Nome: ${nome} | Nums: ${nums} | WPP: ${wpp}`);

    if (!numArray.length) { console.log('Nenhum número extraído!'); return; }

    // Lê, atualiza e salva
    const vendidos = await lerVendidos();
    numArray.forEach(n => { if (!vendidos.includes(n)) vendidos.push(n); });
    vendidos.sort((a, b) => a - b);
    const salvo = await salvarVendidos(vendidos);

    processados.add(order_nsu);
    console.log(`PAGO! ${nome} | Nums: ${nums} | Gist: ${salvo} | Total: ${vendidos}`);

    // Telegram
    const numsSorte = numArray.filter(n => NUMS_SORTE.includes(n));
    const isSorte   = numsSorte.length > 0;
    const valor     = ((amount || 0) / 100).toFixed(2);
    const msg = isSorte
      ? `⭐🚨 NÚMERO DA SORTE VENDIDO!\n\n👤 ${nome}\n📱 ${wpp}\n🔢 Nums: ${nums}\n💰 R$ ${valor}\n🎁 Premiados: ${numsSorte.join(', ')}\n💸 ENVIAR PIX!`
      : `🎟️ NOVA VENDA RIFA!\n\n👤 ${nome}\n📱 ${wpp}\n🔢 Nums: ${nums}\n💰 R$ ${valor}`;
    await telegram(msg);

  } catch (e) { console.error('webhook erro:', e); }
});

// ── GET /vendidos ──
app.get('/vendidos', async (req, res) => {
  const v = await lerVendidos();
  res.json({ vendidos: v });
});

// ── GET / ──
app.get('/', (req, res) => {
  res.json({ status: 'ok', versao: '3.0', gist_id: GIST_ID, processados: processados.size });
});

app.listen(PORT, () => {
  console.log(`Aurum Wood v3.0 porta ${PORT}`);
  lerVendidos();
});
