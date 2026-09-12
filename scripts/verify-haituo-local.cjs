const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),runtime=path.resolve(root,'../Haituo-local');
const jwt=require(path.join(root,'node_modules/jsonwebtoken'));
const base='http://127.0.0.1:5288';
const parseEnv=p=>Object.fromEntries(fs.readFileSync(p,'utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
async function login(email,password){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});return {r,data:await r.json(),cookies:r.headers.getSetCookie()};}
function headers(session){const cookie=session.cookies.map(c=>c.split(';')[0]).join('; ');return {'content-type':'application/json',cookie,origin:base,'x-csrf-token':decodeURIComponent(session.cookies.find(c=>c.startsWith('ht_csrf=')).split(';')[0].slice(8))};}
async function main(){
 const password=fs.readFileSync(path.join(runtime,'登录信息.txt'),'utf8').match(/^密码：(.*)$/m)[1];
 const admin=await login('admin@haituo.local',password);assert.equal(admin.r.status,200);assert(admin.cookies.some(c=>c.startsWith('ht_session=')));assert(!admin.cookies.some(c=>c.startsWith('gj_session=')));
 const h=headers(admin);
 assert.equal((await fetch(base+'/api/auth/me',{headers:h})).status,200);
 assert.equal((await login('admin@goodjob.com','goodjob123')).r.status,401);
 assert.equal((await login('admin@haituo.local','wrong-password')).r.status,401);
 const env=parseEnv(path.join(root,'.env')),original=parseEnv(path.resolve(root,'../GoodJob/.env'));
 assert.notEqual(env.JWT_SECRET,original.JWT_SECRET);assert.notEqual(env.DATABASE_URL,original.DATABASE_URL);
 const token=jwt.sign({ver:1},original.JWT_SECRET,{subject:'u_haituo_owner',issuer:'goodjob-crm',audience:'goodjob-crm-web',expiresIn:'5m'});
 assert.equal((await fetch(base+'/api/auth/me',{headers:{authorization:'Bearer '+token}})).status,401);
 const rolesResponse=await fetch(base+'/api/v1/roles',{headers:h});assert.equal(rolesResponse.status,200);const roles=await rolesResponse.json();
 const role=roles.data.find(r=>r.code==='legacy_sales');assert(role,'sales role must exist');
 const users=await (await fetch(base+'/api/v1/members',{headers:h})).json();
 let salesPass, member=users.data.find(u=>u.email==='demo@haituo.local');
 const credentialPath=path.join(runtime,'演示用户.txt');
 if(!member){salesPass='Ht!'+crypto.randomBytes(14).toString('base64url');const r=await fetch(base+'/api/v1/members',{method:'POST',headers:h,body:JSON.stringify({name:'海拓演示业务员',email:'demo@haituo.local',password:salesPass,roleId:role.id,reason:'本机演示验证，管理员开户'})});assert.equal(r.status,200,await r.text());fs.writeFileSync(credentialPath,'账号：demo@haituo.local\n密码：'+salesPass+'\n角色：业务员；由海拓管理员创建。\n');}else{salesPass=fs.readFileSync(credentialPath,'utf8').match(/^密码：(.*)$/m)[1];}
 const sales=await login('demo@haituo.local',salesPass);assert.equal(sales.r.status,200);
 const denied=await fetch(base+'/api/v1/members',{method:'POST',headers:headers(sales),body:JSON.stringify({name:'不得创建',email:'blocked@haituo.local',password:'NotAllowed123!',roleId:role.id})});assert.equal(denied.status,403);
 const noCsrf={...h};delete noCsrf['x-csrf-token'];assert.equal((await fetch(base+'/api/v1/members',{method:'POST',headers:noCsrf,body:'{}'})).status,403);
 const plugin=await fetch(base+'/whatsapp-plugin/api/v1/accounts',{headers:h});assert.equal(plugin.status,200);
 const html=await (await fetch(base)).text();assert(!html.includes('id="loginDemoAccounts"'));assert(html.includes('海拓'));
 const result={checkedAt:new Date().toISOString(),checks:['管理员登录','独立 Cookie','拒绝原版演示账号','拒绝错误密码','数据库和密钥隔离','拒绝原版 JWT','管理员创建业务员','业务员登录','业务员不能开户','CSRF 检查','插件接受海拓会话','移除公共演示账号入口'],status:'passed'};
 fs.writeFileSync(path.join(runtime,'验证结果.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
