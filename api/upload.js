import supabase from './db-client.js';
import { cors, rateLimit, requireAdmin } from './_utils.js';
import { randomUUID } from 'node:crypto';
const MAX=200*1024*1024;
const MAX_CHUNK=10*1024*1024;
const clean=name=>String(name||'file.pdf').replace(/[^a-zA-Z0-9._-]/g,'-').slice(-120);
const parseChapterLabel=value=>{const text=String(value||'').trim(),special=text.match(/^(\d+(?:\.\d+)?)\s*&\s*(\d+(?:\.\d+)?)$/);if(special){const left=Number(special[1]),right=Number(special[2]);if(left>=0&&right>left)return{display:`${special[1]}&${special[2]}`,sort:(left+right)/2};return null}const number=Number(text);return Number.isFinite(number)&&number>0?{display:text,sort:number}:null};

async function storedFile(path){
  const parts=String(path).split('/');
  const name=parts.pop();
  const folder=parts.join('/');
  const{data,error}=await supabase.storage.from('manhwa-pdfs').list(folder,{search:name,limit:10});
  if(error)throw error;
  return data?.find(item=>item.name===name);
}

export default async function handler(req,res){
  if(cors(req,res,'POST, OPTIONS'))return;
  if(!rateLimit(req,res,500))return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const admin=await requireAdmin(req,res,'uploads');if(!admin)return;
    const b=req.body||{};
    if(b.action==='sign'||b.action==='signChunk'){
      const size=Number(b.action==='signChunk'?b.chunkSize:b.fileSize);
      const originalSize=Number(b.fileSize);
      if(b.contentType!=='application/pdf'||!String(b.fileName).toLowerCase().endsWith('.pdf'))return res.status(400).json({error:'فقط فایل PDF مجاز است.'});
      if(!Number.isFinite(originalSize)||originalSize<=0||originalSize>MAX)return res.status(400).json({error:'حجم هر PDF باید حداکثر دقیق ۲۰۰ مگابایت باشد.'});
      if(b.action==='signChunk'&&(!Number.isFinite(size)||size<=0||size>MAX_CHUNK))return res.status(400).json({error:'اندازه قطعه آپلود نامعتبر است.'});
      const path=b.action==='signChunk'?`${Number(b.manhwaId)}/chunks/${clean(b.uploadId)}/${Number(b.chunkIndex)}.part`:`${Number(b.manhwaId)}/${randomUUID()}-${clean(b.fileName)}`;
      const{data,error}=await supabase.storage.from('manhwa-pdfs').createSignedUploadUrl(path,b.action==='signChunk'?{upsert:true}:undefined);
      if(error)throw error;
      return res.status(200).json({path,token:data.token,signedUrl:data.signedUrl});
    }
    if(b.action==='finalize'||b.action==='finalizeChunks'){
      const declared=Number(b.fileSize);
      if(!Number.isFinite(declared)||declared<=0||declared>MAX)throw new Error('فایل بزرگ‌تر از ۲۰۰ مگابایت است.');
      const paths=b.action==='finalizeChunks'?(Array.isArray(b.paths)?b.paths:[]):[b.path];
      if(!paths.length||paths.length>30||paths.some(path=>!String(path).startsWith(`${Number(b.manhwaId)}/`)))throw new Error('فهرست قطعات معتبر نیست.');
      const chapterLabel=parseChapterLabel(b.chapterLabel??b.chapterNumber);
      if(!chapterLabel){await supabase.storage.from('manhwa-pdfs').remove(paths);return res.status(400).json({error:'شماره چپتر معتبر نیست؛ نمونه صحیح: ۲ یا ۲&۳'});}
      const manhwaId=Number(b.manhwaId),chapterNumber=chapterLabel.sort,slotId=`${manhwaId}:${chapterLabel.display.replace('&','-and-')}`;
      const{data:duplicate}=await supabase.from('chapters').select('id').eq('manhwa_id',manhwaId).eq('chapter_number',chapterNumber).maybeSingle();
      if(duplicate){await supabase.storage.from('manhwa-pdfs').remove(paths);return res.status(409).json({error:'این شماره چپتر قبلاً برای مانهوا ثبت شده است.'});}
      const storedParts=await Promise.all(paths.map(path=>storedFile(path)));
      if(storedParts.some(part=>!part))throw new Error('بخشی از فایل آپلود نشده است؛ همان فایل را دوباره انتخاب کنید تا ادامه پیدا کند.');
      const actual=storedParts.reduce((sum,stored)=>sum+Number(stored?.metadata?.size||stored?.metadata?.contentLength||0),0);
      if(actual>MAX){await supabase.storage.from('manhwa-pdfs').remove(paths);throw new Error('حجم فایل بیش از ۲۰۰ مگابایت است.');}
      const{error:slotError}=await supabase.from('chapter_slots').insert({id:slotId,manhwa_id:manhwaId,chapter_number:chapterNumber,created_by:admin.id});
      if(slotError){await supabase.storage.from('manhwa-pdfs').remove(paths);return res.status(409).json({error:'این چپتر هم‌زمان توسط ادمین دیگری در حال ثبت است.'});}
      const urls=paths.map(path=>supabase.storage.from('manhwa-pdfs').getPublicUrl(path).data.publicUrl);
      const row={manhwa_id:manhwaId,title:`چپتر ${chapterLabel.display}`,chapter_number:chapterNumber,pdf_url:urls[0],page_count:0,quality:'HD',file_name:String(b.fileName),file_size:actual||declared};
      const{data,error}=await supabase.from('chapters').insert(row).select().single();
      if(error){await supabase.from('chapter_slots').delete().eq('id',slotId);throw error;}
      await supabase.from('chapter_slots').update({chapter_id:data.id}).eq('id',slotId);
      await supabase.from('chapter_number_labels').upsert({chapter_id:data.id,display_number:chapterLabel.display,sort_value:chapterNumber},{onConflict:'chapter_id'});
      if(paths.length>1){const{error:fileError}=await supabase.from('chapter_files').insert({chapter_id:data.id,chunk_urls:urls,chunk_paths:paths,total_size:actual||declared});if(fileError)throw fileError;}
      if(Boolean(b.isEnd)){await supabase.from('final_chapters').delete().eq('manhwa_id',manhwaId);const{error:endError}=await supabase.from('final_chapters').insert({chapter_id:data.id,manhwa_id:manhwaId});if(endError)throw endError;}
      await supabase.from('manhwas').update({updated_at:new Date().toISOString()}).eq('id',manhwaId);
      return res.status(201).json(data);
    }
    return res.status(400).json({error:'عملیات آپلود نامعتبر است.'});
  }catch(err){console.error('upload API:',err);return res.status(500).json({error:err.message})}
}
