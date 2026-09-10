import adminPreferences from './_lib/admin-preferences.js';
import adminSession from './_lib/admin-session.js';
import adminStats from './_lib/admin-stats.js';
import admins from './_lib/admins.js';
import analytics from './_lib/analytics.js';
import avatar from './_lib/avatar.js';
import chapterReads from './_lib/chapter-reads.js';
import chapters from './_lib/chapters.js';
import comments from './_lib/comments.js';
import contact from './_lib/contact.js';
import coverUpload from './_lib/cover-upload.js';
import download from './_lib/download.js';
import genres from './_lib/genres.js';
import library from './_lib/library.js';
import manhwaCredits from './_lib/manhwa-credits.js';
import manhwas from './_lib/manhwas.js';
import pins from './_lib/pins.js';
import replies from './_lib/replies.js';
import siteContent from './_lib/site-content.js';
import siteLayout from './_lib/site-layout.js';
import topManhwas from './_lib/top-manhwas.js';
import upload from './_lib/upload.js';
import users from './_lib/users.js';
import views from './_lib/views.js';

const routes = {
  'admin-preferences': adminPreferences,
  'admin-session': adminSession,
  'admin-stats': adminStats,
  admins,
  analytics,
  avatar,
  'chapter-reads': chapterReads,
  chapters,
  comments,
  contact,
  'cover-upload': coverUpload,
  download,
  genres,
  library,
  'manhwa-credits': manhwaCredits,
  manhwas,
  pins,
  replies,
  'site-content': siteContent,
  'site-layout': siteLayout,
  'top-manhwas': topManhwas,
  upload,
  users,
  views,
};

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  const routeParam = req.query.route;
  const routeName = Array.isArray(routeParam) ? routeParam[0] : routeParam;

  const target = routeName ? routes[routeName] : undefined;

  if (!target) {
    return res.status(404).json({ error: `API route not found: /api/${routeName || ''}` });
  }

  return target(req, res);
}
