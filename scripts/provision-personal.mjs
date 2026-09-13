import fs from 'node:fs';
import {randomBytes, scryptSync} from 'node:crypto';
import mysql from 'mysql2/promise';
const base='F:/GoodJob/personal/config';
const env=Object.fromEntries(fs.readFileSync(`${base}/secrets.env`,'utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const connection=await mysql.createConnection({host:'127.0.0.1',port:13306,user:'goodjob_app',password:env.DB_PASSWORD,database:'goodjob_crm'});
try {
  const [existing]=await connection.execute('SELECT id FROM users WHERE email=?',['owner@goodjob.local']);
  if(existing.length) { console.log('Personal account already provisioned'); }
  else {
    const password=randomBytes(15).toString('base64url');
    const salt=randomBytes(16);
    const hash=`scrypt$${salt.toString('base64url')}$${scryptSync(password,salt,64).toString('base64url')}`;
    const credential={email:'owner@goodjob.local',password};
    fs.writeFileSync(`${base}/personal-account.json`,JSON.stringify(credential),{flag:'wx'});
    fs.writeFileSync(`${base}/个人使用账号.txt`,`访问地址：http://127.0.0.1:4189/\r\n账号：${credential.email}\r\n密码：${password}\r\n`,{flag:'wx'});
    await connection.execute("INSERT INTO users (id,name,email,password_hash,role,team_id,avatar,status,auth_version) VALUES (?,?,?,?,?,?,?,'active',1)",['u_personal_owner','老板',credential.email,hash,'admin','personal','我']);
    console.log('Personal company administrator created; credentials saved locally, not printed');
  }
} finally { await connection.end(); }
