import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import supabase from './db-client.js';
import { cors, rateLimit, requireUser } from './_utils.js';

const TOKEN_LIFETIME_MS = 5 * 60 * 1000;

export default async function handler(req, res) {
  if (cors(req, res, 'GET, POST, OPTIONS')) return;
  if (!rateLimit(req, res, 120)) return;
  try {
    if (req.method === 'POST') {
      const user = await requireUser(req, res);
      if (!user) return;
      const chapterId = Number(req.body?.chapter_id);
      const [{ data: chapter, error: chapterError }, { data: fileInfo, error: fileError }] = await Promise.all([
        supabase.from('chapters').select('id,manhwa_id,pdf_url,file_name,chapter_number').eq('id', chapterId).maybeSingle(),
        supabase.from('chapter_files').select('chunk_urls').eq('chapter_id', chapterId).maybeSingle(),
      ]);
      if (chapterError || fileError) throw chapterError || fileError;
      if (!chapter) return res.status(404).json({ error: 'چپتر پیدا نشد.' });
      await supabase.from('analytics_events').insert({ event_type: 'manhwa_download', manhwa_id: chapter.manhwa_id, user_id: user.id });
      if (!fileInfo?.chunk_urls?.length || fileInfo.chunk_urls.length === 1) {
        const fileName = String(chapter.file_name || `chapter-${chapter.chapter_number}.pdf`).replace(/[\r\n"]/g, '-');
        const separator = chapter.pdf_url.includes('?') ? '&' : '?';
        return res.status(200).json({ url: `${chapter.pdf_url}${separator}download=${encodeURIComponent(fileName)}` });
      }
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
      const { error } = await supabase.from('download_tokens').insert({ id, user_id: user.id, chapter_id: chapterId, expires_at: expiresAt });
      if (error) throw error;
      return res.status(201).json({ url: `/api/download?token=${encodeURIComponent(id)}` });
    }

    if (req.method === 'GET') {
      const token = String(req.query?.token || '');
      if (!token) return res.status(400).json({ error: 'لینک دانلود معتبر نیست.' });
      const { data: grant, error: grantError } = await supabase.from('download_tokens').select('*').eq('id', token).maybeSingle();
      if (grantError) throw grantError;
      if (!grant || new Date(grant.expires_at).getTime() < Date.now()) return res.status(403).json({ error: 'لینک دانلود منقضی شده است.' });
      const [{ data: chapter, error: chapterError }, { data: fileInfo, error: fileError }] = await Promise.all([
        supabase.from('chapters').select('*').eq('id', grant.chapter_id).single(),
        supabase.from('chapter_files').select('*').eq('chapter_id', grant.chapter_id).maybeSingle(),
      ]);
      if (chapterError || fileError) throw chapterError || fileError;
      const urls = fileInfo?.chunk_urls?.length ? fileInfo.chunk_urls : [chapter.pdf_url];
      const fileName = String(chapter.file_name || `chapter-${chapter.chapter_number}.pdf`).replace(/[\r\n"]/g, '-');
      if (urls.length === 1) {
        await supabase.from('download_tokens').delete().eq('id', token);
        const separator = urls[0].includes('?') ? '&' : '?';
        return res.redirect(302, `${urls[0]}${separator}download=${encodeURIComponent(fileName)}`);
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.setHeader('Cache-Control', 'private, no-store');
      if (Number(chapter.file_size) > 0) res.setHeader('Content-Length', String(chapter.file_size));
      for (const url of urls) {
        const response = await fetch(url);
        if (!response.ok || !response.body) throw new Error('دریافت فایل از فضای ذخیره‌سازی ناموفق بود.');
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(Buffer.from(value))) await once(res, 'drain');
        }
      }
      res.end();
      await supabase.from('download_tokens').delete().eq('id', token);
      return;
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('download API:', err);
    if (!res.headersSent) return res.status(500).json({ error: err.message });
    return res.end();
  }
}
