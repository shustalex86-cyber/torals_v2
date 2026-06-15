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
    ['📁 Выбрать объект','➕ Новый объект'],
    ['📋 Текущий объект','💬 Комментарий'],
    ['🔔 Уведомления','❓ Помощь']
  ];

  async function getState(chatId){
    const{data}=await sb.from('bot_state').select('*').eq('chat_id',String(chatId)).single();
    return data||{project_id:null,awaiting:null,comment:null};
  }
  async function setState(chatId,fields){
    await sb.from('bot_state').upsert({chat_id:String(chatId),updated_at:new Date().toISOString(),...fields});
  }
  async function getProjName(pid){
    const{data}=await sb.from('projects').select('name').eq('id',pid).single();
    return data?data.name:'?';
  }

  async function saveMedia(fileId,ext,mime,pid,caption,uploader){
    const fr=await fetch('https://api.telegram.org/bot'+BT+'/getFile?file_id='+fileId);
    const fd=await fr.json();
    if(!fd.ok)return false;
    const fu='https://api.telegram.org/file/bot'+BT+'/'+fd.result.file_path;
    const ir=await fetch(fu);
    const ib=Buffer.from(await ir.arrayBuffer());
    const fn=Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.'+ext;
    await sb.storage.from('photo').upload(fn,ib,{contentType:mime});
    await sb.from('project_photos').insert({project_id:pid,filename:fn,original_name:caption||('file.'+ext),uploaded_by:uploader});
    return true;
  }

  try{
    const u=req.body;

    if(u.callback_query){
      const q=u.callback_query,ci=q.message.chat.id;
      if(q.data.startsWith('proj_')){
        const pid=parseInt(q.data.replace('proj_',''));
        const name=await getProjName(pid);
        await setState(ci,{project_id:pid,awaiting:null});
        await fetch('https://api.telegram.org/bot'+BT+'/answerCallbackQuery',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({callback_query_id:q.id,text:'✅ '+name})
        });
        const{count}=await sb.from('project_photos').select('*',{count:'exact',head:true}).eq('project_id',pid);
        await sm(ci,'✅ *Объект выбран:*\n\n📁 *'+name+'*\n📸 Загружено фото: '+(count||0)+'\n\nТеперь отправляйте фото и видео — они попадут в этот объект.',{reply_markup:{keyboard:menu,resize_keyboard:true}});
      }
      return res.status(200).json({ok:1});
    }

    const m=u.message;
    if(!m)return res.status(200).json({ok:1});

    const ci=m.chat.id;
    const tx=m.text||'';
    const nm=m.from.first_name||'Коллега';
    const st=await getState(ci);

    if(st.awaiting==='new_project_name'&&tx&&!tx.startsWith('/')){
      const{data,error}=await sb.from('projects').insert({name:tx.trim(),status:'active'}).select().single();
      if(error||!data){
        await sm(ci,'❌ Ошибка создания. Попробуйте ещё раз.');
        await setState(ci,{awaiting:null});
        return res.status(200).json({ok:1});
      }
      await setState(ci,{project_id:data.id,awaiting:null});
      await sm(ci,'✅ *Объект создан и выбран!*\n\n📁 *'+tx.trim()+'*\n\nТеперь отправляйте фото — они попадут сюда.\nИзменить детали (категория, статус, обложка) можно на сайте: torals.pro/upload.html',{reply_markup:{keyboard:menu,resize_keyboard:true}});
      return res.status(200).json({ok:1});
    }

    if(st.awaiting==='comment'&&tx&&!tx.startsWith('/')){
      await setState(ci,{comment:tx.trim(),awaiting:null});
      const pn=st.project_id?await getProjName(st.project_id):'—';
      await sm(ci,'💬 *Комментарий сохранён:*\n_'+tx.trim()+'_\n\nОн добавится к следующим фото для объекта *'+pn+'*.\nОтправляйте фото!',{reply_markup:{keyboard:menu,resize_keyboard:true}});
      return res.status(200).json({ok:1});
    }

    if(tx==='/start'||tx==='❓ Помощь'){
      await setState(ci,{awaiting:null});
      await sm(ci,
        '👋 Привет, *'+nm+'*!\n\n'+
        'Я бот компании *ТОРАЛС*.\n'+
        'Загружаю фото и видео с объектов на сайт.\n\n'+
        '*Как пользоваться:*\n'+
        '📁 «Выбрать объект» — выбрать из списка\n'+
        '➕ «Новый объект» — создать прямо здесь\n'+
        '📋 «Текущий объект» — куда грузятся фото\n'+
        '💬 «Комментарий» — подпись к фото\n\n'+
        'После выбора объекта — просто отправляйте или пересылайте фото. Можно сразу много!',
        {reply_markup:{keyboard:menu,resize_keyboard:true}}
      );
      return res.status(200).json({ok:1});
    }

    if(tx==='➕ Новый объект'||tx==='/newproject'){
      await setState(ci,{awaiting:'new_project_name'});
      await sm(ci,'➕ *Создание нового объекта*\n\nНапишите название объекта одним сообщением.\n\n_Например: «Квартира ЖК Самолёт» или «Офис на Красной»_\n\nДля отмены нажмите ❓ Помощь');
      return res.status(200).json({ok:1});
    }

    if(tx==='💬 Комментарий'||tx==='/comment'){
      if(!st.project_id){
        await sm(ci,'⚠️ Сначала выберите объект!');
        return res.status(200).json({ok:1});
      }
      await setState(ci,{awaiting:'comment'});
      await sm(ci,'💬 *Добавить комментарий*\n\nНапишите подпись, которая добавится к следующим фото.\n\n_Например: «Монтаж щита, 2 этаж»_');
      return res.status(200).json({ok:1});
    }

    if(tx==='📁 Выбрать объект'||tx==='/projects'){
      await setState(ci,{awaiting:null});
      const{data:pr}=await sb.from('projects').select('id,name,address').eq('status','active').order('created_at',{ascending:false});
      if(!pr||!pr.length){
        await sm(ci,'📁 Активных объектов нет.\nСоздайте новый кнопкой «➕ Новый объект»');
        return res.status(200).json({ok:1});
      }
      const kb=pr.map(p=>[{text:'📁 '+p.name+(p.address?' · '+p.address:''),callback_data:'proj_'+p.id}]);
      await fetch('https://api.telegram.org/bot'+BT+'/sendMessage',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({chat_id:ci,text:'📁 *Выберите объект:*',parse_mode:'Markdown',reply_markup:{inline_keyboard:kb}})
      });
      return res.status(200).json({ok:1});
    }

    if(tx==='📋 Текущий объект'||tx==='/current'){
      if(!st.project_id){
        await sm(ci,'⚠️ Объект не выбран.\nНажмите «📁 Выбрать объект» или «➕ Новый объект».');
        return res.status(200).json({ok:1});
      }
      const name=await getProjName(st.project_id);
      const{count}=await sb.from('project_photos').select('*',{count:'exact',head:true}).eq('project_id',st.project_id);
      var msg='📋 *Текущий объект:*\n\n📁 *'+name+'*\n📸 Фото: '+(count||0);
      if(st.comment)msg+='\n💬 Комментарий: _'+st.comment+'_';
      msg+='\n\n_Отправляйте фото — они попадут сюда_';
      await sm(ci,msg);
      return res.status(200).json({ok:1});
    }

    if(tx==='🔔 Уведомления'||tx==='/notify'){
      await sm(ci,'🔔 *Уведомления*\n\nВаш Chat ID: `'+ci+'`\n\nЧтобы получать заявки с сайта, добавьте в Vercel:\n`ADMIN_CHAT_ID = '+ci+'`');
      return res.status(200).json({ok:1});
    }

    if(m.photo){
      if(!st.project_id){
        await sm(ci,'⚠️ Сначала выберите объект!\nНажмите «📁 Выбрать объект» или «➕ Новый объект»',{reply_markup:{keyboard:menu,resize_keyboard:true}});
        return res.status(200).json({ok:1});
      }
      const ph=m.photo[m.photo.length-1];
      const cap=m.caption||st.comment||null;
      const ok=await saveMedia(ph.file_id,'jpg','image/jpeg',st.project_id,cap,nm);
      if(ok){
        const pn=await getProjName(st.project_id);
        await sm(ci,'✅ Фото загружено!\n📁 '+pn+(cap?'\n💬 '+cap:''),{reply_to_message_id:m.message_id});
        if(ACI&&String(ci)!==ACI)await sm(ACI,'📸 *Новое фото*\n📁 '+pn+'\n👤 '+nm+(cap?'\n💬 '+cap:''));
      }else{
        await sm(ci,'❌ Ошибка загрузки. Попробуйте ещё раз.');
      }
      return res.status(200).json({ok:1});
    }

    if(m.video){
      await sm(ci,'📸 Сейчас принимаются только фото.\nЗагрузка видео временно отключена.',{reply_markup:{keyboard:menu,resize_keyboard:true}});
      return res.status(200).json({ok:1});
    }

    if(m.document){
      const mime=m.document.mime_type||'';
      if(!mime.startsWith('image/')){
        await sm(ci,'📸 Принимаются только фото (JPG, PNG).');
        return res.status(200).json({ok:1});
      }
      if(!st.project_id){
        await sm(ci,'⚠️ Сначала выберите объект!');
        return res.status(200).json({ok:1});
      }
      const ext=(m.document.file_name||'').split('.').pop()||'jpg';
      const cap=m.caption||st.comment||null;
      const ok=await saveMedia(m.document.file_id,ext,mime,st.project_id,cap||m.document.file_name,nm);
      if(ok){
        const pn=await getProjName(st.project_id);
        await sm(ci,'✅ Файл загружен!\n📁 '+pn,{reply_to_message_id:m.message_id});
      }
      return res.status(200).json({ok:1});
    }

    await sm(ci,'📸 Отправьте фото или видео.\n📁 Или выберите объект в меню.',{reply_markup:{keyboard:menu,resize_keyboard:true}});

  }catch(e){
    console.error('Bot error:',e);
  }
  res.status(200).json({ok:1});
};
