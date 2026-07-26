/* Minimal pass/fail harness shared by the deterministic regression tests.
 * Prints one line per failure and exits non-zero from finish(). */
export function createChecker() {
  let failures = 0;
  const check = (name, cond, detail) => {
    if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); failures++; }
    return !!cond;
  };
  const fail = (message) => check(message, false);
  const finish = (passMessage) => {
    if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
    if (passMessage) console.log(`PASS: ${passMessage}`);
  };
  return { check, fail, finish, get failures() { return failures; } };
}
