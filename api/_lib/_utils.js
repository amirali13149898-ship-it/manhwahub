import supabase from './db-client.js';

const hits = new Map();
export function cors(req, res, methods = 'GET, POST, PUT, DELETE, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
export function rateLimit(req, res, max = 100, windowMs = 60000) {
  const key = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0];
  const now = Date.now(); const entry = hits.get(key);
  if (!entry || now - entry.start > windowMs) { hits.set(key, { start: now, count: 1 }); return true; }
  entry.count += 1;
  if (entry.count > max) { res.status(429).json({ error: 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد تلاش کنید.' }); return false; }
  return true;
}
export async function getUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user;
}
export async function requireUser(req, res) {
  const user = await getUser(req);
  if (!user) res.status(401).json({ error: 'برای ادامه وارد حساب شوید.' });
  return user;
}
export function isAdminEmail(email) {
  return ['madara@manhwahub.ir', 'amirali121511@gmail.com', 'amirali13147878@gmail.com', 'amirali13148989@gmail.com', 'amirali13149999@gmail.com', 'mohamadtamimi5125@gmail.com'].includes(String(email || '').trim().toLowerCase());
}
export const OWNER_EMAIL = 'amirali13149999@gmail.com';
export const ALL_ADMIN_PERMISSIONS = ['dashboard', 'manhwas', 'top', 'genres', 'uploads', 'comments', 'reports', 'users', 'content', 'layout'];
export async function getAdminAccess(user) {
  if (!user) return { isAdmin: false, isOwner: false, role: 'user', permissions: [] };
  if (String(user.email || '').toLowerCase() === OWNER_EMAIL) return { isAdmin: true, isOwner: true, role: 'owner', permissions: ALL_ADMIN_PERMISSIONS };
  const { data: profile, error } = await supabase.from('profiles').select('role,status').eq('id', user.id).maybeSingle();
  const { data: access } = await supabase.from('admin_permissions').select('permissions').eq('id', user.id).maybeSingle();
  if (error || !profile || profile.status !== 'active' || (profile.role !== 'admin' && !access)) return { isAdmin: false, isOwner: false, role: profile?.role || 'user', permissions: [] };
  if (access && profile.role !== 'admin') await supabase.from('profiles').update({ role: 'admin' }).eq('id', user.id);
  return { isAdmin: true, isOwner: false, role: 'admin', permissions: Array.isArray(access?.permissions) ? access.permissions : [] };
}
export async function requireAdmin(req, res, permission) {
  const user = await getUser(req);
  const access = await getAdminAccess(user);
  if (!user || !access.isAdmin || (permission && !access.permissions.includes(permission))) { res.status(403).json({ error: 'دسترسی مدیریت مجاز نیست.' }); return null; }
  user.adminAccess = access;
  return user;
}
export async function requireOwner(req, res) {
  const user = await getUser(req);
  const access = await getAdminAccess(user);
  if (!user || !access.isOwner) { res.status(403).json({ error: 'فقط مالک به این بخش دسترسی دارد.' }); return null; }
  return user;
}
export function slugify(text = '') { return text.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\u0600-\u06FFa-z0-9-]/g, '') || `item-${Date.now()}`; }
