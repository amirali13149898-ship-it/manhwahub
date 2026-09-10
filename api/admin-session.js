import { cors, getAdminAccess, getUser, rateLimit } from './_utils.js';

export default async function handler(req, res) {
  if (cors(req, res, 'GET, OPTIONS')) return;
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (!rateLimit(req, res, 60)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'وارد حساب شوید.' });
    const access = await getAdminAccess(user);
    return res.status(200).json(access);
  } catch (err) {
    console.error('admin session API:', err);
    return res.status(500).json({ error: err.message });
  }
}
