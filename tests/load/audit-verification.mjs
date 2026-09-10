// SecurityConfiguration audits /admin/** and /h5/**, not public phone verification.
export function expectedAudits(summary) {
  return summary.root_group.checks.filter(check=>/^(draft|submit) success$/.test(check.name))
    .reduce((count,check)=>count+check.passes+check.fails,0);
}
