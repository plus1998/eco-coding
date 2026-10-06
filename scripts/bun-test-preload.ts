import { setDefaultTimeout } from "bun:test";

// The suite includes CLI tests that start Bun subprocesses and workspace tests
// that invoke Git. Ten seconds leaves room for the two-worker full run without
// allowing a genuinely stuck test to linger indefinitely.
setDefaultTimeout(10_000);
