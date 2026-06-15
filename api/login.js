const{createClient}=require('@supabase/supabase-js');

module.exports=async(req,res)=>{
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});

  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
  const{login,password}=req.body||{};

  if(!login||!password)return res.status(400).json({error:'Введите логин и пароль'});

  // Проверка через service key (секретный, на сервере)
  const{data,error}=await sb.from('users')
    .select('id,login,display_name,role')
    .eq('login',String(login).trim().toLowerCase())
    .eq('password',password)
    .single();

  if(error||!data){
    return res.status(401).json({error:'Неверный логин или пароль'});
  }

  // Возвращаем данные пользователя БЕЗ пароля
  res.json({
    ok:true,
    user:{
      id:data.id,
      login:data.login,
      display_name:data.display_name,
      role:data.role
    }
  });
};
