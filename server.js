const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());

const HANDLE = 'aurumwood';
const SITE_URL = process.env.SITE_URL || 'https://aurumwood.netlify.app';
const RAILWAY_URL = process.env.RAILWAY_URL || 'https://aurum-wood-servidor-production.up.railway.app';
const PORT = process.env.PORT || 3000;
const NUMEROS_SORTE = [75, 80];

// Vendidos persistidos no Gist (fonte de verdade)
// Pedidos em memória (só para evitar dupla contagem na sessão)
let processados = new Set();
let vendidosCache = [];

// ── ATUALIZA GIST ──
async function atualizarGist(lista) {
  const GIST_ID = process.env.GIST_ID || '2d866d61320ce44aea56e1f80658fd2e';
  const TOKEN = process.env.GITHUB_TOKEN;
  if (!TOKEN) { console.log('GITHUB_TOKEN não configurado!'); return; }
  try {
    const r = await fetch('https://api.github.com/gists/' + GIST_ID, {
      method: 'PATCH',
      headers: { 'Authorization': 'token ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { 'vendidos.json': { content: JSON.stringify({ vendidos: lista }) } } })
    });
    console.log('Gist atualizado! Status:', r.status, '| Vendidos:', lista);
  } catch (err) { console.error('Erro Gist:', err.message); }
}

// ── BUSCA VENDIDOS DO GIST ──
async function buscarVendidos() {
  const GIST_ID = process.env.GIST_ID || '2d866d61320ce44aea56e1f80658fd2e';
  const USER = 'marcelomourajunior314-byte';
  try {
    const r = await fetch(`https://gist.githubusercontent.com/${USER}/${GIST_ID}/raw/vendidos.json?t=${Date.now()}`);
    const data = await r.json();
    vendidosCache = data.vendidos || [];
    return vendidosCache;
  } catch (err) {
    console.error('Erro ao buscar vendidos:', err.message);
    return vendidosCache;
  }
}

// ── NOTIFICA TELEGRAM ──
async function notificarTelegram(nome, wpp, nums, total, isSorte, numsSorte) {
  try {
    const telegramUser = '@marcelomjunior';
    let header = '🎟️ NOVA VENDA RIFA AURUM WOOD!';
    let extra = '';
    if (isSorte && numsSorte.length > 0) {
      header = '⭐🚨 NÚMERO DA SORTE VENDIDO! 🚨⭐';
      extra = '\n🎁 Premiados: ' + numsSorte.join(', ') + '\n💸 ENVIAR PIX AO CLIENTE!';
    }
    const msg = encodeURIComponent(
      header + '\n\n' +
      '👤 ' + nome + '\n📱 ' + wpp + '\n🔢 Números: ' + nums +
      '\n💰 R$ ' + parseFloat(total/100).toFixed(2) + extra
    );
    const url = 'https://api.callmebot.com/text.php?user=' + telegramUser + '&text=' + msg;
    const r = await fetch(url);
    console.log('Telegram enviado! Status:', r.status);
  } catch (err) { console.error('Erro Telegram:', err.message); }
}

// ── CRIAR COBRANÇA ──
app.post('/criar-cobranca', async (req, res) => {
  try {
    const { nome, wpp, email, total, nums } = req.body;
    if (!nome || !total || !nums) return res.status(400).json({ erro: 'Dados incompletos' });

    // Busca vendidos atuais do Gist
    const vendidosAtuais = await buscarVendidos();
    const numArray = nums.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    const conflitos = numArray.filter(n => vendidosAtuais.includes(n));
    if (conflitos.length > 0) {
      return res.status(400).json({ erro: 'Numeros indisponiveis', numeros: conflitos });
    }

    const totalNum = parseFloat(total);
    const totalCents = Math.round(totalNum * 100);
    const orderNsu = 'rifa-' + Date.now();

    const redirectUrl = SITE_URL + '/obrigado.html'
      + '?nome=' + encodeURIComponent(nome)
      + '&nums=' + encodeURIComponent(nums)
      + '&total=' + encodeURIComponent(totalNum.toFixed(2))
      + '&order_nsu=' + encodeURIComponent(orderNsu);

    // Payload SEM phone_number para evitar verificação por código
    const payload = {
      handle: HANDLE,
      redirect_url: redirectUrl,
      webhook_url: RAILWAY_URL + '/webhook',
      order_nsu: orderNsu,
      items: [{
        quantity: 1,
        price: totalCents,
        // IMPORTANTE: inclui nome e nums na descrição para recuperar no webhook
        description: 'Rifa Aurum Wood | Nos: ' + nums + ' | Nome: ' + nome + ' | WPP: ' + (wpp||'')
      }]
    };

    const r = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();

    if (!r.ok || !data.url) {
      console.error('Erro InfinitePay:', JSON.stringify(data));
      return res.status(500).json({ erro: 'Erro ao criar cobranca', detalhe: data });
    }

    console.log('Cobrança criada:', orderNsu, '| R$', totalNum, '|', nums);
    res.json({ url: data.url, order_nsu: orderNsu });

  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ erro: 'Erro interno', detalhe: err.message });
  }
});

