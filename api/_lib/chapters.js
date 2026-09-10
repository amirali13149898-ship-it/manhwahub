import supabase from './db-client.js';
import { cors, rateLimit, requireAdmin } from './_utils.js';
export default async function handler(req,res){
 if(cors(req,res))return;if(!rateLimit(req,res))return;
 try{
  if(req.method==='GET'){
   let q=supabase.from('chapters').select('*');
   if(req.query?.manhwa_id)q=q.eq('manhwa_id',req.query.manhwa_id).order('chapter_number',{ascending:true});else q=q.order('created_at',{ascending:false});
   if(req.query?.id)q=q.eq('id',req.query.id);if(req.query?.limit)q=q.limit(Math.min(Number(req.query.limit),50));
   const{data,error}=await q;if(error)throw error;
   let rows=data||[];
   if(req.query?.latest==='true'){const seen=new Set();rows=rows.filter(chapter=>{if(seen.has(chapter.manhwa_id))return false;seen.add(chapter.manhwa_id);return true;});}
   const ids=rows.map(chapter=>chapter.id);
   const[{data:files,error:fileError},{data:labels,error:labelError},{data:finals,error:finalError}]=ids.length?await Promise.all([supabase.from('chapter_files').select('chapter_id,chunk_urls').in('chapter_id',ids),supabase.from('chapter_number_labels').select('chapter_id,display_number').in('chapter_id',ids),supabase.from('final_chapters').select('chapter_id').in('chapter_id',ids)]):[{data:[],error:null},{data:[],error:null},{data:[],error:null}];
   if(fileError||labelError||finalError)throw fileError||labelError||finalError;
   const fileMap=new Map((files||[]).map(file=>[file.chapter_id,file.chunk_urls]));
   const labelMap=new Map((labels||[]).map(label=>[label.chapter_id,label.display_number]));
   const finalIds=new Set((finals||[]).map(item=>item.chapter_id));
   return res.status(200).json(rows.map(chapter=>({...chapter,chunk_urls:fileMap.get(chapter.id)||null,display_number:labelMap.get(chapter.id)||String(chapter.chapter_number),is_final:finalIds.has(chapter.id)})));
  }
  if(req.method==='POST'){if(!await requireAdmin(req,res,'uploads'))return;const{data,error}=await supabase.from('chapters').insert(req.body).select().single();if(error)throw error;return res.status(201).json(data)}
  if(req.method==='PUT'){
   const admin=await requireAdmin(req,res,'uploads');if(!admin)return;
   const{id,display_number,...values}=req.body;
   const{data:current,error:currentError}=await supabase.from('chapters').select('*').eq('id',id).maybeSingle();if(currentError)throw currentError;if(!current)return res.status(404).json({error:'چپتر پیدا نشد.'});
   const newNumber=Number(values.chapter_number),numberChanged=Number.isFinite(newNumber)&&newNumber!==Number(current.chapter_number);
   let newSlotId='';
   if(numberChanged){
    const{data:duplicate}=await supabase.from('chapters').select('id').eq('manhwa_id',current.manhwa_id).eq('chapter_number',newNumber).neq('id',id).maybeSingle();
    if(duplicate)return res.status(409).json({error:'این شماره چپتر قبلاً ثبت شده است.'});
    const slotLabel=String(display_number||newNumber).replace('&','-and-');newSlotId=`${current.manhwa_id}:${slotLabel}`;
    const{error:slotError}=await supabase.from('chapter_slots').insert({id:newSlotId,manhwa_id:current.manhwa_id,chapter_number:newNumber,chapter_id:id,created_by:admin.id});
    if(slotError)return res.status(409).json({error:'این شماره هم‌زمان توسط ادمین دیگری انتخاب شده است.'});
   }
   const{data,error}=await supabase.from('chapters').update(values).eq('id',id).select().single();
   if(error){if(newSlotId)await supabase.from('chapter_slots').delete().eq('id',newSlotId);throw error;}
   if(numberChanged)await supabase.from('chapter_slots').delete().eq('id',`${current.manhwa_id}:${Number(current.chapter_number)}`).eq('chapter_id',id);
   if(display_number)await supabase.from('chapter_number_labels').upsert({chapter_id:id,display_number:String(display_number),sort_value:Number(values.chapter_number)},{onConflict:'chapter_id'});
   return res.status(200).json({...data,display_number:display_number||String(data.chapter_number)});
  }
  if(req.method==='DELETE'){
   if(!await requireAdmin(req,res,'uploads'))return;const id=Number(req.body?.id);
   const[{data:chapter},{data:fileInfo}]=await Promise.all([supabase.from('chapters').select('*').eq('id',id).single(),supabase.from('chapter_files').select('*').eq('chapter_id',id).maybeSingle()]);
   if(fileInfo?.chunk_paths?.length)await supabase.storage.from('manhwa-pdfs').remove(fileInfo.chunk_paths);
   else if(chapter?.pdf_url){const marker='/manhwa-pdfs/';const path=chapter.pdf_url.split(marker)[1];if(path)await supabase.storage.from('manhwa-pdfs').remove([decodeURIComponent(path)]);}
   await Promise.all([supabase.from('chapter_files').delete().eq('chapter_id',id),supabase.from('chapter_reads').delete().eq('chapter_id',id),supabase.from('chapter_slots').delete().eq('chapter_id',id),supabase.from('chapter_number_labels').delete().eq('chapter_id',id),supabase.from('final_chapters').delete().eq('chapter_id',id)]);
   const{error}=await supabase.from('chapters').delete().eq('id',id);if(error)throw error;return res.status(200).json({ok:true});
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(err){console.error('chapters API:',err);return res.status(500).json({error:err.message})}
}
