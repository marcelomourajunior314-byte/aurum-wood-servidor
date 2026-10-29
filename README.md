# Aurum Wood

Tudo roda no **Cloudflare** (gratuito) e é publicado automaticamente a cada commit na branch `main`.

| Pasta | O que é | Worker |
|---|---|---|
| `cloudflare/` | Servidor: cobrança InfinitePay, webhook, números vendidos, config do site, aviso no Telegram, chat IA | `aurum-wood-api` |
| `site/public/` | Site público | `aurumwood` |
| `admin/public/` | Painel admin (PWA) | `aurumwood-admin` |

- Dados: GitHub Gist `2d866d61320ce44aea56e1f80658fd2e`
- Segredos (`GITHUB_TOKEN`, `TG_BOT_TOKEN`) ficam no painel do Cloudflare — nunca no código.

## Rotas do servidor
`GET /` · `GET /vendidos` · `GET /config` · `GET /config-debug` · `POST /criar-cobranca` · `POST /webhook` · `POST /chat` · `POST /deploy-site` · `POST /deploy-admin`
