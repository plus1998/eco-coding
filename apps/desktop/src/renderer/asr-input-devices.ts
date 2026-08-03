import { useCallback, useEffect, useRef, useState } from "react";
import { isAsrAsyncTokenCurrent, nextAsrAsyncToken } from "./asr-async-token";

export const SYSTEM_DEFAULT_ASR_INPUT_DEVICE_ID = "";

export interface AsrInputDevice {
  deviceId: string;
  label: string;
}

export interface AsrInputDevicesState {
  devices: AsrInputDevice[];
  error?: string;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function audioConstraintsForInputDevice(selectedInputDeviceId: string): true | MediaTrackConstraints {
  return selectedInputDeviceId ? { deviceId: { exact: selectedInputDeviceId } } : true;
}

export function isAsrInputDeviceAvailable(
  selectedInputDeviceId: string,
  devices: readonly Pick<MediaDeviceInfo, "deviceId" | "kind">[],
): boolean {
  return (
    selectedInputDeviceId === SYSTEM_DEFAULT_ASR_INPUT_DEVICE_ID ||
    devices.some((device) => device.kind === "audioinput" && device.deviceId === selectedInputDeviceId)
  );
}

export function toAsrInputDevices(
  devices: readonly Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">[],
  fallbackLabel: (index: number) => string,
): AsrInputDevice[] {
  let inputIndex = 0;
  return devices.flatMap((device) => {
    if (device.kind !== "audioinput" || !device.deviceId) return [];
    inputIndex += 1;
    return [{ deviceId: device.deviceId, label: device.label || fallbackLabel(inputIndex) }];
  });
}

async function stopPermissionStream(streamPromise: Promise<MediaStream>): Promise<void> {
  const stream = await streamPromise;
  stream.getTracks().forEach((track) => {
    track.stop();
  });
}

export function useAsrInputDevices(fallbackLabel: (index: number) => string): AsrInputDevicesState {
  const [devices, setDevices] = useState<AsrInputDevice[]>([]);
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const requestedPermissionRef = useRef(false);
  const requestTokenRef = useRef(0);

  const refreshDevices = useCallback(
    async (requestPermission: boolean) => {
      const requestToken = nextAsrAsyncToken(requestTokenRef.current);
      requestTokenRef.current = requestToken;
      const isCurrentRequest = () =>
        isAsrAsyncTokenCurrent(requestToken, requestTokenRef.current, mountedRef.current);
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices?.enumerateDevices) {
        if (isCurrentRequest()) {
          setDevices([]);
          setRefreshing(false);
        }
        return;
      }
      if (isCurrentRequest()) {
        setRefreshing(true);
        setError(undefined);
      }
      try {
        if (requestPermission && mediaDevices.getUserMedia) {
          await stopPermissionStream(mediaDevices.getUserMedia({ audio: true, video: false }));
        }
        if (!isCurrentRequest()) return;
        const nextDevices = await mediaDevices.enumerateDevices();
        if (isCurrentRequest()) {
          setDevices(toAsrInputDevices(nextDevices, fallbackLabel));
        }
      } catch (caught) {
        if (!isCurrentRequest()) return;
        const nextDevices = await mediaDevices.enumerateDevices().catch(() => []);
        if (isCurrentRequest()) {
          setError(caught instanceof Error ? caught.message : "");
          setDevices(toAsrInputDevices(nextDevices, fallbackLabel));
        }
      } finally {
        if (isCurrentRequest()) setRefreshing(false);
      }
    },
    [fallbackLabel],
  );

  const refresh = useCallback(async () => {
    const shouldRequestPermission = !requestedPermissionRef.current;
    requestedPermissionRef.current = true;
    await refreshDevices(shouldRequestPermission);
  }, [refreshDevices]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const mediaDevices = navigator.mediaDevices;
    const handleDeviceChange = () => void refreshDevices(false);
    mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    return () => {
      mountedRef.current = false;
      requestTokenRef.current = nextAsrAsyncToken(requestTokenRef.current);
      mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, [refresh, refreshDevices]);

  return {
    devices,
    ...(error !== undefined ? { error } : {}),
    refreshing,
    refresh,
  };
}
