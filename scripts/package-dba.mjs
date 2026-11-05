// Offline packaging only. Does not connect to or modify any database.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'deploy', 'dba', 'generated');
await fs.mkdir(destination, {recursive: true});
const files = (await fs.readdir(path.join(root, 'db/migrations'))).filter(f => /^V\d+__.*\.sql$/.test(f))
  .sort((a,b) => Number(a.match(/^V(\d+)/)[1]) - Number(b.match(/^V(\d+)/)[1]));
const latestVersion = files.at(-1).split('__')[0];
const javaMigrations = (await fs.readdir(path.join(root, 'backend/src/main/java/db/migration'))).filter(f => /^V\d+__/.test(f));
if (javaMigrations.some(f => f !== 'V037__unify_product_completeness.java')) {
  throw new Error('New Java migration requires explicit DBA adaptation; refusing incomplete SQL package');
}
let sql = '-- FRESH EMPTY DATABASE ONLY. DBA must stop on first error; never use mysql --force.\n'
  + '-- V037 is Java data cleanup only; an empty new database has no applicable rows.\n'
  + '-- Existing databases MUST use separately reviewed incremental migrations, never this file.\n'
  + 'SET NAMES utf8mb4;\nSET time_zone = "+00:00";\n';
const manifest = [];
for (const file of files) {
  const content = (await fs.readFile(path.join(root, 'db/migrations', file), 'utf8')).replace(/\r\n/g, '\n');
  sql += `\n-- BEGIN ${file}\n${content}\n-- END ${file}\n`;
  manifest.push({file, sha256: crypto.createHash('sha256').update(content).digest('hex')});
}
sql += `\nCREATE TABLE deployment_schema_history (
  version VARCHAR(64) PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  description VARCHAR(255) NOT NULL
) ENGINE=InnoDB;
INSERT INTO deployment_schema_history(version,description)
VALUES ('${latestVersion}','Fresh schema V001-${latestVersion}; V037 data-only Java migration not applicable to empty database');\n`;
await fs.writeFile(path.join(destination, 'fresh-install.sql'), sql);
manifest.push({file:'V037__unify_product_completeness.java', action:'EMPTY_DATABASE_NO_OP', sha256:crypto.createHash('sha256').update((await fs.readFile(path.join(root,'backend/src/main/java/db/migration',javaMigrations[0]), 'utf8')).replace(/\r\n/g, '\n')).digest('hex')});
await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify({scope:'fresh empty database only', sourceHashNormalization:'UTF-8 with LF line endings', migrations:manifest, bundleSha256:crypto.createHash('sha256').update(sql).digest('hex')}, null, 2)+'\n');
console.log('Generated fresh-install.sql and manifest.json; no database was accessed.');

// Separate incremental bundle: never run the fresh installation bundle on an existing database.
const incrementalFiles=['V040__dashboard_order_summaries.sql','V041__drop_order_item_dashboard_triggers.sql'];
let upgrade='-- EXISTING V039 DATABASE ONLY. DBA: stop all application writers and back up first.\n'
  +'-- Verify SELECT DATABASE(), MAX(version) FROM deployment_schema_history = V039,\n'
  +'-- and both order_dashboard_* tables are absent. Stop on the first error; never use --force.\n'
  +'-- V040 needs trigger privileges even though V041 immediately removes the triggers.\n'
  +'-- After migration: repair/check every activity before enabling summary reads.\n'
  +'SET NAMES utf8mb4;\nSET time_zone = "+00:00";\n';
for(const file of incrementalFiles) {
  const content=(await fs.readFile(path.join(root,'db/migrations',file),'utf8')).replace(/\r\n/g,'\n');
  const version=file.split('__')[0];
  upgrade+=`\n-- BEGIN ${file}\n${content}\n-- END ${file}\nINSERT INTO deployment_schema_history(version,description) VALUES ('${version}','DBA incremental ${file}');\n`;
}
await fs.writeFile(path.join(destination,'upgrade-v039-v041.sql'),upgrade);
await fs.writeFile(path.join(destination,'upgrade-v039-v041.manifest.json'),JSON.stringify({scope:'existing V039 database only',from:'V039',to:'V041',
  migrations:manifest.filter(item=>incrementalFiles.includes(item.file)),bundleSha256:crypto.createHash('sha256').update(upgrade).digest('hex')},null,2)+'\n');
console.log('Generated upgrade-v039-v041.sql and manifest; no database was accessed.');

