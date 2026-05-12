const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(cors());

// ── CONFIG ──
const HANDLE = 'aurumwood';
const WPP = '5547991498489';
const SITE_URL = process.env.SITE_URL || 'https://cheerful-pika-71534b.netlify.app';
const PORT = process.env.PORT || 3000;

// ── BANCO DE DADOS EM MEMÓRIA ──
// Em produção, usar um banco real. Para a rifa, isso é suficiente.
let pedidos = {}; // { order_nsu: { nome, wpp, nums, total, pago } }
let vendidos = []; // Array de números vendidos

// ── ROTA 1: CRIAR COBRANÇA ──
app.post('/criar-cobranca', async (req, res) => {
  try {
    const { nome, wpp, email, total, nums } = req.body;

    if (!nome || !total || !nums) {
      return res.status(400).json({ erro: 'Dados incompletos' });
    }

    // Verifica se algum número já foi vendido
    const numArray = nums.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    const conflitos = numArray.filter(n => vendidos.includes(n));
    if (conflitos.length > 0) {
      return res.status(400).json({
        erro: 'Numeros indisponiveis',
        numeros: conflitos
      });
    }

    const totalNum = parseFloat(total);
    const totalCents = Math.round(totalNum * 100);
    const orderNsu = 'rifa-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);

    // Salva o pedido pendente
    pedidos[orderNsu] = { nome, wpp: wpp || '', email: email || '', nums, total: totalNum, pago: false, numArray };

    // Chama a API da InfinitePay
    const payload = {
      handle: HANDLE,
      redirect_url: SITE_URL + '/obrigado.html',
      webhook_url: process.env.RAILWAY_URL + '/webhook',
      order_nsu: orderNsu,
      customer: {
        name: nome,
        phone_number: wpp ? '+55' + wpp.replace(/\D/g, '') : undefined,
        email: email || undefined
      },
      items: [{
        quantity: 1,
        price: totalCents,
        description: 'Rifa Aurum Wood | Numeros: ' + nums
      }]
    };

    // Remove campos undefined
    if (!payload.customer.phone_number) delete payload.customer.phone_number;
    if (!payload.customer.email) delete payload.customer.email;

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

    console.log(`✅ Cobrança criada: ${orderNsu} | R$ ${totalNum} | Nums: ${nums}`);
    res.json({ url: data.url, order_nsu: orderNsu });

  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ erro: 'Erro interno', detalhe: err.message });
  }
});

// ── ROTA 2: WEBHOOK (InfinitePay avisa quando pagamento confirmado) ──
app.post('/webhook', (req, res) => {
  try {
    const { order_nsu, paid_amount, capture_method, transaction_nsu } = req.body;

    console.log('📩 Webhook recebido:', req.body);

    if (!order_nsu || !pedidos[order_nsu]) {
      return res.status(400).json({ success: false, message: 'Pedido nao encontrado' });
    }

    const pedido = pedidos[order_nsu];

    if (!pedido.pago) {
      pedido.pago = true;

      // Marca números como vendidos
      pedido.numArray.forEach(n => {
        if (!vendidos.includes(n)) vendidos.push(n);
      });
      vendidos.sort((a, b) => a - b);

      console.log(`🎉 PAGO! ${pedido.nome} | Nums: ${pedido.nums} | Vendidos agora: ${vendidos.join(',')}`);
    }

    res.json({ success: true, message: null });

  } catch (err) {
    console.error('Erro webhook:', err);
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── ROTA 3: SITE BUSCA NÚMEROS VENDIDOS ──
app.get('/vendidos', (req, res) => {
  res.json({ vendidos });
});

// ── ROTA 4: HEALTH CHECK ──
app.get('/', (req, res) => {
  res.json({ status: 'ok', vendidos: vendidos.length, pedidos: Object.keys(pedidos).length });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor Aurum Wood rodando na porta ${PORT}`);
  console.log(`   Handle: $${HANDLE}`);
  console.log(`   Site: ${SITE_URL}`);
});
