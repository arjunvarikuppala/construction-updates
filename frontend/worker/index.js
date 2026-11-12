// Cloudflare Worker for the website.
// - Pages and files are served from ./dist (see "assets" in wrangler.jsonc); this
//   script only sees requests that don't match a file.
// - Every 10 minutes it calls the API's health check, so the API on Render's free
//   plan never goes to sleep (it sleeps after 15 min idle and then takes 30-60 s
//   to answer the next request, which made the app slow to open).
//   One service running all month is ~720 h, inside the free plan's 750 h.

export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env, ctx) {
    const url = env.KEEP_AWAKE_URL;
    if (!url) return;
    ctx.waitUntil(
      fetch(url, { headers: { 'User-Agent': 'bkr-infra-keep-awake' } })
        .then((res) => console.log(`keep-awake ${url} -> ${res.status}`))
        .catch((err) => console.warn(`keep-awake ${url} failed:`, err))
    );
  },
};
