# Aurum Wood - Servidor da Rifa

## Como subir no Railway

1. Acesse railway.app e faça login
2. Clique em "New Project"
3. Escolha "Deploy from GitHub repo"
4. Faça upload desta pasta ou conecte ao GitHub
5. Adicione a variável de ambiente:
   - RAILWAY_URL = (URL que o Railway vai te dar após o deploy)
   - SITE_URL = https://cheerful-pika-71534b.netlify.app

## Rotas

- POST /criar-cobranca → cria cobrança na InfinitePay
- POST /webhook → recebe confirmação de pagamento
- GET /vendidos → retorna números vendidos
- GET / → health check
