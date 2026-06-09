const{createClient}=require('@supabase/supabase-js');

module.exports=async(req,res)=>{
  if(req.method!=='POST')return res.status(200).send('ok');

  const BT=process.env.BOT_TOKEN;
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
  const ACI=process.env.ADMIN_CHAT_ID;

  async function sm(c,t,o){
    await fetch('https://api.telegram.org/bot'+BT+'/sendMessage',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:c,text:t,parse_mode:'Markdown',...(o||{})})
    });
  }

  const menu=[
    ['📁 Выбрать объект','📋 Текущий объект'],
    ['📸 Отправить фото','🎬 Отправить видео'],
    ['🔔 Уведомления','❓ Помощь']
  ];

  async function getState(chatId){
    const{data}=await sb.from('bot_state').select('project_id').eq('chat_id',String(chatId)).single();
    return data?data.project_id:null;
  }

  async function setState(chatId,pid){
    await sb.from('bot_state').upsert({chat_id:String(chatId),project_id:pid,updated_at:new Date().toISOString()});
  }

  async function getProjName(pid){
    const{data}=await sb.from('projects').select('name').eq('id',pid).single();
    return data?data.name:'?';
  }

  try{
    const u=req.body;

    // === CALLBACK QUERY (выбор объекта) ===
    if(u.callback_query){
      const q=u.callback_query,ci=q.message.chat.id;
      if(q.data.startsWith('proj_')){
        const pid=parseInt(q.data.replace('proj_',''));
        const name=await getProjName(pid);
        await setState(ci,pid);
        await fetch('https://api.telegram.org/bot'+BT+'/answerCallbackQuery',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({callback_query_id:q.id,text:'✅ '+name})
        });
        const{count}=await sb.from('project_photos').select('*',{count:'exact',head:true}).eq('project_id',pid);
        await sm(ci,'✅ *Объект выбран:*\n\n📁 *'+name+'*\n📸 Загружено фото: '+(count||0)+'\n\nТеперь просто отправляйте или пересылайте фото — они попадут в этот объект.',{reply_markup:{keyboard:menu,resize_keyboard:true}});
      }
      return res.status(200).json({ok:1});
    }

    const m=u.message;
    if(!m)return res.status(200).json({ok:1});

    const ci=m.chat.id;
    const tx=m.text||'';
    const nm=m.from.first_name||'Коллега';

    // === КОМАНДЫ ===

    if(tx==='/start'||tx==='❓ Помощь'){
      await sm(ci,
        '👋 Привет, *'+nm+'*!\n\n'+
        'Я бот компании *ТОРАЛС*.\n'+
        'Загружаю фото и видео с объектов на сайт.\n\n'+
        '*Как пользоваться:*\n'+
        '1️⃣ Нажмите «📁 Выбрать объект»\n'+
        '2️⃣ Выберите объект из списка\n'+
        '3️⃣ Отправляйте или пересылайте фото\n'+
        '4️⃣ Они автоматически появятся на сайте\n\n'+
        '💡 _Можно пересылать сразу много фото из чатов — бот обработает все!_',
        {reply_markup:{keyboard:menu,resize_keyboard:true}}
      );
      return res.status(200).json({ok:1});
    }

    if(tx==='📁 Выбрать объект'||tx==='/projects'){
      const{data:pr}=await sb.from('projects').select('id,name,address').eq('status','active').order('created_at',{ascending:false});
      if(!pr||!pr.length){
        await sm(ci,'📁 Активных объектов нет.\nСоздайте объект на сайте или через команду /newproject');
        return res.status(200).json({ok:1});
      }
      const kb=pr.map(p=>[{text:'📁 '+p.name+(p.address?' · '+p.address:''),callback_data:'proj_'+p.id}]);
      await fetch('https://api.telegram.org/bot'+BT+'/sendMessage',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({chat_id:ci,text:'📁 *Выберите объект:*\n\n_Фото будут загружаться в выбранный объект_',parse_mode:'Markdown',reply_markup:{inline_keyboard:kb}})
      });
      return res.status(200).json({ok:1});
    }

    if(tx==='📋 Текущий объект'||tx==='/current'){
      const pid=await getState(ci);
      if(!pid){
        await sm(ci,'⚠️ Объект не выбран.\n\nНажмите «📁 Выбрать объект» чтобы выбрать.');
        return res.status(200).json({ok:1});
      }
      const name=await getProjName(pid);
      const{count}=await sb.from('project_photos').select('*',{count:'exact',head:true}).eq('project_id',pid);
      await sm(ci,'📋 *Текущий объект:*\n\n📁 *'+name+'*\n📸 Фото: '+(count||0)+'\n\n_Отправляйте фото — они попадут сюда_');
      return res.status(200).json({ok:1});
    }

    if(tx==='📸 Отправить фото'||tx==='🎬 Отправить видео'){
      const pid=await getState(ci);
      if(!pid){
        await sm(ci,'⚠️ Сначала выберите объект!\n\nНажмите «📁 Выбрать объект»');
        return res.status(200).json({ok:1});
      }
      const name=await getProjName(pid);
      var emoji=tx.includes('фото')?'📸':'🎬';
      await sm(ci,emoji+' *Жду '+( tx.includes('фото')?'фото':'видео')+' для объекта:*\n📁 *'+name+'*\n\n_Отправьте или перешлите из другого чата.\nМожно несколько за раз!_');
      return res.status(200).json({ok:1});
    }

    if(tx==='🔔 Уведомления'||tx==='/notify'){
      await sm(ci,'🔔 *Уведомления настроены!*\n\nВаш Chat ID: `'+ci+'`\n\nЧтобы получать заявки с сайта, добавьте в Vercel:\n`ADMIN_CHAT_ID = '+ci+'`');
      return res.status(200).json({ok:1});
    }

    if(tx==='/newproject'){
      await sm(ci,'📁 Чтобы создать новый объект, откройте:\n🔗 *torals.pro/upload.html*\n\nИли создайте через смету на сайте.');
      return res.status(200).json({ok:1});
    }

    // === ФОТО ===
    if(m.photo){
      const pid=await getState(ci);
      if(!pid){
        await sm(ci,'⚠️ Сначала выберите объект!\nНажмите «📁 Выбрать объект»',{reply_markup:{keyboard:menu,resize_keyboard:true}});
        return res.status(200).json({ok:1});
      }
      const ph=m.photo[m.photo.length-1];
      const fr=await fetch('https://api.telegram.org/bot'+BT+'/getFile?file_id='+ph.file_id);
      const fd=await fr.json();
      if(fd.ok){
        const fu='https://api.telegram.org/file/bot'+BT+'/'+fd.result.file_path;
        const ir=await fetch(fu);
        const ib=Buffer.from(await ir.arrayBuffer());
        const fn=Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.jpg';
        await sb.storage.from('photo').upload(fn,ib,{contentType:'image/jpeg'});
        const pn=await getProjName(pid);
        await sb.from('project_photos').insert({project_id:pid,filename:fn,original_name:m.caption||'photo.jpg',uploaded_by:nm});
        await sm(ci,'✅ Фото загружено!\n📁 '+pn+(m.caption?'\n📝 '+m.caption:''),{reply_to_message_id:m.message_id});
        if(ACI&&String(ci)!==ACI)await sm(ACI,'📸 *Новое фото*\n📁 '+pn+'\n👤 '+nm);
      }
      return res.status(200).json({ok:1});
    }

    // === ВИДЕО ===
    if(m.video){
      const pid=await getState(ci);
      if(!pid){
        await sm(ci,'⚠️ Сначала выберите объект!\nНажмите «📁 Выбрать объект»',{reply_markup:{keyboard:menu,resize_keyboard:true}});
        return res.status(200).json({ok:1});
      }
      const vid=m.video;
      if(vid.file_size>20*1024*1024){
        await sm(ci,'⚠️ Видео слишком большое (макс 20 МБ)');
        return res.status(200).json({ok:1});
      }
      const fr=await fetch('https://api.telegram.org/bot'+BT+'/getFile?file_id='+vid.file_id);
      const fd=await fr.json();
      if(fd.ok){
        const fu='https://api.telegram.org/file/bot'+BT+'/'+fd.result.file_path;
        const ir=await fetch(fu);
        const ib=Buffer.from(await ir.arrayBuffer());
        const ext=(vid.mime_type||'').split('/')[1]||'mp4';
        const fn=Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.'+ext;
        await sb.storage.from('photo').upload(fn,ib,{contentType:vid.mime_type||'video/mp4'});
        const pn=await getProjName(pid);
        await sb.from('project_photos').insert({project_id:pid,filename:fn,original_name:m.caption||'video.'+ext,uploaded_by:nm});
        await sm(ci,'✅ Видео загружено!\n📁 '+pn,{reply_to_message_id:m.message_id});
        if(ACI&&String(ci)!==ACI)await sm(ACI,'🎬 *Новое видео*\n📁 '+pn+'\n👤 '+nm);
      }
      return res.status(200).json({ok:1});
    }

    // === ДОКУМЕНТ (фото/видео как файл) ===
    if(m.document){
      const doc=m.document;
      const mime=doc.mime_type||'';
      if(!mime.startsWith('image/')&&!mime.startsWith('video/')){
        await sm(ci,'⚠️ Принимаю только фото и видео.');
        return res.status(200).json({ok:1});
      }
      const pid=await getState(ci);
      if(!pid){
        await sm(ci,'⚠️ Сначала выберите объект!\nНажмите «📁 Выбрать объект»');
        return res.status(200).json({ok:1});
      }
      const fr=await fetch('https://api.telegram.org/bot'+BT+'/getFile?file_id='+doc.file_id);
      const fd=await fr.json();
      if(fd.ok){
        const fu='https://api.telegram.org/file/bot'+BT+'/'+fd.result.file_path;
        const ir=await fetch(fu);
        const ib=Buffer.from(await ir.arrayBuffer());
        const ext=(doc.file_name||'').split('.').pop()||'jpg';
        const fn=Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.'+ext;
        await sb.storage.from('photo').upload(fn,ib,{contentType:mime});
        const pn=await getProjName(pid);
        await sb.from('project_photos').insert({project_id:pid,filename:fn,original_name:doc.file_name||'file',uploaded_by:nm});
        await sm(ci,'✅ Файл загружен!\n📁 '+pn,{reply_to_message_id:m.message_id});
      }
      return res.status(200).json({ok:1});
    }

    // === ТЕКСТ ПО УМОЛЧАНИЮ ===
    await sm(ci,'📸 Отправьте фото или видео для загрузки.\n📁 Или выберите объект в меню.',{reply_markup:{keyboard:menu,resize_keyboard:true}});

  }catch(e){
    console.error('Bot error:',e);
  }
  res.status(200).json({ok:1});
};
