// pi-web-search publishes its TypeScript source as the package entrypoint.
// Keep the real import in a JavaScript boundary so the workspace typecheck does
// not adopt the dependency's source files, while Bun still bundles the package
// into the desktop main process.
import piWebSearch from "pi-web-search";

export default piWebSearch;
