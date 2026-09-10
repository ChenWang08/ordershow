import {compose,docker,guard,save} from './lib.mjs';
import {execFileSync} from 'node:child_process';
guard();
const query=`
SELECT LEFT(DIGEST_TEXT,300) statement_text,COUNT_STAR,ROUND(SUM_TIMER_WAIT/1000000000000,3) total_seconds,ROUND(AVG_TIMER_WAIT/1000000000,3) average_ms
FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME='order_show_load' ORDER BY SUM_TIMER_WAIT DESC LIMIT 20;
SELECT COUNT(*) lock_waits FROM performance_schema.data_lock_waits;
SELECT OBJECT_NAME,LOCK_TYPE,LOCK_MODE,LOCK_STATUS,COUNT(*) n FROM performance_schema.data_locks WHERE OBJECT_SCHEMA='order_show_load' GROUP BY OBJECT_NAME,LOCK_TYPE,LOCK_MODE,LOCK_STATUS;
SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Slow_queries','Innodb_row_lock_waits','Innodb_row_lock_time','Innodb_deadlocks');
SELECT COUNT(*) orders,MAX(current_version_no) largest_version FROM order_show_load.customer_order;
SELECT COUNT(*) versions FROM order_show_load.order_version;
SELECT COUNT(*) items FROM order_show_load.order_item;
SELECT COUNT(*) history_items FROM order_show_load.order_version_item;
`;
const output=docker([...compose,'exec','-T','-e','MYSQL_PWD=load_only_root','mysql','mysql','-uroot','--batch','-e',query]);
const ids=docker([...compose,'ps','-q']).trim().split(/\s+/);
const containers=JSON.parse(docker(['inspect',...ids])).map(c=>({name:c.Name,image:c.Image,restarts:c.RestartCount,oomKilled:c.State.OOMKilled,memory:c.HostConfig.Memory,nanoCpus:c.HostConfig.NanoCpus,mounts:c.Mounts.map(m=>({type:m.Type,name:m.Name,destination:m.Destination}))}));
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const report={timestamp:new Date().toISOString(),revision,containers,output};save(`diagnostics-${Date.now()}.json`,report);console.log(output);
