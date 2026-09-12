// Isolated MySQL + HTTP + browser regression. Supply a local test-admin URL explicitly.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const mysql = require('mysql2/promise'), jwt = require('jsonwebtoken');
const root = path.resolve(__dirname, '..');
const suffix = crypto.randomBytes(6).toString('hex');
const db = 'haituo_accounts_test_' + suffix, dbUser = 'htacct_' + suffix;
const temp = path.resolve(root, '../Haituo-local/account-test-' + suffix);
const secret = () => crypto.randomBytes(32).toString('hex');
const wait = ms => new Promise(r => setTimeout(r, ms));
let control, child, browser, createdDb = false, createdUser = false;
const checks = [];
function ok(value, label) { if (!value) throw new Error(label); checks.push(label); }
async function main() {
  const adminUrl = new URL(process.env.HAITUO_TEST_ADMIN_URL || '');
  if (!['127.0.0.1', 'localhost'].includes(adminUrl.hostname)) throw new Error('Tests require an explicitly supplied LOCAL MySQL admin URL');
  control = await mysql.createConnection(adminUrl.toString());
  fs.mkdirSync(temp, {recursive:true});
  await control.query('CREATE DATABASE `' + db + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); createdDb=true;
  const dbPassword=secret();
  await control.query(`CREATE USER '${dbUser}'@'localhost' IDENTIFIED BY ?`, [dbPassword]); createdUser=true;
  await control.query(`GRANT ALL PRIVILEGES ON \`${db}\`.* TO '${dbUser}'@'localhost'`);
  const net=require('node:net');
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base='http://127.0.0.1:'+port;
  const env = {};
  for(const line of fs.readFileSync(path.join(root,'.env.example'),'utf8').split(/\r?\n/)) {
    if(!line || line.startsWith('#') || !line.includes('=')) continue;
    const i=line.indexOf('=');env[line.slice(0,i)]=line.slice(i+1).startsWith('replace_with_')?secret():line.slice(i+1);
  }
  Object.assign(env,{NODE_ENV:'production',CRM_STORE:'mysql',APP_DATABASE_PROFILE:'production',CRM_SEED_DEVELOPMENT_DATA:'false',DATABASE_URL:`mysql://${dbUser}:${dbPassword}@127.0.0.1:${adminUrl.port||3306}/${db}`,PORT:String(port),BACKEND_HOST:'127.0.0.1',INITIAL_ADMIN_EMAIL:'platform@test.haituo.local',INITIAL_ADMIN_PASSWORD:secret(),FRONTEND_DIST:path.join(root,'frontend/dist'),SESSION_COOKIE_SECURE:'false',CORS_ORIGINS:base,INBOUND_MAIL_ENABLED:'false',PROSPECT_WORKER_ENABLED:'false',WEBSITE_PROBE_ENABLED:'false',AUTO_WEBSITE_PROBE_ENABLED:'false',GOODJOB_DATA_DIR:temp,GOODJOB_UPLOADS_DIR:path.join(temp,'uploads')});
  const envFile=path.join(temp,'.env');fs.writeFileSync(envFile,Object.entries(env).map(([k,v])=>k+'='+v).join('\n'));
  env.GOODJOB_ENV_FILE=envFile;
  function start() {
    child=spawn(process.execPath,['backend/dist/server.js'],{cwd:root,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});
    const log=fs.createWriteStream(path.join(temp,'server.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);
  }
  async function ready() {
    for(let i=0;i<160;i++) { if(child.exitCode!==null) throw new Error('Test server exited; inspect local server.log');try {if((await fetch(base+'/api/health')).ok) return;}catch{} await wait(500); }
    throw new Error('Test server startup timed out');
  }
  async function request(route, body, token, method=body?'POST':'GET') {
    const res=await fetch(base+route,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,headers:res.headers,data:await res.json()};
  }
  start();await ready(); console.log('Isolated database and HTTP server ready');
  const platform=jwt.sign({ver:1,mfa:true},env.JWT_SECRET,{subject:'u_initial_super_admin',issuer:'haituo-crm',audience:'haituo-crm-web',expiresIn:'15m'});
  const tenantRes=await request('/api/platform/v1/tenants',{name:'海拓开户测试',code:'test-'+suffix},platform);
  if (tenantRes.status!==200) console.log('Tenant creation response:',tenantRes.status,tenantRes.data.message);
  ok(tenantRes.status===200,'Platform creates isolated company');
  const tenantId=tenantRes.data.tenant.id;
  const newAdmin=await request(`/api/platform/v1/tenants/${tenantId}/quick-admin`,{name:'测试管理员'},platform);
  ok(newAdmin.status===201,'Platform one-click administrator creation');
  ok(newAdmin.headers.get('cache-control')==='no-store','Credentials are not cached');
  const first=await request('/api/auth/login',newAdmin.data.credentials);
  ok(first.status===202 && first.data.passwordChangeRequired && !first.data.token,'Initial credentials get only a restricted change token');
  ok((await request('/api/auth/me',null,first.data.changeToken)).status===401,'Change token cannot access CRM APIs');
  const {verifyCrmToken}=await import('../whatsapp-plugin/dist-server/server/crm-auth.js');
  ok(verifyCrmToken(env.JWT_SECRET,first.data.changeToken)===null,'Change token cannot access WhatsApp APIs or sockets');
  ok((await request('/api/auth/initial-password',{changeToken:first.data.changeToken,password:'short'})).status===400,'Short password rejected');
  ok((await request('/api/auth/initial-password',{changeToken:first.data.changeToken,password:newAdmin.data.credentials.password})).status===400,'Temporary password cannot be reused');
  const adminPassword='Ht!'+secret();
  ok((await request('/api/auth/initial-password',{changeToken:first.data.changeToken,password:adminPassword})).status===200,'First-login password change succeeds');
  ok((await request('/api/auth/initial-password',{changeToken:first.data.changeToken,password:'Ht!'+secret()})).status===401,'Password change token cannot be replayed');
  ok((await request('/api/auth/login',newAdmin.data.credentials)).status===401,'Old temporary password rejected after change');
  const adminLogin=await request('/api/auth/login',{email:newAdmin.data.credentials.email,password:adminPassword});
  ok(adminLogin.status===200,'Administrator logs in with chosen password');
  const adminToken=adminLogin.data.token;
  const roles=await request('/api/v1/roles',null,adminToken);
  const role=roles.data.data.find(r=>['sales_rep','legacy_sales','sales'].includes(r.code));ok(role,'Sales role available');
  const createBody={name:'测试业务员',roleId:role.id};
  ok((await request('/api/v1/members/quick-create',createBody)).status===401,'Anonymous users cannot create accounts');
  ok((await request('/api/v1/members/quick-create',{...createBody,tenantId:'another-tenant'},adminToken)).status===404,'Cross-company account creation rejected');
  const noCsrf=await fetch(base+'/api/v1/members/quick-create',{method:'POST',headers:{'content-type':'application/json',cookie:adminLogin.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')},body:JSON.stringify(createBody)});
  ok(noCsrf.status===403,'Cookie-based creation requires CSRF token');
  const member=await request('/api/v1/members/quick-create',createBody,adminToken);
  ok(member.status===201 && member.data.credentials.email!==newAdmin.data.credentials.email,'Administrator creates unique generated member credentials');
  const [dbRows]=await control.query(`SELECT password_hash,must_change_password FROM \`${db}\`.users WHERE email=?`,[member.data.credentials.email]);
  ok(dbRows[0].password_hash.startsWith('scrypt$') && dbRows[0].password_hash!==member.data.credentials.password && dbRows[0].must_change_password===1,'Only password hashes stored; first-change flag persisted');
  const memberLogin=await request('/api/auth/login',member.data.credentials);
  ok(memberLogin.status===202,'New member must change password');
  const memberPassword='Ht!'+secret();
  await wait(1100); // local loopback has its own rate-limit budget; do not relax production limits.
  const changed=await request('/api/auth/initial-password',{changeToken:memberLogin.data.changeToken,password:memberPassword});
  ok(changed.status===200,'Member changes password');
  const sales=await request('/api/auth/login',{email:member.data.credentials.email,password:memberPassword});
  ok(sales.status===200,'Member login succeeds');
  ok((await request('/api/v1/members/quick-create',createBody,sales.data.token)).status===403,'Sales member cannot create accounts');
  const [audits]=await control.query(`SELECT before_summary_json,after_summary_json FROM \`${db}\`.authorization_audit_events`);
  ok(!JSON.stringify(audits).includes(member.data.credentials.password),'Audit trail contains no plaintext password');
  console.log('HTTP security checks passed');
  // Restart proves the password state is persistent, not just an in-memory flag.
  await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
  start();await ready();
  ok((await request('/api/auth/login',{email:member.data.credentials.email,password:memberPassword})).status===200,'Chosen password survives a server restart');
  const {chromium}=require('@playwright/test');
  browser=await chromium.launch({headless:true,...(process.env.HAITUO_TEST_BROWSER_PATH ? {executablePath:process.env.HAITUO_TEST_BROWSER_PATH} : {})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.locator('#loginEmail').fill(newAdmin.data.credentials.email);
  await page.locator('#loginPassword').fill(adminPassword);
  await page.locator('#loginButton').click();
  await page.waitForSelector('body.is-authenticated');
  await page.locator('[data-view="member-management"]').evaluate(el=>el.click());
  await page.locator('[data-ac-add-member]').click();
  await page.locator('#iamNewMemberName').fill('界面开户测试');
  await page.locator('#saveIamNewMember').click();
  await page.locator('#haituoAccountInfo').waitFor();
  const info=await page.locator('#haituoAccountInfo').inputValue();
  ok(info.includes('首次登录') && info.includes(base),'One-click UI shows shareable login information');
  const uiEmail=info.match(/账号：(.*)/)[1], uiPassword=info.match(/临时密码：(.*)/)[1];
  await page.locator('#appModal [data-modal-close]').last().click();
  await page.locator('[data-view="api-balance"]').evaluate(el=>el.click());
  await page.locator('#api-balance.active').waitFor();
  ok(await page.getByRole('button',{name:'充值（待接入）'}).isDisabled(),'API balance entry has no fake recharge action');
  await page.screenshot({path:path.join(temp,'api-balance.png'),fullPage:false});
  const signupPage=await browser.newPage({viewport:{width:1280,height:900}});
  await signupPage.goto(base,{waitUntil:'networkidle'});
  await signupPage.locator('#loginEmail').fill(uiEmail);await signupPage.locator('#loginPassword').fill(uiPassword);await signupPage.locator('#loginButton').click();
  await signupPage.locator('#haituoNewPassword').waitFor();
  await signupPage.locator('#haituoNewPassword').click();
  await signupPage.screenshot({path:path.join(temp,'first-password.png'),fullPage:false,animations:'disabled'});
  ok(await signupPage.locator('#haituoNewPassword').evaluate(el=>document.activeElement===el),'First-password input is visible and receives real pointer clicks');
  await signupPage.locator('#haituoNewPassword').fill('Ht!'+suffix+'Chosen');
  await signupPage.locator('#haituoConfirmPassword').fill('Ht!'+suffix+'Chosen');
  await signupPage.locator('#haituoSavePassword').click();
  await signupPage.waitForSelector('body.is-authenticated');
  ok(true,'Browser first-password flow enters workspace');
  ok(errors.length===0,'Admin browser has no uncaught JavaScript errors');
  fs.writeFileSync(path.join(temp,'result.json'),JSON.stringify({status:'passed',checks},null,2));
  console.log(JSON.stringify({status:'passed',checks,artifacts:temp},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{
  if(browser) await browser.close();
  if(child && child.exitCode===null) await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
  if(control){if(createdDb && /^haituo_accounts_test_[0-9a-f]{12}$/.test(db))await control.query('DROP DATABASE `'+db+'`');if(createdUser)await control.query(`DROP USER '${dbUser}'@'localhost'`);await control.end();}
});
