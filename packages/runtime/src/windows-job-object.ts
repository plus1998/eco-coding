/**
 * Win32 Job Object helpers (Zed-aligned).
 *
 * Create a job with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, assign a process tree
 * root, terminate or close the job handle to reap descendants — including when
 * the owning Node/Electron process crashes and OS closes the handle.
 *
 * Uses `koffi` to call kernel32. If load/bind fails, callers must fall back
 * (e.g. taskkill /T).
 */

import { createRequire } from "node:module";

export type WindowsJobHandle = {
  /** Opaque native HANDLE value as bigint/number from koffi. */
  readonly handle: unknown;
  assignPid(pid: number): boolean;
  terminate(exitCode?: number): boolean;
  close(): void;
};

type Kernel32Api = {
  CreateJobObjectW: (sa: null, name: null) => unknown;
  SetInformationJobObject: (
    job: unknown,
    classInfo: number,
    info: Buffer,
    length: number,
  ) => boolean;
  OpenProcess: (access: number, inherit: boolean, pid: number) => unknown;
  AssignProcessToJobObject: (job: unknown, process: unknown) => boolean;
  TerminateJobObject: (job: unknown, exitCode: number) => boolean;
  CloseHandle: (handle: unknown) => boolean;
  GetLastError: () => number;
};

const PROCESS_TERMINATE = 0x0001;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x0000_2000;
const JobObjectExtendedLimitInformation = 9;
/** x64 sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION) under MSVC. */
const JOBOBJECT_EXTENDED_LIMIT_INFORMATION_SIZE = 144;
/** Offset of LimitFlags inside JOBOBJECT_BASIC_LIMIT_INFORMATION (x64). */
const LIMIT_FLAGS_OFFSET = 16;

let cachedApi: Kernel32Api | null | undefined;

function loadKernel32(): Kernel32Api | null {
  if (cachedApi !== undefined) {
    return cachedApi;
  }
  if (process.platform !== "win32") {
    cachedApi = null;
    return null;
  }
  try {
    const require = createRequire(import.meta.url);
    const koffi = require("koffi") as typeof import("koffi");
    const kernel32 = koffi.load("kernel32.dll");
    cachedApi = {
      CreateJobObjectW: kernel32.func("CreateJobObjectW", "void*", ["void*", "str16"]),
      SetInformationJobObject: kernel32.func("SetInformationJobObject", "bool", [
        "void*",
        "int",
        "void*",
        "uint32",
      ]),
      OpenProcess: kernel32.func("OpenProcess", "void*", ["uint32", "bool", "uint32"]),
      AssignProcessToJobObject: kernel32.func("AssignProcessToJobObject", "bool", [
        "void*",
        "void*",
      ]),
      TerminateJobObject: kernel32.func("TerminateJobObject", "bool", ["void*", "uint32"]),
      CloseHandle: kernel32.func("CloseHandle", "bool", ["void*"]),
      GetLastError: kernel32.func("GetLastError", "uint32", []),
    };
    return cachedApi;
  } catch {
    cachedApi = null;
    return null;
  }
}

function isNullHandle(handle: unknown): boolean {
  return handle === null || handle === undefined || handle === 0 || handle === 0n;
}

/**
 * Create a job with KILL_ON_JOB_CLOSE. Returns null when Win32 APIs are unavailable.
 */
export function createKillOnCloseJob(): WindowsJobHandle | null {
  const api = loadKernel32();
  if (!api) {
    return null;
  }
  const handle = api.CreateJobObjectW(null, null);
  if (isNullHandle(handle)) {
    return null;
  }

  const info = Buffer.alloc(JOBOBJECT_EXTENDED_LIMIT_INFORMATION_SIZE);
  info.writeUInt32LE(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, LIMIT_FLAGS_OFFSET);
  if (!api.SetInformationJobObject(handle, JobObjectExtendedLimitInformation, info, info.length)) {
    api.CloseHandle(handle);
    return null;
  }

  let closed = false;
  return {
    handle,
    assignPid(pid: number): boolean {
      if (closed || !Number.isInteger(pid) || pid <= 0) {
        return false;
      }
      const access = PROCESS_TERMINATE | PROCESS_SET_QUOTA | PROCESS_QUERY_LIMITED_INFORMATION;
      const processHandle = api.OpenProcess(access, false, pid);
      if (isNullHandle(processHandle)) {
        return false;
      }
      try {
        return Boolean(api.AssignProcessToJobObject(handle, processHandle));
      } finally {
        api.CloseHandle(processHandle);
      }
    },
    terminate(exitCode = 1): boolean {
      if (closed) {
        return false;
      }
      return Boolean(api.TerminateJobObject(handle, exitCode));
    },
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      api.CloseHandle(handle);
    },
  };
}

/** Test seam — clear cached koffi bindings between cases. */
export function resetWindowsJobObjectApiForTests(): void {
  cachedApi = undefined;
}

export function windowsJobObjectApisAvailable(): boolean {
  return loadKernel32() !== null;
}
