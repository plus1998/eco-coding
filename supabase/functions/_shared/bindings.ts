import {
  DEFAULT_BINDING_CAPABILITIES,
  requireOwnedDevice,
  type DeviceRow,
} from "./devices.ts";
import { HttpError } from "./http.ts";
import {
  toPublicBinding,
  type DeviceBindingRow,
  type PublicBinding,
} from "./pairing.ts";
import type { AdminClient } from "./supabase.ts";

/**
 * Ensure an active device_bindings row for same-account mobile → desktop.
 * Replaces pairing-create/join as the primary path (password login + select PC).
 */
export async function ensureDeviceBinding(
  admin: AdminClient,
  input: {
    userId: string;
    mobileDeviceId: string;
    deviceSecret: string;
    desktopDeviceId: string;
  },
): Promise<{ binding: PublicBinding; desktopDeviceId: string }> {
  const mobile = await requireOwnedDevice(admin, {
    userId: input.userId,
    deviceId: input.mobileDeviceId,
    kind: "mobile",
    deviceSecret: input.deviceSecret,
  });

  const { data: desktopData, error: desktopError } = await admin
    .from("devices")
    .select(
      "id, user_id, kind, name, secret_hash, metadata, created_at, last_seen_at, disabled_at, vault_synced_at",
    )
    .eq("id", input.desktopDeviceId)
    .maybeSingle();

  if (desktopError) {
    console.error("desktop lookup failed", desktopError);
    throw new HttpError(500, "Failed to load desktop device.", "device_lookup_failed");
  }

  const desktop = desktopData as DeviceRow | null;
  if (
    !desktop ||
    desktop.user_id !== input.userId ||
    desktop.kind !== "desktop" ||
    desktop.disabled_at
  ) {
    throw new HttpError(403, "Desktop device is not active.", "device_inactive");
  }

  const { data: existing, error: existingError } = await admin
    .from("device_bindings")
    .select(
      "id, user_id, desktop_device_id, mobile_device_id, capabilities, created_at, revoked_at",
    )
    .eq("desktop_device_id", desktop.id)
    .eq("mobile_device_id", mobile.id)
    .maybeSingle();

  if (existingError) {
    console.error("binding lookup failed", existingError);
    throw new HttpError(500, "Failed to check existing binding.", "binding_lookup_failed");
  }

  if (existing) {
    const row = existing as DeviceBindingRow;
    if (!row.revoked_at) {
      return {
        binding: toPublicBinding(row),
        desktopDeviceId: desktop.id,
      };
    }

    const { data: revived, error: reviveError } = await admin
      .from("device_bindings")
      .update({
        revoked_at: null,
        capabilities: [...DEFAULT_BINDING_CAPABILITIES],
      })
      .eq("id", row.id)
      .select(
        "id, user_id, desktop_device_id, mobile_device_id, capabilities, created_at, revoked_at",
      )
      .single();

    if (reviveError || !revived) {
      console.error("binding revive failed", reviveError);
      throw new HttpError(500, "Failed to restore device binding.", "binding_failed");
    }

    return {
      binding: toPublicBinding(revived as DeviceBindingRow),
      desktopDeviceId: desktop.id,
    };
  }

  const { data: bindingData, error: bindingError } = await admin
    .from("device_bindings")
    .insert({
      user_id: input.userId,
      desktop_device_id: desktop.id,
      mobile_device_id: mobile.id,
      capabilities: [...DEFAULT_BINDING_CAPABILITIES],
    })
    .select(
      "id, user_id, desktop_device_id, mobile_device_id, capabilities, created_at, revoked_at",
    )
    .single();

  if (bindingError || !bindingData) {
    if (bindingError?.code === "23505") {
      const { data: raced } = await admin
        .from("device_bindings")
        .select(
          "id, user_id, desktop_device_id, mobile_device_id, capabilities, created_at, revoked_at",
        )
        .eq("desktop_device_id", desktop.id)
        .eq("mobile_device_id", mobile.id)
        .maybeSingle();
      if (raced) {
        const racedRow = raced as DeviceBindingRow;
        if (racedRow.revoked_at) {
          const { data: revived } = await admin
            .from("device_bindings")
            .update({
              revoked_at: null,
              capabilities: [...DEFAULT_BINDING_CAPABILITIES],
            })
            .eq("id", racedRow.id)
            .select(
              "id, user_id, desktop_device_id, mobile_device_id, capabilities, created_at, revoked_at",
            )
            .single();
          if (revived) {
            return {
              binding: toPublicBinding(revived as DeviceBindingRow),
              desktopDeviceId: desktop.id,
            };
          }
        } else {
          return {
            binding: toPublicBinding(racedRow),
            desktopDeviceId: desktop.id,
          };
        }
      }
    }
    console.error("device_bindings insert failed", bindingError);
    throw new HttpError(500, "Failed to create device binding.", "binding_failed");
  }

  return {
    binding: toPublicBinding(bindingData as DeviceBindingRow),
    desktopDeviceId: desktop.id,
  };
}
