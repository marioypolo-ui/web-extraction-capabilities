# 浏览器、登录和人工验证

浏览器能力使用调用应用安装的 Playwright：

```powershell
npm install playwright
```

公开页面点击流程：

```js
await extract({
  capabilityId: 'browser-click',
  url,
  config: {
    clicks: [
      { text: '全部公告' },
      { text: '采购公告' }
    ]
  }
});
```

登录页面只能使用应用自己管理的 `storageStatePath` 或已授权 `cdpEndpoint`：

```js
await extract({
  capabilityId: 'authenticated-session',
  url,
  config: { storageStatePath: applicationOwnedPath }
});
```

不要把 storage state、Cookie、密码或 Profile 复制进 bundle、fixture、日志或贡献包。

检测到滑块、验证码或人机验证时返回 `HUMAN_VERIFICATION_REQUIRED`。应用可以暂停任务，通知用户在授权浏览器中完成验证，再使用同一会话恢复。中央库不提供识别、破解或绕过功能。
