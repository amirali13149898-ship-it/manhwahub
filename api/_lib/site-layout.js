import supabase from './db-client.js';
import { cors, rateLimit, requireAdmin } from './_utils.js';

export default async function handler(req, res) {
  if (cors(req, res, 'GET, POST, PUT, OPTIONS')) return;
  if (!rateLimit(req, res, 80)) return;
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('site_layout').select('*').order('position', { ascending: true });
      if (error) throw error;
      return res.status(200).json(data);
    }
    if (req.method === 'PUT') {
      if (!await requireAdmin(req, res, 'layout')) return;
      const keys = Array.isArray(req.body?.ordered_keys) ? req.body.ordered_keys.map(String) : [];
      if (!keys.length || new Set(keys).size !== keys.length) return res.status(400).json({ error: 'ترتیب بخش‌ها معتبر نیست.' });
      const results = await Promise.all(keys.map((key, index) => supabase.from('site_layout').update({ position: index + 1, updated_at: new Date().toISOString() }).eq('section_key', key).select().single()));
      const failure = results.find(result => result.error)?.error;
      if (failure) throw failure;
      return res.status(200).json(results.map(result => result.data));
    }
    if (req.method === 'POST') {
      if (!await requireAdmin(req, res, 'layout')) return;
      const { section_key, label } = req.body || {};
      const { count } = await supabase.from('site_layout').select('*', { count: 'exact', head: true });
      const { data, error } = await supabase.from('site_layout').insert({ section_key, label, position: (count || 0) + 1 }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('site layout API:', err);
    return res.status(500).json({ error: err.message });
  }
}
