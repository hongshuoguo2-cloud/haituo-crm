import fs from 'node:fs';
const account=JSON.parse(fs.readFileSync('F:/GoodJob/personal/config/personal-account.json','utf8'));
const origin='http://127.0.0.1:4189';
const login=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(account)});
const session=await login.json();
if(!login.ok || !session.token) throw Error(`Login failed: ${login.status} ${session.message||'no token'}`);
async function api(path,method='GET',data){
 const r=await fetch(origin+path,{method,headers:{Authorization:`Bearer ${session.token}`,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const body=await r.json(); if(!r.ok) throw Error(`${path}: ${r.status} ${body.message||''}`); return body;
}
const statePath='F:/GoodJob/work/verification.json';
if(process.argv[2]==='create'){
 const customer=await api('/api/customers','POST',{company:'本机部署验证客户（测试）',country:'中国',contact:'测试联系人',source:'本机持久化验收'});
 const todo=await api('/api/todos','POST',{title:'本机持久化验收（测试）',customerId:customer.customer.id,type:'customer'});
 fs.writeFileSync(statePath,JSON.stringify({customerId:customer.customer.id,todoId:todo.todo.id}));
 console.log('PASS: personal login, create customer, create related todo');
} else {
 const ids=JSON.parse(fs.readFileSync(statePath,'utf8'));
 const customer=await api('/api/customers'); const todos=await api('/api/todos');
 if(!JSON.stringify(customer).includes(ids.customerId)||!JSON.stringify(todos).includes(ids.todoId)) throw Error('Persistence verification failed');
 await api(`/api/customers/${ids.customerId}`,'PATCH',{contact:'重启后更新成功'});
 console.log('PASS: records persisted across full restart and customer edit works');
}
const demo=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@goodjob.com',password:'goodjob123'})});
if(demo.status!==401) throw Error('Demo account must be unavailable');
console.log('PASS: public demo credentials rejected');
