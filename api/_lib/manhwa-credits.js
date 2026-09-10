import supabase from './db-client.js';
import { cors, rateLimit, requireAdmin } from './_utils.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!rateLimit(req, res)) return;
  try {
    if (req.method === 'GET') {
      let query = supabase.from('manhwa_credits').select('*').order('id');
      if (req.query?.manhwa_id) query = query.eq('manhwa_id', req.query.manhwa_id);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      if (!await requireAdmin(req, res, 'manhwas')) return;
      const manhwaId = Number(req.body?.manhwa_id);
      const writer = String(req.body?.writer || '').trim();
      if (!manhwaId || !writer) return res.status(400).json({ error: 'نام نویسنده الزامی است.' });
      const { data: existing } = await supabase.from('manhwa_credits').select('*').eq('manhwa_id', manhwaId).maybeSingle();
      const result = existing
        ? await supabase.from('manhwa_credits').update({ writer, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single()
        : await supabase.from('manhwa_credits').insert({ manhwa_id: manhwaId, writer }).select().single();
      if (result.error) throw result.error;
      return res.status(existing ? 200 : 201).json(result.data);
    }
    if (req.method === 'DELETE') {
      if (!await requireAdmin(req, res, 'manhwas')) return;
      const { error } = await supabase.from('manhwa_credits').delete().eq('manhwa_id', req.body?.manhwa_id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('manhwa credits API:', err);
    return res.status(500).json({ error: err.message });
  }
}
