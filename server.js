const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(cors());

const HANDLE = 'aurumwood';
const WPP_DONO = '5547991498489'; // SEU número para receber notificações
const SITE_URL = process.env.SITE_URL || 'https://aurumwood.netlify.app';
const RAILWAY_URL = process.env.RAILWAY_URL || 'https://aurum-wood-servidor-production.up.railway.app';
const PORT = process.env.PORT || 3000;

let pedidos = {};
let vendidos = [];

// ── NOTIFICA DONO VIA CALLMEBOT (WhatsApp sem abrir browser) ──
async function notificarDono(pedido) {
  try {
    // CallMeBot envia mensagem direto no seu WhatsApp sem interação do cliente
    // Para ativar: envie "I allow callmebot to send me messages" para +34 644 59 77 91 no WhatsApp
    const apiKey = process.env.CALLMEBOT_KEY || '';
    if (!apiKey) {
      console.log('CALLMEBOT_KEY não configurado - pulando notificação WPP');
      return;
    }
    const msg = encodeURIComponent(
      '🎟️ NOVA VENDA RIFA AURUM WOOD!\n\n' +
      '👤 Nome: ' + pedido.nome + '\n' +
      '📱 WPP: ' + pedido.wpp + '\n' +
      '🔢 Números: ' + pedido.nums + '\n' +
      '💰 Total: R$ ' + pedido.total.toFixed(2) + '\n' +
      '📋 Pedido: ' + pedido.orderNsu
    );
    const url = `https://api.callmebot.com/whatsapp.php?phone=${WPP_DONO}&text=${msg}&apikey=${apiKey}`;
    await fetch(url);
    console.log('Notificação WPP enviada para o dono!');
  } catch (err) {
    console.log('Erro ao notificar dono:', err.message);
  }
}

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

    pedidos[orderNsu] = {
      nome, wpp: wpp || '', email: email || '',
      nums, total: totalNum, pago: false,
      numArray, orderNsu
    };

    // Redirect com dados na URL para a página de obrigado
    const redirectUrl = SITE_URL + '/obrigado.html'
      + '?nome=' + encodeURIComponent(nome)
      + '&nums=' + encodeURIComponent(nums)
      + '&total=' + encodeURIComponent(totalNum.toFixed(2))
      + '&order_nsu=' + encodeURIComponent(orderNsu);

    // Formata telefone para InfinitePay (somente números, sem +55)
    const telLimpo = (wpp || '').replace(/\D/g, '');

    const payload = {
      handle: HANDLE,
      redirect_url: redirectUrl,
      webhook_url: RAILWAY_URL + '/webhook',
      order_nsu: orderNsu,
      // Pré-preenche dados do cliente no checkout
      customer: {
        name: nome,
        phone_number: telLimpo ? ('+55' + telLimpo) : undefined,
        email: email || undefined
      },
      items: [{
        quantity: 1,
        price: totalCents,
        description: 'Rifa Aurum Wood | Nos: ' + nums
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
      console.error('Erro InfinitePay:', JSON.stringify(data));
      return res.status(500).json({ erro: 'Erro ao criar cobranca', detalhe: data });
    }

    console.log('Cobranca criada: ' + orderNsu + ' | R$ ' + totalNum + ' | ' + nums);
    res.json({ url: data.url, order_nsu: orderNsu });

  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ erro: 'Erro interno', detalhe: err.message });
  }
});

// ── WEBHOOK — pagamento confirmado ──
app.post('/webhook', async (req, res) => {
  try {
    console.log('Webhook recebido:', JSON.stringify(req.body));
    const { order_nsu } = req.body;

    // Sempre responde 200 para a InfinitePay não retentar
    res.status(200).json({ success: true, message: null });

    if (!order_nsu || !pedidos[order_nsu]) return;

    const pedido = pedidos[order_nsu];
    if (!pedido.pago) {
      pedido.pago = true;
      pedido.numArray.forEach(n => { if (!vendidos.includes(n)) vendidos.push(n); });
      vendidos.sort((a, b) => a - b);
      console.log('PAGO! ' + pedido.nome + ' | Nums: ' + pedido.nums);

      // Notifica o dono silenciosamente via CallMeBot
      await notificarDono(pedido);
    }

  } catch (err) {
    console.error('Erro webhook:', err);
    res.status(200).json({ success: true });
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
  console.log('Servidor Aurum Wood na porta ' + PORT);
});
