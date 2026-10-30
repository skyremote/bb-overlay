import type { BbPluginApi } from "@get-bb/plugin-sdk";

// BB's installed builder requires this entry for a frontend-only package.
// No services, events, RPCs, model tools, storage or side effects are registered.
export default function simple(_bb: BbPluginApi) {}