// Existing V041 databases receive only V042-V049; the empty installation bundle is never used here.
const v041Files=files.filter(f=>Number(f.match(/^V(\d+)/)[1])>41 && Number(f.match(/^V(\d+)/)[1])<=49);
if(latestVersion!=='V054'||v041Files.length!==8)throw new Error('Review incremental package range before changing it');
let v041Sql='-- EXISTING V041 DATABASE ONLY. DBA: stop all writers, verify version and back up first.\n'
 +'-- Apply in order; stop on first error. DDL may implicitly commit. Never use --force.\n'
 +'-- V048 inserts first-price tiers and invalidates catalog metadata; original orders/history are preserved.\n'
 +'SET NAMES utf8mb4;\nSET time_zone = "+00:00";\n';
for(const file of v041Files){
 const content=(await fs.readFile(path.join(root,'db/migrations',file),'utf8')).replace(/\r\n/g,'\n');
 v041Sql += "\n-- BEGIN "+file+"\n"+content+"\n-- END "+file+"\nINSERT INTO deployment_schema_history(version,description) VALUES ('"+file.split('__')[0]+"','DBA incremental "+file+"');\n";
}
await fs.writeFile(path.join(destination,'upgrade-v041-v049.sql'),v041Sql);
await fs.writeFile(path.join(destination,'upgrade-v041-v049.manifest.json'),JSON.stringify({scope:'existing V041 database only',from:'V041',to:'V049',migrations:manifest.filter(i=>v041Files.includes(i.file)),bundleSha256:crypto.createHash('sha256').update(v041Sql).digest('hex')},null,2)+'\n');
console.log('Generated V041-V049 incremental package; no database accessed.');

// Existing V049 databases: preserve V001-V049 data; add only V050-V053.
const v049Files=files.filter(f=>Number(f.match(/^V(\d+)/)[1])>49 && Number(f.match(/^V(\d+)/)[1])<=53);
if(latestVersion!=='V054'||v049Files.length!==4)throw new Error('Review V049-V053 package range');
let v049Sql='-- EXISTING V049 DATABASE ONLY. DBA: verify target, stop all writers/workers, back up first.\n'
 +'-- Apply V050-V053 in order; stop on first error. MySQL DDL may implicitly commit.\n'
 +'-- Never use mysql --force. Never run the fresh-install bundle on an existing database.\n'
 +'SET NAMES utf8mb4;\nSET time_zone = "+00:00";\n';
for(const file of v049Files){
 const content=(await fs.readFile(path.join(root,'db/migrations',file),'utf8')).replace(/\r\n/g,'\n');
 v049Sql+='\n-- BEGIN '+file+'\n'+content+'\n-- END '+file+'\nINSERT INTO deployment_schema_history(version,description) VALUES (\''+file.split('__')[0]+'\',\'DBA incremental '+file+'\');\n';
}
await fs.writeFile(path.join(destination,'upgrade-v049-v053.sql'),v049Sql);
await fs.writeFile(path.join(destination,'upgrade-v049-v053.manifest.json'),JSON.stringify({scope:'existing V049 database only',from:'V049',to:'V053',migrations:manifest.filter(i=>v049Files.includes(i.file)),bundleSha256:crypto.createHash('sha256').update(v049Sql).digest('hex')},null,2)+'\n');
console.log('Generated V049-V053 incremental package; no database accessed.');

// Keep the published V049-V053 bundle unchanged. V054 is a separate, ordered upgrade.
const v053Files=files.filter(f=>Number(f.match(/^V(\d+)/)[1])>53);
if(latestVersion!=='V054'||v053Files.length!==1)throw new Error('Review V053-V054 package range');
let v053Sql='-- EXISTING V053 DATABASE ONLY. DBA: verify target, stop all API/workers and back up first.\n'
 +'-- Apply before the new deletion code. Old workers do not maintain last_progress_at.\n'
 +'-- Stop on first error; DDL may implicitly commit. Never use --force.\n'
 +'SET NAMES utf8mb4;\nSET time_zone = "+00:00";\n';
for(const file of v053Files){
 const content=(await fs.readFile(path.join(root,'db/migrations',file),'utf8')).replace(/\r\n/g,'\n');
 v053Sql+='\n-- BEGIN '+file+'\n'+content+'\n-- END '+file+'\nINSERT INTO deployment_schema_history(version,description) VALUES (\''+file.split('__')[0]+'\',\'DBA incremental '+file+'\');\n';
}
await fs.writeFile(path.join(destination,'upgrade-v053-v054.sql'),v053Sql);
await fs.writeFile(path.join(destination,'upgrade-v053-v054.manifest.json'),JSON.stringify({scope:'existing V053 database only',from:'V053',to:'V054',migrations:manifest.filter(i=>v053Files.includes(i.file)),bundleSha256:crypto.createHash('sha256').update(v053Sql).digest('hex')},null,2)+'\n');
console.log('Generated V053-V054 incremental package; no database accessed.');
