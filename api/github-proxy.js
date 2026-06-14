// POST /api/github-proxy
// Proxies GitHub Actions API calls (dispatch + status reads) using a server-side
// PAT stored in the GITHUB_TOKEN Vercel environment variable. The HTML tools page
// calls this endpoint so no token is ever exposed to the browser.
//
// Request body: { ghMethod, ghPath, ghBody }
//   ghMethod  - "GET" or "POST" (default "GET")
//   ghPath    - path under /repos/matt-fry-UB/ua-pricing-poc/ (may include query string)
//   ghBody    - object to JSON-encode as the request body (POST only)

const REPO = 'matt-fry-UB/ua-pricing-poc';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not set in Vercel environment' });

  const { ghMethod = 'GET', ghPath, ghBody } = req.body || {};
  if (!ghPath) return res.status(400).json({ error: 'Missing ghPath' });

  const url = `https://api.github.com/repos/${REPO}/${ghPath}`;

  const opts = {
    method: ghMethod,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'ua-pricing-qa-tool',
    },
  };
  if (ghMethod !== 'GET' && ghBody) {
    opts.body = JSON.stringify(ghBody);
  }

  try {
    const ghResp = await fetch(url, opts);
    if (ghResp.status === 204) return res.status(204).end();
    const data = await ghResp.json();
    return res.status(ghResp.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
