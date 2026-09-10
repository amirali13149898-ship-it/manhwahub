import supabase from './db-client.js';
import { cors, rateLimit, requireUser } from './_utils.js';

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];

export default async function handler(req, res) {
  if (cors(req, res, 'GET, POST, OPTIONS')) return;
  if (!rateLimit(req, res, 30)) return;
  try {
    if (req.method === 'GET' && req.query?.ids) {
      const ids = String(req.query.ids).split(',').filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);
      if (!ids.length) return res.status(200).json([]);
      const { data, error } = await supabase.from('user_avatars').select('*').in('id', ids);
      if (error) throw error;
      return res.status(200).json(data || []);
    }
    const user = await requireUser(req, res);
    if (!user) return;
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('user_avatars').select('*').eq('id', user.id).maybeSingle();
      if (error) throw error;
      return res.status(200).json(data || null);
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.action === 'sign') {
        const size = Number(body.fileSize);
        const contentType = String(body.contentType || '');
        if (!ALLOWED_TYPES.includes(contentType)) return res.status(400).json({ error: 'فقط تصاویر JPG و PNG مجاز هستند.' });
        if (!Number.isFinite(size) || size <= 0 || size > MAX_AVATAR_SIZE) return res.status(400).json({ error: 'حجم تصویر پروفایل باید حداکثر ۵ مگابایت باشد.' });
        const extension = contentType === 'image/png' ? 'png' : 'jpg';
        const path = `${user.id}/avatar-${Date.now()}.${extension}`;
        const { data, error } = await supabase.storage.from('profile-images').createSignedUploadUrl(path);
        if (error) throw error;
        return res.status(200).json({ path, token: data.token });
      }
      if (body.action === 'finalize') {
        const path = String(body.path || '');
        if (!path.startsWith(`${user.id}/`)) return res.status(403).json({ error: 'مسیر تصویر معتبر نیست.' });
        const [folder, ...nameParts] = path.split('/');
        const name = nameParts.join('/');
        const { data: files, error: listError } = await supabase.storage.from('profile-images').list(folder, { search: name, limit: 5 });
        if (listError) throw listError;
        const stored = files?.find(file => file.name === name);
        const size = Number(stored?.metadata?.size || stored?.metadata?.contentLength || 0);
        const mime = String(stored?.metadata?.mimetype || stored?.metadata?.contentType || body.contentType || '');
        if (!stored || size > MAX_AVATAR_SIZE || (mime && !ALLOWED_TYPES.includes(mime))) {
          if (stored) await supabase.storage.from('profile-images').remove([path]);
          return res.status(400).json({ error: 'اعتبارسنجی تصویر ناموفق بود.' });
        }
        const { data: previous } = await supabase.from('user_avatars').select('*').eq('id', user.id).maybeSingle();
        const { data: publicData } = supabase.storage.from('profile-images').getPublicUrl(path);
        const { data, error } = await supabase.from('user_avatars').upsert({ id: user.id, url: publicData.publicUrl, file_name: name, updated_at: new Date().toISOString() }, { onConflict: 'id' }).select().single();
        if (error) throw error;
        if (previous?.url && previous.url !== publicData.publicUrl) {
          const marker = '/profile-images/';
          const oldPath = previous.url.split(marker)[1];
          if (oldPath) await supabase.storage.from('profile-images').remove([decodeURIComponent(oldPath)]);
        }
        return res.status(201).json(data);
      }
      return res.status(400).json({ error: 'عملیات تصویر نامعتبر است.' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('avatar API:', err);
    return res.status(500).json({ error: err.message });
  }
}
