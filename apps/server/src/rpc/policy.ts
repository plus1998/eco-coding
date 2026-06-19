import {
  classifyEcoCommandRisk,
  type EcoCommandRisk,
  type EcoDeviceCapability,
  type EcoInvokeParams,
} from "@eco/shared";
import type { DeviceBindingRecord } from "../types";

export interface InvokeAuthorization {
  risk: EcoCommandRisk;
}

export class PolicyEngine {
  authorizeMobileInvoke(input: {
    params: EcoInvokeParams;
    mobileCapabilities: readonly EcoDeviceCapability[];
    binding: DeviceBindingRecord;
  }): InvokeAuthorization {
    if (!input.mobileCapabilities.includes("rpc:invoke") || !input.binding.capabilities.includes("rpc:invoke")) {
      throw new Error("Mobile device is not allowed to invoke PC commands.");
    }
    const risk = classifyEcoCommandRisk(input.params.channel);
    if (
      risk === "privileged" &&
      (!input.mobileCapabilities.includes("approval:decide") ||
        !input.binding.capabilities.includes("approval:decide"))
    ) {
      throw new Error("Mobile device is not allowed to approve privileged operations.");
    }
    return { risk };
  }
}
