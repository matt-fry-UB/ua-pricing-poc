// GET /api/sp-locations
// Returns location names from the UA Simplified Pricing QA Checklist (parent rows only).
// Requires SMARTSHEET_ACCESS_TOKEN env var.

const QA_SHEET_ID  = '3089334252031876';
const TASK_COL_ID  = '8869681732816772'; // primary "Location Name" column

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const token = process.env.SMARTSHEET_ACCESS_TOKEN;
  if (!token) {
    return res.status(503).json({ error: 'SMARTSHEET_ACCESS_TOKEN not configured' });
  }

  try {
    const ssResp = await fetch(
      `https://api.smartsheet.com/2.0/sheets/${QA_SHEET_ID}?columnIds=${TASK_COL_ID}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );
    if (!ssResp.ok) {
      const text = await ssResp.text();
      return res.status(502).json({ error: `Smartsheet API ${ssResp.status}: ${text.slice(0, 200)}` });
    }
    const sheet = await ssResp.json();

    const names = (sheet.rows || [])
      .filter(r => !r.parentId)
      .map(r => r.cells?.[0]?.value)
      .filter(Boolean)
      .sort((a, b) => {
        const [cA, stA = ''] = a.split(',').map(s => s.trim());
        const [cB, stB = ''] = b.split(',').map(s => s.trim());
        return stA.localeCompare(stB) || cA.localeCompare(cB);
      });

    return res.status(200).json({ count: names.length, names });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
