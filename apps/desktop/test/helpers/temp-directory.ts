import fs from "node:fs";
import fsp from "node:fs/promises";

/** Windows 上"文件/目录仍被打开"才会出现的错误码；POSIX 删除已打开的文件不会报错。 */
const WINDOWS_LOCK_ERROR_CODES = new Set(["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"]);

function isWindowsLockError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return process.platform === "win32" && typeof code === "string" && WINDOWS_LOCK_ERROR_CODES.has(code);
}

/**
 * 清理测试使用的临时目录（或临时文件）。
 *
 * `createXxxStore(dbPath)` 按生产语义在进程生命周期内持有 `node:sqlite` 句柄，而 Windows 不允许
 * 删除仍被打开的文件（`EBUSY`）或仍含打开文件的目录（`EPERM`、`ENOTEMPTY`）。这类锁只能等进程
 * 退出后由系统临时目录回收，所以 win32 上这里是尽力而为：只吞掉文件锁错误，其它错误照常抛出；
 * POSIX 可以删除已打开的文件，行为与直接 `fs.rm` 完全一致。
 */
export async function removeTempDirectory(target: string): Promise<void> {
  try {
    await fsp.rm(target, { recursive: true, force: true });
  } catch (error) {
    if (!isWindowsLockError(error)) throw error;
  }
}

/** `removeTempDirectory` 的同步版本，语义相同（只服务于同步 teardown 钩子）。 */
export function removeTempDirectorySync(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    if (!isWindowsLockError(error)) throw error;
  }
}
