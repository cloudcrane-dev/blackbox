// What a host that publishes spec-built apps needs (CloudCrane vendors this as
// one file, built by vendor.mjs): check a spec, build it, and describe it as a
// blueprint. The runtime's code is exported so a host can check a built page
// without it: the runtime is reviewed once per version and locked by its hash.
export { validateSpec, leakProblems, deriveBlueprint, CLOUDCRANE_CATALOG_ID, pageOf, wrapPage, type PageApp } from "@cloudcrane/app-spec";
export { compile, CompileError, runtimeFile } from "./compiler/compile.js";
export { RUNTIME_JS, RUNTIME_SHA256, RUNTIME_VERSION } from "./compiler/runtime.generated.js";
