import re
import subprocess
from pathlib import Path

path = Path(r"C:\Users\admin\AppData\Local\Temp\back3.xml")
subprocess.run(
    ["adb", "-s", "emulator-5554", "shell", "uiautomator", "dump", "/sdcard/ui.xml"],
    check=True,
)
subprocess.run(
    ["adb", "-s", "emulator-5554", "pull", "/sdcard/ui.xml", str(path)],
    check=True,
)
raw = path.read_text(encoding="utf-8")
for m in re.finditer(
    r'content-desc="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',
    raw,
):
    desc = m.group(1)
    if "测试仅回复" in desc:
        x = (int(m.group(2)) + int(m.group(4))) // 2
        y = (int(m.group(3)) + int(m.group(5))) // 2
        print("TAP", x, y, desc.replace("&#10;", " / "))
        subprocess.run(
            ["adb", "-s", "emulator-5554", "shell", "input", "tap", str(x), str(y)],
            check=True,
        )
        break
else:
    print("NOT FOUND")
