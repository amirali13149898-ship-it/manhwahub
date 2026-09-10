import supabase from './db-client.js';
import { cors, rateLimit, requireAdmin } from './_utils.js';

export default async function handler(req, res) {
  if (cors(req, res, 'GET, PUT, OPTIONS')) return;
  if (!rateLimit(req, res, 60)) return;
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('admin_preferences').select('*').eq('id', user.id).maybeSingle();
      if (error) throw error;
      return res.status(200).json(data || { id: user.id, comment_color: '#eab308' });
    }
    if (req.method === 'PUT') {
      const color = String(req.body?.comment_color || '');
      if (!/^#[0-9a-f]{6}$/i.test(color)) return res.status(400).json({ error: 'رنگ انتخاب‌شده معتبر نیست.' });
      const { data, error } = await supabase.from('admin_preferences').upsert({ id: user.id, comment_color: color, updated_at: new Date().toISOString() }, { onConflict: 'id' }).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin preferences API:', err);
    return res.status(500).json({ error: err.message });
  }
}