// ── WEBHOOK ──
app.post('/webhook', async (req, res) => {
  // Responde 200 imediatamente para a InfinitePay
  res.status(200).json({ success: true, message: null });

  try {
    console.log('Webhook recebido:', JSON.stringify(req.body));
    const { order_nsu, amount, items } = req.body;
    if (!order_nsu) return;

    // Evita processar o mesmo pedido duas vezes
    if (processados.has(order_nsu)) {
      console.log('Pedido já processado:', order_nsu);
      return;
    }

    // ── Extrai números e dados da descrição ──
    // description: "Rifa Aurum Wood | Nos: 17, 25, 33 | Nome: João | WPP: 47999..."
    let nums = '';
    let nome = '';
    let wpp = '';
    let numArray = [];

    if (items && items[0] && items[0].description) {
      const desc = items[0].description;
      console.log('Description:', desc);

      // Extrai números
      const nosMatch = desc.match(/Nos:\s*([0-9,\s]+?)(?:\s*\||\s*$)/);
      if (nosMatch) {
        nums = nosMatch[1].trim();
        numArray = nums.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
      }

      // Extrai nome
      const nomeMatch = desc.match(/Nome:\s*([^|]+?)(?:\s*\||\s*$)/);
      if (nomeMatch) nome = nomeMatch[1].trim();

      // Extrai WPP
      const wppMatch = desc.match(/WPP:\s*([^|]+?)(?:\s*\||\s*$)/);
      if (wppMatch) wpp = wppMatch[1].trim();
    }

    if (numArray.length === 0) {
      console.log('Nenhum número encontrado no webhook!');
      return;
    }

    // Busca vendidos atuais
    const vendidosAtuais = await buscarVendidos();

    // Adiciona os novos números
    numArray.forEach(n => { if (!vendidosAtuais.includes(n)) vendidosAtuais.push(n); });
    vendidosAtuais.sort((a, b) => a - b);
    vendidosCache = vendidosAtuais;

    // Salva no Gist
    await atualizarGist(vendidosAtuais);

    // Marca como processado
    processados.add(order_nsu);

    console.log('PAGO!', nome, '| Nums:', nums, '| Vendidos agora:', vendidosAtuais);

    // Verifica números da sorte
    const numsSorte = numArray.filter(n => NUMEROS_SORTE.includes(n));
    const isSorte = numsSorte.length > 0;

    // Notifica Telegram
    await notificarTelegram(nome, wpp, nums, amount, isSorte, numsSorte);

  } catch (err) {
    console.error('Erro no webhook:', err);
  }
});

// ── VENDIDOS ──
app.get('/vendidos', async (req, res) => {
  const v = await buscarVendidos();
  res.json({ vendidos: v });
});

// ── HEALTH ──
app.get('/', (req, res) => {
  res.json({ status: 'ok', vendidos: vendidosCache.length, processados: processados.size });
});

app.listen(PORT, () => {
  console.log('Servidor Aurum Wood na porta', PORT);
  // Carrega vendidos ao iniciar
  buscarVendidos().then(v => console.log('Vendidos carregados:', v));
});
