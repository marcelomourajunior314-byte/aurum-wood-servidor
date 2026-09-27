// Aurum Wood - Servidor Rifa v4.8-midias-split
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(cors({ origin: '*' }));
app.options('*', cors());

const HANDLE         = 'aurumwood';
const TG_BOT_TOKEN   = '8619359220:AAGTv3qeAkUuwhS8WMv-UnR3MTHNDUshLlc';
const TG_CHAT_ID     = '8782621401';
const GIST_ID        = process.env.GIST_ID        || '2d866d61320ce44aea56e1f80658fd2e';
const GIST_USER      = 'marcelomourajunior314-byte';
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const NETLIFY_TOKEN  = process.env.NETLIFY_TOKEN;
const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID; // admin app
const NETLIFY_SITE_ID_MAIN = process.env.NETLIFY_SITE_ID_MAIN || ''; // site principal aurumwood
const RAILWAY_URL    = process.env.RAILWAY_URL    || 'https://aurum-wood-servidor-production.up.railway.app';
const SITE_URL       = process.env.SITE_URL       || 'https://aurumwood.netlify.app';
const PORT           = process.env.PORT           || 3000;
const NUMS_SORTE     = [75, 80];
const processados    = new Set();

function ghHeaders() {
  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  return headers;
}

// Busca o conteúdo COMPLETO de um arquivo do Gist, mesmo quando a API
// retorna ele truncado (GitHub corta o campo "content" acima de ~1MB).
// Quando truncated=true, buscamos o conteúdo integral em file.raw_url.
async function lerArquivoGistCompleto(gistData, nomeArquivo) {
  const file = gistData?.files?.[nomeArquivo];
  if (!file) return null;

  if (!file.truncated) {
    return file.content ?? null;
  }

  // Truncado: precisamos buscar o conteúdo completo via raw_url.
  console.log(`Gist: arquivo "${nomeArquivo}"
