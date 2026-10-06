import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const reactDomDir = path.dirname(require.resolve("react-dom/package.json"));

// Execute the installed React serializer/logger against the native User Timing
// buffer. This checks the dependency Bun actually installed, rather than a copy
// of the patch or an application-level performance mock.
for (const entry of ["react-dom-client.development.js", "react-dom-profiling.development.js"]) {
  test(`${entry}: frequent prop changes do not retain cloned performance details`, () => {
    const source = readFileSync(path.join(reactDomDir, "cjs", entry), "utf8");
    const serializers = source.slice(
      source.indexOf("    function getArrayKind("),
      source.indexOf("    function setCurrentTrackFromLanes("),
    );
    const logger = source.slice(
      source.indexOf("    function measureAndClear("),
      source.indexOf("    function logComponentErrored("),
    );
    expect(logger).not.toBe("");
    const details = { properties: null, color: "", tooltipText: "" };
    const context = vm.createContext({
      performance,
      console,
      supportsUserTiming: true,
      getComponentNameFromFiber: () => "EcoPerformanceRegression",
      getComponentNameFromType: () => "Child",
      reusableComponentOptions: { start: 0, end: 1, detail: { devtools: details } },
      reusableComponentDevToolDetails: details,
      resuableChangedPropsEntry: ["Changed Props", ""],
      reusableDeeplyEqualPropsEntry: ["Changed Props", "equal"],
      alreadyWarnedForDeepEquality: false,
      DEEP_EQUALITY_WARNING: "equal",
      COMPONENTS_TRACK: "Components ⚛",
      REMOVED: "-",
      ADDED: "+",
      UNCHANGED: " ",
      EMPTY_ARRAY: 0,
      COMPLEX_ARRAY: 1,
      PRIMITIVE_ARRAY: 2,
      ENTRIES_ARRAY: 3,
      isArrayImpl: Array.isArray,
      hasOwnProperty: Object.prototype.hasOwnProperty,
      REACT_ELEMENT_TYPE: Symbol.for("react.transitional.element"),
      OMITTED_PROP_ERROR: Symbol("omitted"),
    });
    vm.runInContext(serializers + logger, context);
    const measureName = "\u200bEcoPerformanceRegression";
    performance.clearMeasures(measureName);
    performance.measure("eco-unrelated-test", { start: 0, end: 1 });
    try {
      for (let i = 0; i < 1_000; i++) {
        context.fiber = {
          actualDuration: 1,
          child: null,
          alternate: { memoizedProps: { message: "before", seq: i }, child: null, lanes: 0 },
          memoizedProps: { message: "streaming reply ".repeat(500), seq: i + 1 },
          // Exercise both the direct call and DevTools task paths.
          _debugTask: i % 2 ? { run: (fn: () => unknown) => fn() } : null,
        };
        vm.runInContext("logComponentRender(fiber, 0, 1, false, 1)", context);
      }
      expect(performance.getEntriesByName(measureName)).toHaveLength(0);
      expect(performance.getEntriesByName("eco-unrelated-test")).toHaveLength(1);
    } finally {
      performance.clearMeasures(measureName);
      performance.clearMeasures("eco-unrelated-test");
    }
  });
}
