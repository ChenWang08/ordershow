// Direct SQL fixtures bypass import/auth setup only; measured orders use real API transactions.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { sql, save } from './lib.mjs';
const hash = s => createHash('sha256').update(s).digest('hex');
const phoneHash = s => createHmac('sha256', Buffer.from(hash('load-only-hmac'), 'hex')).update(s).digest('hex');
const count = Number(process.env.LOAD_CUSTOMERS || 2500);
if (!Number.isInteger(count) || count < 2500 || count > 10000) throw new Error('LOAD_CUSTOMERS must be 2500..10000; diagnostics reserve customers through index 2402');
if (Number(sql("SELECT COUNT(*) FROM activity WHERE activity_code LIKE 'LOAD-%';").trim())) throw new Error('Load fixture already exists; retain results before resetting dedicated volumes.');
const statements = ["START TRANSACTION;", "SET @admin=(SELECT id FROM admin_user WHERE username='load_admin');"];
const fixture = { createdAt: new Date().toISOString(), activities: [], customers: [] };
for (let index = 1; index <= 2; index++) {
  const a = 100 + index;
  const code = `LOAD-${index}`;
  statements.push(`INSERT INTO department(id,department_code,department_name) VALUES (${100+a},'LOAD${a}','LOAD department ${a}');`,
    `INSERT INTO activity(id,department_id,activity_code,name,status,starts_at,ends_at,event_ends_at,published_at,created_by,updated_by) VALUES (${a},${100+a},'${code}','LOAD activity ${a}','ACTIVE',UTC_TIMESTAMP()-INTERVAL 1 HOUR,UTC_TIMESTAMP()+INTERVAL 2 DAY,UTC_TIMESTAMP()+INTERVAL 3 DAY,UTC_TIMESTAMP(),@admin,@admin);`);
  for (const [index, type] of ['PRODUCT', 'WHITELIST'].entries()) {
    const id = a * 10 + index;
    statements.push(`INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose) VALUES (${id},${a},'MINIO','order-show-load','fixture-${id}','SQL-fixture','application/octet-stream',0,UNHEX(SHA2('fixture',256)),'OTHER');`,
      `INSERT INTO import_task(id,activity_id,import_type,status,source_file_id,file_sha256,created_by) VALUES (${id},${a},'${type}','COMPLETED',${id},UNHEX(SHA2('fixture',256)),@admin);`,
      `INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,status,row_count,created_by,published_at) VALUES (${id},${a},'${type}',1,${id},'PUBLISHED',${index ? (a===101 ? count : 50) : 300},@admin,UTC_TIMESTAMP());`,
      `INSERT INTO activity_data_binding(activity_id,data_type,current_version_id,updated_by) VALUES (${a},'${type}',${id},@admin);`);
  }
  const products = [];
  for (let p = 1; p <= 300; p++) {
    const id = a * 10000 + p; products.push(id);
    statements.push(`INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_code,material_name,category_name,product_line,specification,case_pack,case_price,ton_case_factor,source_import_task_id,data_version_id) VALUES (${id},${a},'SPECIAL','PARTICIPATING','LOAD-${id}','P${id}','LOAD product ${id}','Seasoning','Soy','500ml','12',100,10,${a*10},${a*10});`);
  }
  fixture.activities.push({ id:a, code, products });
  for (let n = 1; n <= (a===101 ? count : 50); n++) {
    const id = a * 100000 + n, phone = String(13900000000 + id);
    const token = randomBytes(24).toString('hex'), csrf = randomBytes(24).toString('hex');
    statements.push(`INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name) VALUES (${id},'SPECIAL','LOAD customer ${id}','loadcustomer${id}');`,
      `INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,branch_name,normalized_branch_name,dealer_full_name,normalized_dealer_full_name,phone,phone_lookup_hash,phone_masked,source_import_task_id,data_version_id) VALUES (${id},${a},${id},'SPECIAL','LOAD branch ${n%10}','loadbranch${n%10}','LOAD customer ${id}','loadcustomer${id}','${phone}',UNHEX('${phoneHash(phone)}'),'139****${phone.slice(-4)}',${a*10+1},${a*10+1});`,
      `INSERT INTO h5_session(activity_id,activity_customer_id,token_hash,csrf_token_hash,expires_at,last_seen_at) VALUES (${a},${id},UNHEX('${hash(token)}'),UNHEX('${hash(csrf)}'),UTC_TIMESTAMP()+INTERVAL 2 DAY,UTC_TIMESTAMP());`);
    fixture.customers.push({id, activityId:a, code, phone, csrf, cookie:`ORDER_SHOW_H5_SESSION=${token}; ORDER_SHOW_H5_CSRF=${csrf}`});
  }
}
statements.push('COMMIT;');
sql(statements.join('\n'));
save('fixture.json', fixture);
console.log(`Seeded ${fixture.customers.length} customers, 600 products, 2 activities; credentials stored only in ignored outputs/load.`);
