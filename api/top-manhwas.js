import supabase from './db-client.js';
import { cors, rateLimit, requireAdmin } from './_utils.js';

const MAX_TOP_MANHWAS = 15;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!rateLimit(req, res)) return;
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('top_manhwas').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      if (!await requireAdmin(req, res, 'top')) return;
      const manhwaId = Number(req.body?.manhwa_id);
      if (!manhwaId) return res.status(400).json({ error: 'مانهوا انتخاب نشده است.' });
      const { data: existing } = await supabase.from('top_manhwas').select('*').eq('manhwa_id', manhwaId).maybeSingle();
      if (existing) return res.status(400).json({ error: 'این مانهوا قبلاً انتخاب شده است.' });
      const { count, error: countError } = await supabase.from('top_manhwas').select('*', { count: 'exact', head: true });
      if (countError) throw countError;
      if ((count || 0) >= MAX_TOP_MANHWAS) return res.status(400).json({ error: 'حداکثر ۱۵ مانهوا مجاز است؛ ابتدا یکی از انتخاب‌های قبلی را حذف کنید.' });
      const { data, error } = await supabase.from('top_manhwas').insert({ manhwa_id: manhwaId }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    if (req.method === 'DELETE') {
      if (!await requireAdmin(req, res, 'top')) return;
      const { error } = await supabase.from('top_manhwas').delete().eq('manhwa_id', Number(req.body?.manhwa_id));
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('top manhwas API:', err);
    return res.status(500).json({ error: err.message });
  }
}
