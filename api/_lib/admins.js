import supabase from './db-client.js';
import { cors, rateLimit, requireOwner } from './_utils.js';

const ALLOWED_PERMISSIONS = ['dashboard', 'manhwas', 'top', 'genres', 'uploads', 'comments', 'reports', 'users', 'content', 'layout'];
const cleanPermissions = value => [...new Set((Array.isArray(value) ? value : []).filter(item => ALLOWED_PERMISSIONS.includes(item)))];

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!rateLimit(req, res, 60)) return;
  try {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    if (req.method === 'GET') {
      const { data: profiles, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      const { data: permissionRows, error: permissionsError } = await supabase.from('admin_permissions').select('*').order('granted_at', { ascending: true });
      if (permissionsError) throw permissionsError;
      const permissionMap = new Map((permissionRows || []).map(row => [row.id, row]));
      const admins = (profiles || []).filter(profile => profile.role === 'owner' || profile.role === 'admin' || permissionMap.has(profile.id));
      return res.status(200).json(admins.map(profile => ({ ...profile, role: profile.role === 'owner' ? 'owner' : 'admin', permissions: profile.role === 'owner' ? ALLOWED_PERMISSIONS : permissionMap.get(profile.id)?.permissions || [], granted_at: permissionMap.get(profile.id)?.granted_at || profile.created_at })).sort((a, b) => new Date(a.granted_at) - new Date(b.granted_at)));
    }
    if (req.method === 'POST') {
      const userId = String(req.body?.user_id || '');
      const permissions = cleanPermissions(req.body?.permissions);
      const { data: profile, error: findError } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (findError) throw findError;
      if (!profile) return res.status(404).json({ error: 'کاربر پیدا نشد.' });
      if (profile.role === 'owner') return res.status(400).json({ error: 'نقش مالک قابل تغییر نیست.' });
      const { error: roleError } = await supabase.from('profiles').update({ role: 'admin', status: 'active' }).eq('id', userId);
      if (roleError) throw roleError;
      const now = new Date().toISOString();
      const { data, error } = await supabase.from('admin_permissions').upsert({ id: userId, permissions, granted_by: owner.id, granted_at: now, updated_at: now }, { onConflict: 'id' }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    if (req.method === 'PUT') {
      const userId = String(req.body?.user_id || '');
      const permissions = cleanPermissions(req.body?.permissions);
      const { data, error } = await supabase.from('admin_permissions').update({ permissions, updated_at: new Date().toISOString() }).eq('id', userId).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }
    if (req.method === 'DELETE') {
      const userId = String(req.body?.user_id || '');
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
      if (profile?.role === 'owner') return res.status(400).json({ error: 'مالک را نمی‌توان حذف کرد.' });
      const { error: roleError } = await supabase.from('profiles').update({ role: 'user' }).eq('id', userId);
      if (roleError) throw roleError;
      const { error } = await supabase.from('admin_permissions').delete().eq('id', userId);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admins API:', err);
    return res.status(500).json({ error: err.message });
  }
}
