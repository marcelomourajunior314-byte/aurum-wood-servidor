// Testes automáticos — rodar antes de cada commit:  node testes/rodar.mjs
// Simula GitHub Gist, InfinitePay e Telegram; não acessa nada de verdade.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const raiz = fileURLToPath(new URL('..', import.meta.url));
let falhas = 0; const ok = (c, msg) => { console.log((c ? '  ✔ ' : '  ✘ ') + msg); if (!c) falhas++; };

// ---------- 1) HTMLs: o JavaScript embutido precisa compilar ----------
console.log('HTML (sintaxe do JavaScript)');
for (const f of ['site/public/index.html', 'admin/public/index.html']) {
  const html = readFileSync(raiz + f, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let erro = null; for (const js of scripts) { try { new Function(js); } catch (e) { erro = e.message; } }
  ok(!erro, `${f} (${scripts.length} scripts)${erro ? ' → ' + erro : ''}`);
  ok(!/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|nfp_[A-Za-z0-9]{20,}|\d{9,10}:AA[A-Za-z0-9_-]{30,}|sk-ant-[A-Za-z0-9-]{20,}/.test(html), `${f} sem tokens/senhas no código`);
  ok(!/railway\.app|netlify\.app/.test(html), `${f} sem endereços antigos (Railway/Netlify)`);
}

// ---------- 2) Servidor ----------
console.log('Servidor (cloudflare/src/worker.js)');
const W = (await import(raiz + 'cloudflare/src/worker.js')).default;
let gist, pc, calls;
const reset = () => {
  gist = { files: { 'vendidos.json': { content: '{"vendidos":[3,6]}' }, 'config-site.json': { truncated: true, raw_url: 'https://raw/c' }, 'portfolio.json': { content: '[{"fotos":["a"]}]' } } };
  pc = { status: 200, body: { success: true, paid: true, amount: 1000 } }; calls = [];
};
globalThis.fetch = async (u, o = {}) => {
  u = String(u); const m = o.method || 'GET'; calls.push([m, u, o.body]);
  const J = (x, s = 200) => new Response(JSON.stringify(x), { status: s });
  if (u.includes('api.github.com/gists') && m === 'GET') return J(gist);
  if (u.includes('api.github.com/gists') && m === 'PATCH') { for (const [n, f] of Object.entries(JSON.parse(o.body).files)) gist.files[n] = { content: f.content }; return J({}); }
  if (u.includes('places.googleapis.com')) return J({ rating: 4.9, userRatingCount: 12, googleMapsUri: 'https://maps/x', reviews: [{ authorAttribution: { displayName: 'Maria' }, rating: 5, text: { text: 'Lindo!' }, relativePublishTimeDescription: 'há 1 mês' }] });
  if (u === 'https://raw/c') return new Response('{"titulo":"Aurum","rifas":[{"sorte":[75,80]}]}');
  if (u.endsWith('/payment_check')) return J(pc.body, pc.status);
  if (u.includes('/links')) return J({ url: 'https://pay/x' });
  if (u.includes('telegram')) return J({ ok: true });
  return J({}, 404);
};
const env = { GIST_ID: 'G', GITHUB_TOKEN: 't', TG_BOT_TOKEN: 'b', TG_CHAT_ID: '1', HANDLE: 'aurumwood', SITE_URL: 'https://site', NUMS_SORTE: '75,80' };
const run = async (m, p, b) => { const w = []; const r = await W.fetch(new Request('https://api.x' + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }), env, { waitUntil: x => w.push(x) }); await Promise.all(w); return r; };
const vendidos = () => JSON.parse(gist.files['vendidos.json'].content).vendidos;
const tg = () => calls.filter(c => c[1].includes('telegram')).map(c => JSON.parse(c[2]).text);
const hook = (nums, extra = {}) => ({ order_nsu: 'rifa-1', transaction_nsu: 'T1', invoice_slug: 'S1', amount: 1000, items: [{ description: `Rifa Aurum Wood | Nos: ${nums} | Nome: Ana | WPP: 47` }], ...extra });

