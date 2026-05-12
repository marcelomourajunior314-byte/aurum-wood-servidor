const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(cors());

const HANDLE = 'aurumwood';
const WPP = '5547991498489';
const SITE_URL = process.env.SITE_URL || 'https://aurumwood.netlify.app';
const RAILWAY_URL = process.env.RAILWAY_URL || 'https://aurum-wood-servidor-production.up.railway.app';
const PORT = process.env.PORT || 3000;

let pedidos = {};
let vendidos = [];

// ── CRIAR COBRANÇA ──
app.post('/criar-cobranca', async (req, res) => {
  try {
    const { nome, wpp, email, total, nums } = req.body;

    if (!nome || !total || !nums) {
      return res.status(400).json({ erro: 'Dados incompletos' });
    }

    const numArray = nums.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    const conflitos = numArray.filter(n => vendidos.includes(n));
    if (conflitos.length > 0) {
      return res.status(400).json({ erro: 'Numeros indisponiveis', numeros: conflitos });
    }

    const totalNum = parseFloat(total);
    const totalCents = Math.round(totalNum * 100);
    const orderNsu = 'rifa-' + Date.now();

    pedidos[orderNsu] = { nome, wpp: wpp || '', email: email || '', nums, total: totalNum, pago: false, numArray };

    // SEM dados do cliente — checkout mais simples, sem verificação de código
    const payload = {
      handle: HANDLE,
      redirect_url: SITE_URL + '/obrigado.html',
      webhook_url: RAILWAY_URL + '/webhook',
      order_nsu: orderNsu,
      items: [{
        quantity: 1,
        price: totalCents,
        description: 'Rifa Aurum Wood | Nos: ' + nums + ' | ' + nome
      }]
    };

    const response = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok || !data.url) {
      console.error('Erro InfinitePay:', data);
      return res.status(500).json({ erro: 'Erro ao criar cobranca', detalhe: data });
    }

    console.log(`Cobranca criada: ${orderNsu} | R$ ${totalNum} | ${nums}`);
    res.json({ url: data.url, order_nsu: orderNsu });

  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ erro: 'Erro interno', detalhe: err.message });
  }
});

// ── WEBHOOK ──
app.post('/webhook', (req, res) => {
  try {
    const { order_nsu } = req.body;
    console.log('Webhook recebido:', req.body);

    if (!order_nsu || !pedidos[order_nsu]) {
      return res.status(400).json({ success: false, message: 'Pedido nao encontrado' });
    }

    const pedido = pedidos[order_nsu];
    if (!pedido.pago) {
      pedido.pago = true;
      pedido.numArray.forEach(n => { if (!vendidos.includes(n)) vendidos.push(n); });
      vendidos.sort((a, b) => a - b);
      console.log(`PAGO! ${pedido.nome} | Nums: ${pedido.nums}`);
    }

    res.json({ success: true, message: null });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── VENDIDOS ──
app.get('/vendidos', (req, res) => {
  res.json({ vendidos });
});

// ── HEALTH ──
app.get('/', (req, res) => {
  res.json({ status: 'ok', vendidos: vendidos.length, pedidos: Object.keys(pedidos).length });
});

app.listen(PORT, () => {
  console.log(`Servidor Aurum Wood na porta ${PORT}`);
});
