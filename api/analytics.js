import supabase from './db-client.js';
import { cors, getUser, rateLimit, requireAdmin } from './_utils.js';

const TYPES = ['site_view', 'manhwa_read', 'manhwa_download', 'manhwa_view'];
const DASHBOARD_TYPES = [...TYPES, 'manhwa_summary'];
const TEHRAN_OFFSET = '+03:30';
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const WEEK_ORDER = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

const parts = (date, calendar = 'gregory') => Object.fromEntries(new Intl.DateTimeFormat(`en-US-u-ca-${calendar}`, { timeZone: 'Asia/Tehran', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long', hour: 'numeric', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
const localMidnight = date => { const p = parts(date); return new Date(`${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T00:00:00${TEHRAN_OFFSET}`); };
const percent = (current, previous) => previous === 0 ? (current ? 100 : 0) : Math.round((current - previous) / previous * 100);

function weekStart(date = new Date()) {
  const midnight = localMidnight(date);
  const weekday = WEEKDAYS.indexOf(parts(date).weekday === 'Sunday' ? 'یکشنبه' : parts(date).weekday === 'Monday' ? 'دوشنبه' : parts(date).weekday === 'Tuesday' ? 'سه‌شنبه' : parts(date).weekday === 'Wednesday' ? 'چهارشنبه' : parts(date).weekday === 'Thursday' ? 'پنجشنبه' : parts(date).weekday === 'Friday' ? 'جمعه' : 'شنبه');
  const saturdayIndex = (weekday + 1) % 7;
  return new Date(midnight.getTime() - saturdayIndex * 86400000);
}

function persianYear(date = new Date()) { return Number(parts(date, 'persian').year); }
function findPersianYearStart(targetYear) {
  const approx = new Date(Date.UTC(targetYear + 620, 1, 15));
  for (let i = 0; i < 90; i++) { const date = new Date(approx.getTime() + i * 86400000); const p = parts(date, 'persian'); if (Number(p.year) === targetYear && Number(p.month) === 1 && Number(p.day) === 1) return localMidnight(date); }
  return new Date(Date.UTC(targetYear + 621, 2, 20, 20, 30));
}

async function fetchEvents(type, start, end) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('analytics_events').select('*').eq('event_type', type).gte('created_at', start.toISOString()).lt('created_at', end.toISOString()).order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

export default async function handler(req, res) {
  if (cors(req, res, 'GET, POST, OPTIONS')) return;
  if (!rateLimit(req, res, 240)) return;
  try {
    if (req.method === 'POST') {
      const eventType = String(req.body?.event_type || '');
      if (!TYPES.includes(eventType)) return res.status(400).json({ error: 'نوع رویداد معتبر نیست.' });
      const manhwaId = req.body?.manhwa_id ? Number(req.body.manhwa_id) : null;
      if (eventType !== 'site_view' && !manhwaId) return res.status(400).json({ error: 'شناسه مانهوا الزامی است.' });
      const user = await getUser(req);
      const { data, error } = await supabase.from('analytics_events').insert({ event_type: eventType, manhwa_id: manhwaId, user_id: user?.id || null }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    if (req.method === 'GET') {
      if (!await requireAdmin(req, res, 'dashboard')) return;
      const requestedType = DASHBOARD_TYPES.includes(String(req.query?.type)) ? String(req.query.type) : 'site_view';
      const type = requestedType === 'manhwa_summary' ? 'manhwa_view' : requestedType;
      const weekOffset = Math.max(0, Math.min(52, Number(req.query?.week_offset) || 0));
      const yearOffset = Math.max(0, Math.min(10, Number(req.query?.year_offset) || 0));
      const now = new Date(), todayStart = localMidnight(now), tomorrow = new Date(todayStart.getTime() + 86400000);
      const selectedWeek = new Date(weekStart(now).getTime() - weekOffset * 7 * 86400000), previousWeek = new Date(selectedWeek.getTime() - 7 * 86400000), weekEnd = new Date(selectedWeek.getTime() + 7 * 86400000);
      const selectedPersianYear = persianYear(now) - yearOffset, yearStart = findPersianYearStart(selectedPersianYear), yearEnd = findPersianYearStart(selectedPersianYear + 1), previousYearStart = findPersianYearStart(selectedPersianYear - 1);
      const [hourEvents, weekEvents, yearEvents] = await Promise.all([fetchEvents(type, todayStart, tomorrow), fetchEvents(type, previousWeek, weekEnd), fetchEvents(type, previousYearStart, yearEnd)]);
      const hourly = Array.from({ length: 24 }, (_, hour) => ({ label: String(hour), value: hourEvents.filter(event => Number(parts(new Date(event.created_at)).hour) === hour).length }));
      const weekly = WEEK_ORDER.map(label => ({ label, value: weekEvents.filter(event => { const time = new Date(event.created_at).getTime(); return time >= selectedWeek.getTime() && time < weekEnd.getTime() && (parts(new Date(event.created_at)).weekday === 'Saturday' ? 'شنبه' : parts(new Date(event.created_at)).weekday === 'Sunday' ? 'یکشنبه' : parts(new Date(event.created_at)).weekday === 'Monday' ? 'دوشنبه' : parts(new Date(event.created_at)).weekday === 'Tuesday' ? 'سه‌شنبه' : parts(new Date(event.created_at)).weekday === 'Wednesday' ? 'چهارشنبه' : parts(new Date(event.created_at)).weekday === 'Thursday' ? 'پنجشنبه' : 'جمعه') === label; }).length }));
      const monthly = MONTHS.map((label, index) => ({ label, value: yearEvents.filter(event => { const p = parts(new Date(event.created_at), 'persian'); return Number(p.year) === selectedPersianYear && Number(p.month) === index + 1; }).length }));
      const currentWeekCount = weekEvents.filter(event => new Date(event.created_at) >= selectedWeek).length, previousWeekCount = weekEvents.length - currentWeekCount;
      const currentYearCount = yearEvents.filter(event => new Date(event.created_at) >= yearStart).length, previousYearCount = yearEvents.filter(event => new Date(event.created_at) >= previousYearStart && new Date(event.created_at) < yearStart).length;
      let byManhwa = [];
      if (type === 'manhwa_view') { const rangeStart=new Date(0),rangeEnd=new Date(Date.now()+86400000);const [{ data: manhwas },allViews,downloadEvents] = await Promise.all([supabase.from('manhwas').select('id,title'),requestedType === 'manhwa_summary' ? fetchEvents('manhwa_view',rangeStart,rangeEnd) : Promise.resolve(yearEvents.filter(event => new Date(event.created_at) >= yearStart)),requestedType === 'manhwa_summary' ? fetchEvents('manhwa_download',rangeStart,rangeEnd) : Promise.resolve([])]); const counts = new Map(),downloads = new Map();allViews.forEach(event => counts.set(event.manhwa_id, (counts.get(event.manhwa_id) || 0) + 1));downloadEvents.forEach(event => downloads.set(event.manhwa_id, (downloads.get(event.manhwa_id) || 0) + 1));byManhwa = (manhwas || []).map(manhwa => ({ manhwa_id: manhwa.id, title: manhwa.title, value: counts.get(manhwa.id) || 0, views: counts.get(manhwa.id) || 0, downloads: downloads.get(manhwa.id) || 0 })).sort((a, b) => (b.views + b.downloads) - (a.views + a.downloads)); }
      return res.status(200).json({ hourly, weekly, monthly, week_label: weekOffset === 0 ? 'این هفته' : `${weekOffset} هفته قبل`, year_label: `سال ${selectedPersianYear}`, comparison: { week: percent(currentWeekCount, previousWeekCount), current_week: currentWeekCount, previous_week: previousWeekCount, year: percent(currentYearCount, previousYearCount), current_year: currentYearCount, previous_year: previousYearCount }, by_manhwa: byManhwa });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('analytics API:', err);
    return res.status(500).json({ error: err.message });
  }
}
