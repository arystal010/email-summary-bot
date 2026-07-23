/**
 * Email Summary Bot — Cloudflare Worker
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/') return new Response('Bot is running!');
    return new Response('Not Found', { status: 404 });
  }
};