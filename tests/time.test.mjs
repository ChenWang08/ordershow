import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { loadModule } from "./helpers/load-ts-module.mjs";

// New processes also exercise Windows timezone handling; VM contexts alone do not change the host zone.
for (const tz of ["Asia/Shanghai", "UTC", "America/Los_Angeles"]) {
  test(`Beijing display, form round trips and activity requests are stable in ${tz}`, () => {
    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { loadModule } from './tests/helpers/load-ts-module.mjs';
      const time=loadModule('app/features/shared/time.ts');
      const instant='2026-10-19T05:41:03.123Z';
      const display=time.formatBeijingTime(instant);
      assert.match(display,/2026\\/10\\/19 13:41:03/);
      assert.equal(time.formatBeijingTime('2026-10-19T13:41:03.123+08:00'),display);
      assert.equal(time.formatBeijingTime('2026-10-19 05:41:03.123'),display);
      assert.equal(time.toBeijingDateTimeLocal(instant),'2026-10-19T13:41');
      assert.equal(time.beijingDateTimeToUtc('2026-10-19T13:41:03.123'),instant);
      assert.equal(time.beijingDateTimeToUtc(time.toBeijingDateTimeLocal(instant)),'2026-10-19T05:41:00.000Z');
      assert.equal(time.formatBeijingTime(instant,{hour:'2-digit',minute:'2-digit',second:'2-digit'}),'13:41:03');
      assert.equal(time.beijingDateStamp(new Date('2026-10-18T16:00:00Z')),'2026-10-19');
      assert.equal(time.beijingDateStamp(new Date('2026-12-31T16:00:00Z')),'2027-01-01');
      assert.match(time.formatBeijingTime('2026-12-31T16:00:00Z'),/2027\\/1\\/1 00:00:00/);
      assert.equal(time.beijingDateTimeToUtc('2027-01-01T00:00'),'2026-12-31T16:00:00.000Z');
      assert.equal(time.beijingDateTimeToUtc('2026-03-08T02:30'),'2026-03-07T18:30:00.000Z');
      const sent=[];
      const api=loadModule('app/services/api/activity.ts',{
        './client':{api:async(path,options)=>{sent.push(JSON.parse(options.body));return {data:{}};}},
        './context':{activeActivityPath:()=> 'TIME_TEST'}
      });
      const values={name:'时间测试',startsAt:'2026-10-20T20:00',endsAt:'2026-10-21T20:00',eventEndsAt:'2026-10-21T22:00'};
      await api.createActivity(values);
      await api.updateActivity({id:1,version:1,timezone:'Asia/Shanghai'},values);
      await api.reopenActivity({id:1,version:1},{...values,reason:'时间测试'});
      assert.equal(sent[0].startsAt,'2026-10-20T12:00:00.000Z');
      assert.equal(sent[1].startsAt,sent[0].startsAt);
      assert.equal(sent[2].endsAt,sent[0].endsAt);
      assert.equal(sent[2].eventEndsAt,'2026-10-21T14:00:00.000Z');
      const orders=loadModule('app/components/orders/order-domain.ts',{'../../api':{ApiError:class extends Error{}}});
      assert.match(orders.formatDate(instant),/10\\/19 13:41/);
      const dashboard=loadModule('app/features/screens/dashboard-domain.ts');
      assert.equal(dashboard.dashboardMetrics(null,{timezone:'America/Los_Angeles'}).activityTimeZone,'Asia/Shanghai');
      assert.equal(dashboard.dashboardMetrics({dashboard:{totals:{},productLines:[],branches:[],companies:[],generatedAt:instant},customerTypes:[],regions:[],trend:[]},null).generatedAt,display);
    `], { env: { ...process.env, TZ: tz }, stdio: "pipe" });
  });
}

test("invalid Beijing form values are rejected rather than normalized into a different date", () => {
  const time = loadModule("app/features/shared/time.ts");
  for (const value of ["", "invalid", "2026-02-30T12:00", "2026-13-01T12:00", "2026-10-19T24:00", "2026-10-19T12:60", "2026-10-19T12:00Z"]) {
    assert.ok(Number.isNaN(time.beijingDateTimeMillis(value)), value);
    assert.throws(() => time.beijingDateTimeToUtc(value), /有效的北京时间/);
  }
  assert.equal(time.beijingDateTimeToUtc("2028-02-29T00:00"), "2028-02-28T16:00:00.000Z");
  assert.equal(time.formatBeijingTime("invalid"), "—");
});
