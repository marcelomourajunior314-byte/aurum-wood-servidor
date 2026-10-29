# Aurum Wood
Tudo publicado no Cloudflare Workers via Git (commit em main = deploy automático em ~1 min):
| Pasta | Worker | Endereço |
|---|---|---|
| cloudflare/ | aurum-wood-api (servidor: InfinitePay, webhook, Telegram, Gist) | https://api.aurumwood.com.br (também https://aurum-wood-api.marcelomourajunior314.workers.dev) |
| site/public/index.html | aurumwood (site público) | https://aurumwood.com.br e https://www.aurumwood.com.br |
| admin/public/index.html | aurumwood-admin (painel) | https://admin.aurumwood.com.br |
- Segredos (GITHUB_TOKEN, TG_BOT_TOKEN) ficam no painel do Cloudflare; NUNCA colocar tokens no código (repositório público).
- Dados no Gist 2d866d61320ce44aea56e1f80658fd2e. Os HTMLs têm ~2MB (imagens base64): editar com scripts/replace, não reescrever o arquivo inteiro.
- Antes de todo commit: `node testes/rodar.mjs` (testes simulados; o hook .githooks/pre-commit bloqueia se falhar — ativar com `git config core.hooksPath .githooks`).
- Commits: user.name "Marcelo", email marcelomourajunior314@gmail.com; responder em português do Brasil.
