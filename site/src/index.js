// Site Aurum Wood: www.aurumwood.com.br → aurumwood.com.br (um endereço só para o Google)
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.hostname === 'www.aurumwood.com.br') { u.hostname = 'aurumwood.com.br'; return Response.redirect(u.toString(), 301); }
    return env.ASSETS.fetch(req);
  },
};
