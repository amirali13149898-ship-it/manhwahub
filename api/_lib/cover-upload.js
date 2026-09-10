import { randomUUID } from 'node:crypto';
import supabase from './db-client.js';
import { cors, rateLimit, requireAdmin } from './_utils.js';

const MAX_SIZE = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default async function handler(req, res) {
  if (cors(req, res, 'POST, OPTIONS')) return;
  if (!rateLimit(req, res, 50)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (!await requireAdmin(req, res, 'manhwas')) return;
    const body = req.body || {};
    if (body.action === 'sign') {
      const size = Number(body.fileSize), type = String(body.contentType || '');
      if (!TYPES.includes(type)) return res.status(400).json({ error: 'فقط تصاویر JPG، PNG یا WEBP مجاز هستند.' });
      if (!Number.isFinite(size) || size <= 0 || size > MAX_SIZE) return res.status(400).json({ error: 'حجم کاور باید حداکثر ۱۰ مگابایت باشد.' });
      const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      const path = `covers/${randomUUID()}.${extension}`;
      const { data, error } = await supabase.storage.from('manhwa-covers').createSignedUploadUrl(path);
      if (error) throw error;
      return res.status(200).json({ path, token: data.token, signedUrl: data.signedUrl });
    }
    if (body.action === 'finalize') {
      const path = String(body.path || '');
      if (!path.startsWith('covers/')) return res.status(400).json({ error: 'مسیر کاور معتبر نیست.' });
      const name = path.split('/').pop();
      const { data: files, error } = await supabase.storage.from('manhwa-covers').list('covers', { search: name, limit: 5 });
      if (error) throw error;
      const file = files?.find(item => item.name === name);
      const size = Number(file?.metadata?.size || file?.metadata?.contentLength || 0);
      if (!file || size > MAX_SIZE) return res.status(400).json({ error: 'اعتبارسنجی کاور ناموفق بود.' });
      const { data } = supabase.storage.from('manhwa-covers').getPublicUrl(path);
      return res.status(200).json({ url: data.publicUrl });
    }
    return res.status(400).json({ error: 'عملیات نامعتبر است.' });
  } catch (err) {
    console.error('cover upload API:', err);
    return res.status(500).json({ error: err.message });
  }
}