reset(); let r = await run('GET', '/'); ok(r.status === 200 && (await r.json()).status === 'ok', 'GET / responde');
reset(); r = await run('GET', '/vendidos'); ok(JSON.stringify((await r.json()).vendidos) === '[3,6]', 'GET /vendidos');
reset(); r = await run('GET', '/config'); const cfg = await r.json(); ok(cfg.titulo === 'Aurum' && cfg.portfolio?.[0]?.fotos?.[0] === 'a', 'GET /config junta config + coleções');
reset(); r = await run('POST', '/criar-cobranca', { nome: 'Ana', total: '8', nums: '3' }); ok(r.status === 400, 'cobrança recusa número já vendido');
reset(); r = await run('POST', '/criar-cobranca', { nome: 'Ana', total: '8', nums: '9' }); ok((await r.json()).url === 'https://pay/x', 'cobrança criada');
ok(JSON.parse(calls.find(c => c[1].includes('/links'))[2]).webhook_url === 'https://api.x/webhook', 'webhook_url aponta para o próprio servidor');
reset(); await run('POST', '/webhook', hook('9,75')); ok(vendidos().includes(9) && vendidos().includes(75), 'pagamento confirmado marca números');
ok(tg().length === 1 && tg()[0].includes('NÚMERO DA SORTE'), 'Telegram avisa número da sorte');
await run('POST', '/webhook', hook('9,75')); ok(tg().length === 1, 'reenvio do mesmo pagamento não duplica aviso');
reset(); pc = { status: 200, body: { success: true, paid: false } }; await run('POST', '/webhook', hook('11')); ok(!vendidos().includes(11) && tg()[0]?.includes('RECUSADO'), 'pagamento NÃO confirmado é recusado (e avisa no Telegram)');
reset(); await run('POST', '/webhook', hook('12', { transaction_nsu: undefined })); ok(!vendidos().includes(12), 'webhook falso (sem transaction_nsu) é recusado');
reset(); pc = { status: 404, body: {} }; await run('POST', '/webhook', hook('13')); ok(!vendidos().includes(13), 'InfinitePay diz que não existe (404) → recusado');
reset(); pc = { status: 503, body: {} }; await run('POST', '/webhook', hook('14')); ok(vendidos().includes(14) && tg()[0]?.includes('Não consegui confirmar'), 'InfinitePay fora do ar → aceita e avisa para conferir');
// ---- avaliações ----
const aval = () => JSON.parse(gist.files['avaliacoes.json']?.content || '{"itens":[]}').itens;
const bom = { nome: 'Ana', nota: 5, texto: 'Peça linda, chegou perfeita!', produto: 'Tábua', ms: 5000 };
reset(); r = await run('POST', '/avaliacoes', bom); ok(r.status === 200 && aval().length === 1 && aval()[0].status === 'pendente', 'avaliação entra como pendente');
ok(tg().some(t => t.includes('NOVA AVALIAÇÃO')), 'Telegram avisa nova avaliação');
r = await run('GET', '/avaliacoes'); ok((await r.json()).itens.length === 0, 'avaliação pendente NÃO aparece no site');
{ const l = aval(); l[0].status = 'aprovada'; gist.files['avaliacoes.json'] = { content: JSON.stringify({ itens: l }) }; }
r = await run('GET', '/avaliacoes'); { const j = await r.json(); ok(j.itens.length === 1 && j.itens[0].nome === 'Ana' && !('status' in j.itens[0]) && !('id' in j.itens[0]), 'avaliação aprovada aparece (sem campos internos)'); }
reset(); await run('POST', '/avaliacoes', { ...bom, site: 'robo' }); ok(aval().length === 0, 'robô (campo-armadilha) é ignorado');
reset(); r = await run('POST', '/avaliacoes', { ...bom, ms: 500 }); ok(r.status === 400 && aval().length === 0, 'envio rápido demais é recusado');
reset(); r = await run('POST', '/avaliacoes', { ...bom, texto: 'compre em www.spam.com agora' }); ok(r.status === 400, 'comentário com link é recusado');
reset(); r = await run('POST', '/avaliacoes', { ...bom, nota: 9 }); ok(r.status === 400, 'nota inválida é recusada');
reset(); r = await run('GET', '/avaliacoes-google'); ok((await r.json()).configurado === false, 'Google sem chave: avisa que não está configurado');
{ const rr = await W.fetch(new Request('https://api.x/avaliacoes-google'), { ...env, GOOGLE_PLACE_ID: 'P' }, { waitUntil() {} }); const j = await rr.json(); ok(j.configurado === false && j.escreverUrl.includes('placeid=P'), 'só com Place ID: devolve o link para avaliar no Google'); }
reset(); { gist.files['avaliacoes.json'] = { content: JSON.stringify({ itens: [{ id: 'g1', nome: 'Maria', nota: 5, texto: 'Lindo demais', data: '2026-11-01', status: 'aprovada', origem: 'google' }] }) }; r = await run('GET', '/avaliacoes'); ok((await r.json()).itens[0].origem === 'google', 'avaliação do Google colada pelo admin aparece como "Google"'); }
{ const e0 = { ...env, GOOGLE_PLACES_KEY: 'k', GOOGLE_PLACE_ID: 'P' }; const rr = await W.fetch(new Request('https://api.x/avaliacoes-google'), e0, { waitUntil() {} }); const j = await rr.json(); ok(j.nota === 4.9 && j.itens[0].nome === 'Maria' && j.escreverUrl.includes('placeid=P'), 'Google com chave: devolve nota, avaliações e link para avaliar'); }
reset(); r = await run('OPTIONS', '/criar-cobranca'); ok(r.status === 204 && r.headers.get('access-control-allow-origin') === '*', 'CORS liberado');

console.log('Site (redirecionamento www)');
const SITE = (await import(raiz + 'site/src/index.js')).default;
const envS = { ASSETS: { fetch: async () => new Response('SITE') } };
let rs = await SITE.fetch(new Request('https://www.aurumwood.com.br/rifa?x=1'), envS);
ok(rs.status === 301 && rs.headers.get('location') === 'https://aurumwood.com.br/rifa?x=1', 'www redireciona para aurumwood.com.br');
rs = await SITE.fetch(new Request('https://aurumwood.com.br/'), envS); ok((await rs.text()) === 'SITE', 'endereço principal abre o site');
ok(readFileSync(raiz + 'site/public/index.html', 'utf8').includes('rel="canonical" href="https://aurumwood.com.br/"'), 'site marca o endereço oficial (canonical)');

console.log(falhas ? `\n✘ ${falhas} falha(s)` : '\n✔ Tudo certo'); process.exit(falhas ? 1 : 0);
