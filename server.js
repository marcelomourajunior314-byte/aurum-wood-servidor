// Aurum Wood - Servidor Rifa v4.2
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));
app.options('*', cors());

const HANDLE         = 'aurumwood';
const TG_BOT_TOKEN   = '8619359220:AAGTv3qeAkUuwhS8WMv-UnR3MTHNDUshLlc';
const TG_CHAT_ID     = '8782621401';
const GIST_ID        = process.env.GIST_ID        || '2d866d61320ce44aea56e1f80658fd2e';
const GIST_USER      = 'marcelomourajunior314-byte';
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const NETLIFY_TOKEN  = process.env.NETLIFY_TOKEN;
const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID;
const RAILWAY_URL    = process.env.RAILWAY_URL    || 'https://aurum-wood-servidor-production.up.railway.app';
const SITE_URL       = process.env.SITE_URL       || 'https://aurumwood.netlify.app';
const PORT           = process.env.PORT           || 3000;
const NUMS_SORTE     = [75, 80];
const processados    = new Set();

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
  try {
    const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg })
    });
    const data = await r.json();
    if (data.ok) {
      console.log('Telegram enviado! message_id:', data.result.message_id);
    } else {
      console.error('Telegram erro:', JSON.stringify(data));
    }
  } catch (e) {
    console.error('Telegram falhou:', e.message);
  }
}

async function publicarNetlify() {
  if (!NETLIFY_TOKEN || !NETLIFY_SITE_ID) {
    console.log('Netlify: token ou site_id ausente, pulando deploy.');
    return;
  }
  try {
    const r = await fetch(`https://api.netlify.com/api/v1/sites/${NETLIFY_SITE_ID}/deploys`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NETLIFY_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ clear_cache: true })
    });
    const data = await r.json();
    if (r.ok) {
      console.log('Netlify deploy disparado! Deploy ID:', data.id, '| Estado:', data.state);
    } else {
      console.error('Netlify deploy erro:', JSON.stringify(data));
    }
  } catch (e) {
    console.error('Netlify deploy falhou:', e.message);
  }
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

    // Notifica Telegram
    const numsSorte = numArray.filter(n => NUMS_SORTE.includes(n));
    const valor = ((amount || 0) / 100).toFixed(2);
    const msg = numsSorte.length
      ? `⭐🚨 NÚMERO DA SORTE!\n👤${nome}\n📱${wpp}\n🔢${nums}\n💰R$${valor}\n🎁Premiados:${numsSorte.join(',')}\n💸ENVIAR PIX!`
      : `🎟️ NOVA VENDA!\n👤${nome}\n📱${wpp}\n🔢${nums}\n💰R$${valor}`;
    await notificarDono(msg);

    // Publica app admin no Netlify automaticamente
    await publicarNetlify();

  } catch (e) { console.error('webhook:', e); }
});

app.get('/vendidos', async (req, res) => {
  res.json({ vendidos: await lerVendidos() });
});

// Proxy para API da Anthropic (evita bloqueio CORS no browser)
app.post('/chat', async (req, res) => {
  try {
    const { apiKey, model, max_tokens, system, messages } = req.body;
    if (!apiKey) return res.status(400).json({ erro: 'API Key ausente' });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model, max_tokens, system, messages })
    });

    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    console.error('chat proxy:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// Endpoint manual para forçar deploy no Netlify (útil para testes)
app.post('/deploy-admin', async (req, res) => {
  console.log('Deploy manual solicitado');
  await publicarNetlify();
  res.json({ ok: true, msg: 'Deploy disparado' });
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    versao: '4.3',
    token_ok: !!GITHUB_TOKEN,
    netlify_ok: !!(NETLIFY_TOKEN && NETLIFY_SITE_ID),
    gist_id: GIST_ID
  });
});

app.listen(PORT, () => {
  console.log(`Aurum Wood v4.3 porta ${PORT} | GH Token: ${GITHUB_TOKEN ? 'OK' : 'AUSENTE'} | Netlify: ${NETLIFY_TOKEN ? 'OK' : 'AUSENTE'}`);
  lerVendidos();
});
