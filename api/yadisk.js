const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  
  // GET - list files from Yandex Disk public folder
  if (req.method === 'GET') {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL обязателен' });
    
    try {
      const apiUrl = 'https://cloud-api.yandex.net/v1/disk/public/resources?public_key=' + encodeURIComponent(url) + '&limit=200&fields=_embedded.items.name,_embedded.items.file,_embedded.items.mime_type,_embedded.items.size';
      const r = await fetch(apiUrl);
      const data = await r.json();
      
      if (!data._embedded || !data._embedded.items) {
        return res.json({ files: [], name: data.name || '' });
      }
      
      const files = data._embedded.items
        .filter(f => f.mime_type && (f.mime_type.startsWith('image/') || f.mime_type.startsWith('video/')))
        .map(f => ({ name: f.name, url: f.file, mime: f.mime_type, size: f.size }));
      
      res.json({ files, name: data.name || 'Папка' });
    } catch(e) {
      res.status(500).json({ error: 'Ошибка: ' + e.message });
    }
    return;
  }
  
  // POST - download file from URL and upload to Supabase Storage
  if (req.method === 'POST') {
    const { fileUrl, fileName, projectId, uploadedBy, mime } = req.body;
    if (!fileUrl || !projectId) return res.status(400).json({ error: 'Нужен URL и projectId' });
    
    try {
      const r = await fetch(fileUrl);
      if (!r.ok) throw new Error('Download failed: ' + r.status);
      
      const buf = Buffer.from(await r.arrayBuffer());
      const ext = fileName ? fileName.split('.').pop() : 'jpg';
      const fname = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      
      const { error } = await sb.storage.from('photo').upload(fname, buf, {
        contentType: mime || 'image/jpeg'
      });
      
      if (error) throw error;
      
      await sb.from('project_photos').insert({
        project_id: projectId,
        filename: fname,
        original_name: fileName || 'photo.' + ext,
        uploaded_by: uploadedBy || 'Яндекс.Диск'
      });
      
      res.json({ ok: true, filename: fname });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }
  
  res.status(405).json({ error: 'Method not allowed' });
};
