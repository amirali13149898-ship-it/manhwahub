import supabase from './db-client.js';
import { cors, rateLimit, requireAdmin, slugify } from './_utils.js';
export default async function handler(req,res){if(cors(req,res))return;if(!rateLimit(req,res))return;try{
 if(req.method==='GET'){
  let q=supabase.from('manhwas').select('*').order('updated_at',{ascending:false});if(req.query?.id)q=q.eq('id',req.query.id);if(req.query?.slug)q=q.eq('slug',req.query.slug);
  const{data,error}=await q;if(error)throw error;const ids=(data||[]).map(item=>item.id);
  const{data:titles,error:titleError}=ids.length?await supabase.from('manhwa_titles').select('*').in('manhwa_id',ids):{data:[],error:null};if(titleError)throw titleError;
  const titleMap=new Map((titles||[]).map(item=>[item.manhwa_id,item.english_title]));let rows=(data||[]).map(item=>({...item,english_title:titleMap.get(item.id)||''}));
  if(req.query?.q){const search=String(req.query.q).toLowerCase();rows=rows.filter(item=>item.title.toLowerCase().includes(search)||item.english_title.toLowerCase().includes(search));}
  return res.status(200).json(rows);
 }
 if(req.method==='POST'){
  if(!await requireAdmin(req,res,'manhwas'))return;const b=req.body||{};if(!b.title||!b.english_title||!b.author||!b.summary||!b.cover_url)return res.status(400).json({error:'نام فارسی، نام انگلیسی، مترجمان، خلاصه و کاور الزامی هستند.'});
  const row={title:b.title.trim(),slug:slugify(b.title),author:b.author.trim(),summary:b.summary.trim(),cover_url:b.cover_url,status:b.status||'در حال انتشار',rating:Number(b.rating)||0,is_featured:Boolean(b.is_featured),genre_ids:b.genre_ids||[],updated_at:new Date().toISOString()};
  const{data,error}=await supabase.from('manhwas').insert(row).select().single();if(error)throw error;const{error:titleError}=await supabase.from('manhwa_titles').insert({manhwa_id:data.id,english_title:String(b.english_title).trim()});if(titleError)throw titleError;return res.status(201).json({...data,english_title:b.english_title});
 }
 if(req.method==='PUT'){
  if(!await requireAdmin(req,res,'manhwas'))return;const b=req.body||{},row={title:b.title,slug:slugify(b.title),author:b.author,summary:b.summary,cover_url:b.cover_url,status:b.status,rating:Number(b.rating),is_featured:Boolean(b.is_featured),genre_ids:b.genre_ids||[],updated_at:new Date().toISOString()};
  const{data,error}=await supabase.from('manhwas').update(row).eq('id',b.id).select().single();if(error)throw error;const{error:titleError}=await supabase.from('manhwa_titles').upsert({manhwa_id:b.id,english_title:String(b.english_title||'').trim(),updated_at:new Date().toISOString()},{onConflict:'manhwa_id'});if(titleError)throw titleError;return res.status(200).json({...data,english_title:b.english_title});
 }
 if(req.method==='DELETE'){
  if(!await requireAdmin(req,res,'manhwas'))return;const id=req.body?.id;for(const table of ['chapters','comments','user_library','manhwa_credits','top_manhwas','manhwa_views','manhwa_titles']){const{error}=await supabase.from(table).delete().eq('manhwa_id',id);if(error)throw error}const{error}=await supabase.from('manhwas').delete().eq('id',id);if(error)throw error;return res.status(200).json({ok:true});
 }
 return res.status(405).json({error:'Method not allowed'});
}catch(err){console.error('manhwas API:',err);return res.status(500).json({error:err.message})}}
