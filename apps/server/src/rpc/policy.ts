import {
  type EcoCommandRisk,
  type EcoDeviceCapability,
  type EcoInvokeParams,
  getRemoteCommandDefinition,
  type RemoteCommandDefinition,
  validateRemoteCommandArgs,
} from "@eco/shared";
import type { DeviceBindingRecord } from "../types";

export interface InvokeAuthorization {
  risk: EcoCommandRisk;
  command: RemoteCommandDefinition;
}

export class PolicyEngine {
  authorizeMobileInvoke(input: {
    params: EcoInvokeParams;
    mobileCapabilities: readonly EcoDeviceCapability[];
    binding: DeviceBindingRecord;
  }): InvokeAuthorization {
    const command = getRemoteCommandDefinition(input.params.channel);
    if (!command) {
      throw new Error(`PC command is not remote-enabled: ${input.params.channel}`);
    }
    const argsValidation = validateRemoteCommandArgs(input.params.channel, input.params.args);
    if (!argsValidation.ok) {
      throw new Error(argsValidation.message ?? "PC command args are invalid.");
    }
    for (const capability of command.requiredCapabilities) {
      if (
        !input.mobileCapabilities.includes(capability) ||
        !input.binding.capabilities.includes(capability)
      ) {
        throw new Error(`Mobile device is missing required capability ${capability}.`);
      }
    }
    return { risk: command.risk, command };
  }
}
