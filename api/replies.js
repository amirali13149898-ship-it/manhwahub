import supabase from './db-client.js';
import { cors, getUser, rateLimit, requireAdmin, requireUser, isAdminEmail } from './_utils.js';

async function enrichReplies(rows = []) {
  const userIds = [...new Set(rows.map(row => row.user_id).filter(Boolean))];
  if (!userIds.length) return rows;
  const { data: profiles, error } = await supabase.from('profiles').select('id,email,display_name,role').in('id', userIds);
  if (error) throw error;
  const { data: preferences, error: preferenceError } = await supabase.from('admin_preferences').select('id,comment_color').in('id', userIds);
  if (preferenceError) throw preferenceError;
  const profileMap = new Map((profiles || []).map(profile => [profile.id, profile]));
  const colorMap = new Map((preferences || []).map(preference => [preference.id, preference.comment_color]));
  return rows.map(row => {
    const profile = profileMap.get(row.user_id);
    const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || isAdminEmail(profile?.email);
    return { ...row, display_name: profile?.display_name || row.display_name, is_admin: isAdmin, comment_color: isAdmin ? colorMap.get(row.user_id) || '#eab308' : null };
  });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!rateLimit(req, res, 80)) return;
  try {
    if (req.method === 'GET') {
      if (req.query?.all === 'true') {
        if (!await requireAdmin(req, res, 'comments')) return;
        const { data, error } = await supabase.from('comment_replies').select('*').order('created_at', { ascending: true });
        if (error) throw error;
        return res.status(200).json(await enrichReplies(data));
      }
      let commentIds = [];
      if (req.query?.comment_id) commentIds = [Number(req.query.comment_id)];
      if (req.query?.manhwa_id) {
        const { data: comments, error: commentsError } = await supabase.from('comments').select('id').eq('manhwa_id', Number(req.query.manhwa_id)).eq('status', 'approved');
        if (commentsError) throw commentsError;
        commentIds = (comments || []).map(item => item.id);
      }
      if (!commentIds.length) return res.status(200).json([]);
      const { data, error } = await supabase.from('comment_replies').select('*').in('comment_id', commentIds).eq('status', 'approved').order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json(await enrichReplies(data));
    }
    if (req.method === 'POST') {
      const user = await requireUser(req, res);
      if (!user) return;
      const commentId = Number(req.body?.comment_id);
      const body = String(req.body?.body || '').trim();
      if (!commentId || body.length < 2 || body.length > 700) return res.status(400).json({ error: 'پاسخ باید بین ۲ تا ۷۰۰ کاراکتر باشد.' });
      const { data: comment, error: commentError } = await supabase.from('comments').select('id,status').eq('id', commentId).maybeSingle();
      if (commentError) throw commentError;
      if (!comment || comment.status !== 'approved') return res.status(404).json({ error: 'کامنت موردنظر پیدا نشد.' });
      const { data: existing, error: existingError } = await supabase.from('comment_replies').select('id').eq('comment_id', commentId).eq('user_id', user.id).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return res.status(400).json({ error: 'شما قبلاً به این کامنت پاسخ داده‌اید.' });
      const { count, error: countError } = await supabase.from('comment_replies').select('*', { count: 'exact', head: true }).eq('comment_id', commentId);
      if (countError) throw countError;
      if ((count || 0) >= 200) return res.status(400).json({ error: 'ظرفیت ۲۰۰ پاسخ این کامنت تکمیل شده است.' });
      const { data, error } = await supabase.from('comment_replies').insert({ comment_id: commentId, user_id: user.id, display_name: user.user_metadata?.display_name || user.email?.split('@')[0] || 'کاربر', body, status: 'approved' }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    if (req.method === 'DELETE') {
      const user = await getUser(req);
      if (!user) return res.status(401).json({ error: 'وارد حساب شوید.' });
      let query = supabase.from('comment_replies').delete().eq('id', Number(req.body?.id));
      if (!isAdminEmail(user.email)) query = query.eq('user_id', user.id);
      const { error } = await query;
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'PUT') {
      const user = await getUser(req);
      if (!user) return res.status(401).json({ error: 'وارد حساب شوید.' });
      const id = Number(req.body?.id);
      if (typeof req.body?.body === 'string') {
        const body = req.body.body.trim();
        if (body.length < 2 || body.length > 700) return res.status(400).json({ error: 'پاسخ باید بین ۲ تا ۷۰۰ کاراکتر باشد.' });
        const { data: reply, error: findError } = await supabase.from('comment_replies').select('user_id').eq('id', id).maybeSingle();
        if (findError) throw findError;
        if (!reply) return res.status(404).json({ error: 'پاسخ پیدا نشد.' });
        if (reply.user_id !== user.id && !isAdminEmail(user.email)) return res.status(403).json({ error: 'فقط نویسنده پاسخ می‌تواند آن را ویرایش کند.' });
        const { data, error } = await supabase.from('comment_replies').update({ body }).eq('id', id).select().single();
        if (error) throw error;
        return res.status(200).json(data);
      }
      if (!await requireAdmin(req, res, 'comments')) return;
      const { data, error } = await supabase.from('comment_replies').update({ status: req.body?.status }).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('replies API:', err);
    return res.status(500).json({ error: err.message });
  }
}
