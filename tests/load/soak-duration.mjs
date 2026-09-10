// k6's statistics window can start slightly after the configured scenario clock.
// Keep the raw value and require the complete scheduled work; never hide a shortened run.
export function assessSoakDuration(config, summary) {
  const match=/^(\d+)([smh])$/.exec(config.duration || '');
  const requestedMs=match?Number(match[1])*({s:1000,m:60000,h:3600000}[match[2]]):0;
  const measuredMs=summary.state?.testRunDurationMs ?? 0;
  const rate=Number(config.rate);
  const expectedIterations=rate*requestedMs/1000;
  const completedIterations=summary.metrics?.iterations?.values?.count ?? 0;
  const statisticsToleranceMs=1000;
  return {requestedMs,measuredMs,statisticsShortfallMs:Math.max(0,requestedMs-measuredMs),statisticsToleranceMs,
    expectedIterations,completedIterations,strictDurationPassed:measuredMs>=requestedMs && requestedMs>=3600000,
    accepted:requestedMs>=3600000 && rate>0 && measuredMs+statisticsToleranceMs>=requestedMs && completedIterations>=expectedIterations};
}
