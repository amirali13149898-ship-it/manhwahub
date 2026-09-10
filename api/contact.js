import supabase from './db-client.js';
import { cors, getAdminAccess, getUser, rateLimit, requireUser } from './_utils.js';

const EDIT_WINDOW_MS = 10 * 60 * 1000;

function tehranDayStart() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00+03:30`).toISOString();
}

async function enrichReports(rows = []) {
  const emails = [...new Set(rows.map(row => row.email).filter(Boolean))];
  if (!emails.length) return rows;
  const { data: profiles, error } = await supabase.from('profiles').select('id,email,display_name').in('email', emails);
  if (error) throw error;
  const ids = (profiles || []).map(profile => profile.id);
  const { data: avatars, error: avatarError } = ids.length ? await supabase.from('user_avatars').select('id,url').in('id', ids) : { data: [], error: null };
  if (avatarError) throw avatarError;
  const avatarMap = new Map((avatars || []).map(avatar => [avatar.id, avatar.url]));
  const profileMap = new Map((profiles || []).map(profile => [profile.email, profile]));
  return rows.map(row => { const profile = profileMap.get(row.email); return { ...row, name: profile?.display_name || row.name || row.email, avatar_url: profile ? avatarMap.get(profile.id) || null : null }; });
}

export default async function handler(req,res){
  if(cors(req,res))return;
  if(!rateLimit(req,res,30,60000))return;
  try{
    if(req.method==='POST'){
      const user=await requireUser(req,res);if(!user)return;
      const{subject,message}=req.body||{};
      if(!subject||String(message||'').length<10)return res.status(400).json({error:'لطفاً همه فیلدها را صحیح تکمیل کنید.'});
      const{count,error:countError}=await supabase.from('contact_messages').select('*',{count:'exact',head:true}).eq('email',user.email).gte('created_at',tehranDayStart());
      if(countError)throw countError;
      if((count||0)>=1)return res.status(429).json({error:'سهمیه گزارش امروز استفاده شده است؛ امکان ارسال گزارش جدید ساعت ۰۰:۰۰ فعال می‌شود.'});
      const displayName=user.user_metadata?.display_name||user.user_metadata?.full_name||user.email;
      const{data,error}=await supabase.from('contact_messages').insert({name:displayName,email:user.email||'',subject,message,status:'new'}).select().single();
      if(error)throw error;return res.status(201).json(data);
    }
    if(req.method==='GET'){
      const user=await requireUser(req,res);if(!user)return;
      const access=await getAdminAccess(user);
      let query=supabase.from('contact_messages').select('*').order('created_at',{ascending:false});
      if(!access.isOwner&&!access.permissions.includes('reports'))query=query.eq('email',user.email);
      const{data,error}=await query;if(error)throw error;
      return res.status(200).json(await enrichReports(data||[]));
    }
    if(req.method==='PUT'){
      const user=await requireUser(req,res);if(!user)return;
      const access=await getAdminAccess(user);
      const id=Number(req.body?.id);
      if(req.body?.status&&(access.isOwner||access.permissions.includes('reports'))){
        const{data,error}=await supabase.from('contact_messages').update({status:req.body.status}).eq('id',id).select().single();if(error)throw error;return res.status(200).json(data);
      }
      const subject=String(req.body?.subject||'').trim(),message=String(req.body?.message||'').trim();
      if(!subject||message.length<10)return res.status(400).json({error:'موضوع و متن معتبر وارد کنید.'});
      const{data:report,error:findError}=await supabase.from('contact_messages').select('*').eq('id',id).maybeSingle();if(findError)throw findError;
      if(!report||report.email!==user.email)return res.status(403).json({error:'اجازه ویرایش این گزارش را ندارید.'});
      if(Date.now()-new Date(report.created_at).getTime()>EDIT_WINDOW_MS)return res.status(400).json({error:'مهلت ۱۰ دقیقه‌ای ویرایش گزارش به پایان رسیده است.'});
      const{data,error}=await supabase.from('contact_messages').update({subject,message}).eq('id',id).select().single();if(error)throw error;return res.status(200).json(data);
    }
    if(req.method==='DELETE'){
      const user=await getUser(req);if(!user)return res.status(401).json({error:'وارد حساب شوید.'});
      const access=await getAdminAccess(user);
      const id=Number(req.body?.id);
      const{data:report,error:findError}=await supabase.from('contact_messages').select('*').eq('id',id).maybeSingle();if(findError)throw findError;
      if(!report)return res.status(404).json({error:'گزارش پیدا نشد.'});
      if(!access.isOwner&&!access.permissions.includes('reports')){
        if(report.email!==user.email)return res.status(403).json({error:'اجازه حذف این گزارش را ندارید.'});
        if(Date.now()-new Date(report.created_at).getTime()>EDIT_WINDOW_MS)return res.status(400).json({error:'مهلت ۱۰ دقیقه‌ای حذف گزارش به پایان رسیده است.'});
      }
      const{error}=await supabase.from('contact_messages').delete().eq('id',id);if(error)throw error;return res.status(200).json({ok:true});
    }
    return res.status(405).json({error:'Method not allowed'});
  }catch(err){console.error('contact API:',err);return res.status(500).json({error:err.message})}
}
