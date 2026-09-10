import supabase from './db-client.js';
import { cors, rateLimit, requireUser } from './_utils.js';

export default async function handler(req, res) {
  if (cors(req, res, 'GET, POST, DELETE, OPTIONS')) return;
  if (!rateLimit(req, res, 100)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    if (req.method === 'GET') {
      let query = supabase.from('chapter_reads').select('*').eq('user_id', user.id).order('read_at', { ascending: false });
      if (req.query?.manhwa_id) query = query.eq('manhwa_id', Number(req.query.manhwa_id));
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      const chapterId = Number(req.body?.chapter_id);
      const { data: chapter, error: chapterError } = await supabase.from('chapters').select('id,manhwa_id').eq('id', chapterId).maybeSingle();
      if (chapterError) throw chapterError;
      if (!chapter) return res.status(404).json({ error: 'چپتر پیدا نشد.' });
      const { data: existing, error: existingError } = await supabase.from('chapter_reads').select('*').eq('user_id', user.id).eq('chapter_id', chapterId).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return res.status(200).json(existing);
      const { data, error } = await supabase.from('chapter_reads').insert({ user_id: user.id, chapter_id: chapter.id, manhwa_id: chapter.manhwa_id }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    if (req.method === 'DELETE') {
      const { error } = await supabase.from('chapter_reads').delete().eq('user_id', user.id).eq('chapter_id', Number(req.body?.chapter_id));
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('chapter reads API:', err);
    return res.status(500).json({ error: err.message });
  }
}
