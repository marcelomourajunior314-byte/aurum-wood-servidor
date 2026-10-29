# Aurum Wood
Tudo publicado no Cloudflare Workers via Git (commit em main = deploy automático em ~1 min):
| Pasta | Worker | Endereço |
|---|---|---|
| cloudflare/ | aurum-wood-api (servidor: InfinitePay, webhook, Telegram, Gist) | https://aurum-wood-api.marcelomourajunior314.workers.dev |
| site/public/index.html | aurumwood (site público) | https://aurumwood.marcelomourajunior314.workers.dev |
| admin/public/index.html | aurumwood-admin (painel) | https://aurumwood-admin.marcelomourajunior314.workers.dev |
- Segredos (GITHUB_TOKEN, TG_BOT_TOKEN) ficam no painel do Cloudflare; NUNCA colocar tokens no código (repositório público).
- Dados no Gist 2d866d61320ce44aea56e1f80658fd2e. Os HTMLs têm ~2MB (imagens base64): editar com scripts/replace, não reescrever o arquivo inteiro.
- Commits: user.name "Marcelo", email marcelomourajunior314@gmail.com; responder em português do Brasil.
