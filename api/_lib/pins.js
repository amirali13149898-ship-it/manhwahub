import supabase from './db-client.js';
import { cors, rateLimit, requireAdmin } from './_utils.js';

export default async function handler(req, res) {
  if (cors(req, res, 'GET, POST, DELETE, OPTIONS')) return;
  if (!rateLimit(req, res, 100)) return;
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pinned_comments').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json(data);
    }
    const user = await requireAdmin(req, res, 'comments');
    if (!user) return;
    const commentId = Number(req.body?.comment_id);
    if (req.method === 'POST') {
      const { data: comment } = await supabase.from('comments').select('id').eq('id', commentId).maybeSingle();
      if (!comment) return res.status(404).json({ error: 'کامنت پیدا نشد.' });
      const { data, error } = await supabase.from('pinned_comments').upsert({ comment_id: commentId, pinned_by: user.id }, { onConflict: 'comment_id' }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    if (req.method === 'DELETE') {
      const { error } = await supabase.from('pinned_comments').delete().eq('comment_id', commentId);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('pins API:', err);
    return res.status(500).json({ error: err.message });
  }
}
