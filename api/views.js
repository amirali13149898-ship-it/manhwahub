import supabase from './db-client.js';
import { cors, getUser, rateLimit, requireAdmin } from './_utils.js';

export default async function handler(req, res) {
  if (cors(req, res, 'GET, POST, OPTIONS')) return;
  if (!rateLimit(req, res, 120)) return;
  try {
    if (req.method === 'POST') {
      const manhwaId = Number(req.body?.manhwa_id);
      if (!manhwaId) return res.status(400).json({ error: 'شناسه مانهوا نامعتبر است.' });
      const { data: manhwa, error: manhwaError } = await supabase.from('manhwas').select('id').eq('id', manhwaId).maybeSingle();
      if (manhwaError) throw manhwaError;
      if (!manhwa) return res.status(404).json({ error: 'مانهوا پیدا نشد.' });
      const user = await getUser(req);
      const { data, error } = await supabase.from('manhwa_views').insert({ manhwa_id: manhwaId, viewer_id: user?.id || null }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    if (req.method === 'GET') {
      if (req.query?.public !== 'true' && !await requireAdmin(req, res, 'dashboard')) return;
      const { data: manhwas, error: manhwaError } = await supabase.from('manhwas').select('id').order('id');
      if (manhwaError) throw manhwaError;
      const counts = await Promise.all((manhwas || []).map(async ({ id }) => {
        const { count, error } = await supabase.from('manhwa_views').select('*', { count: 'exact', head: true }).eq('manhwa_id', id);
        if (error) throw error;
        return { manhwa_id: id, views: count || 0 };
      }));
      const { count: total, error: totalError } = await supabase.from('manhwa_views').select('*', { count: 'exact', head: true });
      if (totalError) throw totalError;
      return res.status(200).json({ total: total || 0, items: counts });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('views API:', err);
    return res.status(500).json({ error: err.message });
  }
}
