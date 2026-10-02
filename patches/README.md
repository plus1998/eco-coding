# React 开发版性能记录

`react-dom@19.2.6.patch` 回移 React 上游 [#34803](https://github.com/react/react/pull/34803) 的性能记录清理行为，覆盖普通开发入口和 profiling 开发入口。通过局部 `measureAndClear` 函数让每次记录完成后立即按名称清理 User Timing 缓冲区；DevTools 仍能接收性能轨迹，业务的 Performance API 不受影响。

原因见 [#34770](https://github.com/react/react/issues/34770)：频繁更新会不断保留结构化克隆的 props 差异，导致长时间运行的开发版 renderer 内存增长。补丁不捕获或隐藏 `measure` 异常，也不关闭 React 开发检查。

桌面端暂时固定 React / React DOM 的版本以确保 Bun 补丁始终应用。升级时先确认新版本已包含该清理逻辑，再移除版本固定和 `patchedDependencies`。安装依赖后须重启 Vite，让预构建依赖包含补丁。

此修复针对性能记录累积，不限制单次 props 序列化；如清理后仍有 OOM，应继续检查大型对象、浏览器宿主对象和循环引用进入 props 的路径（[上游 #37330](https://github.com/react/react/issues/37330)）。
