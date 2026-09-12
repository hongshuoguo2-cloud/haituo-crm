// Local demo only. Dedicated data, credentials and ports; no upstream account reuse.
const fs=require('fs'),path=require('path'),net=require('net'),crypto=require('crypto');
const {spawn,execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const actualRuntime=path.resolve(root,'../Haituo-local');
fs.mkdirSync(actualRuntime,{recursive:true});
// MySQL on this Windows installation needs an ASCII data path.
const runtime='D:/HaituoRuntime';
if(!fs.existsSync(runtime))fs.symlinkSync(actualRuntime,runtime,'junction');
if(fs.realpathSync(runtime)!==fs.realpathSync(actualRuntime))throw new Error('Haituo runtime alias points to another directory');
const mysqlBinary=process.env.HAITUO_MYSQL_BINARY || 'D:/GoodJobRuntime/mysql-8.4.9-winx64/bin/mysqld.exe';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function listening(port){return new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false));});}
function launch(name,exe,args,cwd,env={}){
 const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
 // WMI creates a hidden Windows process without inheriting the terminal job.
 const command=['"'+exe+'"',...args.map(a=>'"'+a+'"')].join(' ');
 const ps=`$s=([wmiclass]'Win32_ProcessStartup').CreateInstance(); $s.ShowWindow=0; $p=([wmiclass]'Win32_Process').Create(${quote(command)},${quote(cwd)},$s); if($p.ReturnValue -ne 0){throw 'Cannot start local service'}; $p.ProcessId`;
 const pid=Number(execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8'}).trim());
 fs.writeFileSync(path.join(runtime,name+'.pid'),String(pid));return {pid,kill(){process.kill(pid)}};
}
async function ready(port){for(let n=0;n<90;n++){if(await listening(port))return;await wait(500)}throw new Error('Service not ready on '+port);}
async function main(){
 const data=path.join(runtime,'mysql-data');
 if(!fs.existsSync(path.join(data,'auto.cnf'))){
  execFileSync(mysqlBinary,['--no-defaults','--initialize-insecure','--basedir='+path.resolve(mysqlBinary,'../..'),'--datadir='+data,'--console'],{windowsHide:true,stdio:'pipe'});
 }
 if(!await listening(3328)){launch('mysql',mysqlBinary,['--no-defaults','--basedir='+path.resolve(mysqlBinary,'../..'),'--datadir='+data,'--port=3328','--bind-address=127.0.0.1','--mysqlx=OFF','--console'],runtime);await ready(3328);}
 const envPath=path.join(root,'.env');
 const mysql=require(path.join(root,'node_modules/mysql2/promise'));
 if(!fs.existsSync(envPath)){
  const dbPass=crypto.randomBytes(24).toString('hex'),rootPass=crypto.randomBytes(24).toString('hex'),adminPass='Ht!'+crypto.randomBytes(15).toString('base64url');
  const c=await mysql.createConnection({host:'127.0.0.1',port:3328,user:'root'});
  await c.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?",[rootPass]);
  await c.query('CREATE DATABASE haituo_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await c.query("CREATE USER 'haituo'@'localhost' IDENTIFIED BY ?",[dbPass]);
  await c.query("GRANT ALL PRIVILEGES ON haituo_demo.* TO 'haituo'@'localhost'");await c.end();
  let values={};for(const line of fs.readFileSync(path.join(root,'.env.example'),'utf8').split(/\r?\n/)){if(!line||line.startsWith('#')||!line.includes('='))continue;const i=line.indexOf('=');values[line.slice(0,i)]=line.slice(i+1);}
  for(const k of Object.keys(values))if(values[k].startsWith('replace_with_'))values[k]=crypto.randomBytes(36).toString('base64url');
  Object.assign(values,{APP_DATABASE_PROFILE:'production',NODE_ENV:'development',CRM_SEED_DEVELOPMENT_DATA:'false',DATABASE_URL:`mysql://haituo:${dbPass}@127.0.0.1:3328/haituo_demo`,PORT:'4288',INITIAL_ADMIN_EMAIL:'platform@haituo.local',INITIAL_ADMIN_PASSWORD:adminPass,INITIAL_ADMIN_NAME:'海拓平台管理员',MYSQL_TEST_ADMIN_URL:'',MYSQL_TEST_APP_URL:'',CORS_ORIGINS:'http://127.0.0.1:5288',COMMUNICATION_API_ORIGIN:'http://127.0.0.1:3200',WHATSAPP_PLUGIN_INTERNAL_URL:'http://127.0.0.1:3200',WHATSAPP_PLUGIN_PORT:'3200',EMAIL_TRACKING_BASE_URL:'http://127.0.0.1:5288',EMAIL_MESSAGE_ID_DOMAIN:'localhost',GOODJOB_DATA_DIR:runtime,GOODJOB_APP_DIR:root,GOODJOB_MIRROR_URL:'',INBOUND_MAIL_ENABLED:'false'});
  fs.writeFileSync(envPath,Object.entries(values).map(([k,v])=>k+'='+v).join('\n'));
  fs.writeFileSync(path.join(root,'whatsapp-plugin/.env'),Object.entries({HOST:'127.0.0.1',PORT:'3200',WEB_ORIGIN:'http://127.0.0.1:5288',CRM_JWT_SECRET:values.JWT_SECRET,DATABASE_CLIENT:'mysql',DATABASE_URL:values.DATABASE_URL,SESSION_MASTER_KEY:crypto.randomBytes(32).toString('base64'),AUTO_MIGRATE:'true',SEED_DEMO:'false',ALLOW_DEMO_PROVIDER:'false',MEDIA_STORAGE_PATH:path.join(runtime,'media')}).map(([k,v])=>k+'='+v).join('\n'));
  fs.writeFileSync(path.join(runtime,'database-admin.json'),JSON.stringify({user:'root',password:rootPass,port:3328}));
 }
 const env=Object.fromEntries(fs.readFileSync(envPath,'utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
 let api;
 if(!await listening(4288)){api=launch('crm-api',process.execPath,[path.join(root,'node_modules/tsx/dist/cli.mjs'),'src/server.ts'],path.join(root,'backend'),env);await ready(4288);}
 if(!fs.existsSync(path.join(runtime,'account-ready'))){
  if(!api)throw new Error('Fresh account setup needs this launcher to own the API process.');
  api.kill();await wait(1500);
  const c=await mysql.createConnection(env.DATABASE_URL);
  const password='Ht!'+crypto.randomBytes(15).toString('base64url'),salt=crypto.randomBytes(16);
  const hash='scrypt$'+salt.toString('base64url')+'$'+crypto.scryptSync(password,salt,64).toString('base64url');
  await c.execute('INSERT INTO users (id,name,email,password_hash,role,team_id,avatar,status,auth_version) VALUES (?,?,?,?,?,?,?,?,?)',['u_haituo_owner','海拓管理员','admin@haituo.local',hash,'admin','haituo-demo','HT','active',1]);await c.end();
  fs.writeFileSync(path.join(runtime,'登录信息.txt'),`海拓 · 独立演示版\n网址：http://127.0.0.1:5288/\n日常管理员账号：admin@haituo.local\n密码：${password}\n\n账号为本机登录标识，无需真实邮箱。进入系统后可在成员管理中开户。\n平台维护账号：${env.INITIAL_ADMIN_EMAIL}\n密码：${env.INITIAL_ADMIN_PASSWORD}\n平台账号仍需绑定验证器。\n请勿公开本文件或将运行目录上传到代码仓库。\n`);
  fs.writeFileSync(path.join(runtime,'account-ready'),'ready');
  launch('crm-api',process.execPath,[path.join(root,'node_modules/tsx/dist/cli.mjs'),'src/server.ts'],path.join(root,'backend'),env);await ready(4288);
 }
 if(!await listening(5288)){launch('crm-web',process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5288','--strictPort'],path.join(root,'frontend'));await ready(5288);}
 if(!await listening(3200)){launch('whatsapp-api',process.execPath,[path.join(root,'whatsapp-plugin/node_modules/tsx/dist/cli.mjs'),'src/server/index.ts'],path.join(root,'whatsapp-plugin'));await ready(3200);}
 if(!await listening(5293)){launch('whatsapp-web',process.execPath,[path.join(root,'whatsapp-plugin/node_modules/vite/bin/vite.js'),'--host','127.0.0.1'],path.join(root,'whatsapp-plugin'));await ready(5293);}
 console.log('Haituo ready: http://127.0.0.1:5288/');
}
main().then(async()=>{
 if(process.argv.includes('--watch')){
  for(;;){await wait(30000);await main().catch(e=>console.error(e.message));}
 }
}).catch(e=>{console.error(e.message);process.exitCode=1});
