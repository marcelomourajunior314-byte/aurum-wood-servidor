// Aurum Wood - Servidor Rifa v4.0
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));
app.options('*', cors());

const HANDLE        = 'aurumwood';
const TELEGRAM_USER = '@marcelomjunior';
const GIST_ID       = process.env.GIST_ID    || '2d866d61320ce44aea56e1f80658fd2e';
const GIST_USER     = 'marcelomourajunior314-byte';
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const RAILWAY_URL   = process.env.RAILWAY_URL || 'https://aurum-wood-servidor-production.up.railway.app';
const SITE_URL      = process.env.SITE_URL    || 'https://aurumwood.netlify.app';
const PORT          = process.env.PORT        || 3000;
const NUMS_SORTE    = [75, 80];
const processados   = new Set();

async function lerVendidos() {
  try {
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;
    const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers });
    if (!r.ok) { console.error('lerVendidos HTTP:', r.status, await r.text()); return []; }
    const data = await r.json();
    const raw = data.files?.['vendidos.json']?.content;
    const v = raw ? (JSON.parse(raw).vendidos || []) : [];
    console.log('Vendidos lidos:', v);
    return v;
  } catch (e) { console.error('lerVendidos:', e.message); return []; }
}

async function salvarVendidos(lista) {
  try {
    if (!GITHUB_TOKEN) { console.error('GITHUB_TOKEN ausente!'); return false; }
    const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { 'vendidos.json': { content: JSON.stringify({ vendidos: lista }) } } })
    });
    const ok = r.ok;
    console.log('Gist salvo:', ok, '| Status:', r.status, '| Lista:', lista);
    return ok;
  } catch (e) { console.error('salvarVendidos:', e.message); return false; }
}

async function notificarDono(msg) {
  // Tenta até 3 vezes com delay crescente
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const url = `https://api.callmebot.com/text.php?user=${TELEGRAM_USER}&text=${encodeURIComponent(msg)}`;
      const r = await fetch(url);
      const body = await r.text();
      console.log(`Telegram tentativa ${tentativa}: status=${r.status} body=${body.substring(0,50)}`);
      if (r.status === 200 && !body.includes('Too many')) {
        console.log('Telegram enviado com sucesso!');
        return;
      }
      // Rate limited - espera antes de tentar novamente
      console.log(`Rate limited, aguardando ${tentativa * 10}s...`);
      await new Promise(resolve => setTimeout(resolve, tentativa * 10000));
    } catch (e) {
      console.error(`Telegram tentativa ${tentativa} erro:`, e.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  console.log('Telegram: todas as tentativas falharam');
}

app.post('/criar-cobranca', async (req, res) => {
  try {
    const { nome, wpp, email, total, nums } = req.body;
    if (!nome || !total || !nums) return res.status(400).json({ erro: 'Dados incompletos' });

    const vendidos = await lerVendidos();
    const numArray = nums.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    const conflitos = numArray.filter(n => vendidos.includes(n));
    if (conflitos.length) return res.status(400).json({ erro: 'Numeros indisponiveis', numeros: conflitos });

    const cents = Math.round(parseFloat(total) * 100);
    const orderNsu = `rifa-${Date.now()}`;
    const redirect = `${SITE_URL}/obrigado.html?nome=${encodeURIComponent(nome)}&nums=${encodeURIComponent(nums)}&total=${encodeURIComponent(parseFloat(total).toFixed(2))}&order_nsu=${encodeURIComponent(orderNsu)}`;

    const payload = {
      handle: HANDLE,
      redirect_url: redirect,
      webhook_url: `${RAILWAY_URL}/webhook`,
      order_nsu: orderNsu,
      customer: { name: nome, ...(email ? { email } : {}) },
      items: [{ quantity: 1, price: cents, description: `Rifa Aurum Wood | Nos: ${nums} | Nome: ${nome} | WPP: ${wpp || ''}` }]
    };

    const r = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!r.ok || !data.url) { console.error('InfinitePay:', data); return res.status(500).json({ erro: 'Erro InfinitePay', detalhe: data }); }

    console.log(`Cobrança: ${orderNsu} | R$${total} | Nums: ${nums}`);
    res.json({ url: data.url, order_nsu: orderNsu });
  } catch (e) { console.error('criar-cobranca:', e); res.status(500).json({ erro: e.message }); }
});

app.post('/webhook', async (req, res) => {
  res.status(200).json({ success: true });
  try {
    console.log('Webhook:', JSON.stringify(req.body));
    const { order_nsu, amount, items } = req.body;
    if (!order_nsu) return;
    if (processados.has(order_nsu)) { console.log('Já processado:', order_nsu); return; }

    const desc = items?.[0]?.description || '';
    const nosM = desc.match(/Nos:\s*([0-9,\s]+?)(?:\s*\||$)/);
    const nomM = desc.match(/Nome:\s*([^|]+?)(?:\s*\||$)/);
    const wppM = desc.match(/WPP:\s*([^|]+?)(?:\s*\||$)/);
    const nums = nosM ? nosM[1].trim() : '';
    const nome = nomM ? nomM[1].trim() : 'Desconhecido';
    const wpp  = wppM ? wppM[1].trim() : '';
    const numArray = nums.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));

    console.log(`Extraído — Nome:${nome} Nums:${nums} WPP:${wpp}`);
    if (!numArray.length) { console.log('Nenhum número!'); return; }

    const vendidos = await lerVendidos();
    numArray.forEach(n => { if (!vendidos.includes(n)) vendidos.push(n); });
    vendidos.sort((a, b) => a - b);
    await salvarVendidos(vendidos);
    processados.add(order_nsu);

    const numsSorte = numArray.filter(n => NUMS_SORTE.includes(n));
    const valor = ((amount || 0) / 100).toFixed(2);
    const msg = numsSorte.length
      ? `⭐🚨 NÚMERO DA SORTE!\n👤${nome}\n📱${wpp}\n🔢${nums}\n💰R$${valor}\n🎁Premiados:${numsSorte.join(',')}\n💸ENVIAR PIX!`
      : `🎟️ NOVA VENDA!\n👤${nome}\n📱${wpp}\n🔢${nums}\n💰R$${valor}`;
    await notificarDono(msg);
  } catch (e) { console.error('webhook:', e); }
});

app.get('/vendidos', async (req, res) => {
  res.json({ vendidos: await lerVendidos() });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', versao: '4.0', token_ok: !!GITHUB_TOKEN, gist_id: GIST_ID });
});

app.listen(PORT, () => {
  console.log(`Aurum Wood v4.0 porta ${PORT} | Token: ${GITHUB_TOKEN ? 'OK' : 'AUSENTE'}`);
  lerVendidos();
});
