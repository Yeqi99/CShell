# 0.8.11 后续：Android 手势队列

状态：实现与 Android 测试编译通过，尚未完成模拟器/真机运行验收，未发布。

## 可确认的问题

`AndroidControlService.drainInputs` 原来仅等待文本编辑，不等待异步手势。`gesture` 在 `gestureBusy` 时直接返回，快速连续点击、滚轮可能被消费却不执行。这与此前首次点击偶发失败不是同一已证明根因，不能宣称此修复解决首次点击问题。

## 实现

- 输入队列在文本编辑或手势运行时等待；手势结果回调在输入线程串行处理。
- 记录 submitted / completed / cancelled / rejected / dispatch-error / completion-unknown，不记录输入文本或屏幕内容。
- 回调超过有界期限时，清除依赖的排队输入并重置按键状态；不重试或重放副作用。迟到回调通过序号与运行状态隔离。
- AndroidInputTest 在真实加密远控连接上连续发送三次点击，不等待各次手势完成，要求合计四次准确点击；保留后续输入、Unicode 删除、选择区删除验证。

## 证据与待办

Core `compileDebugAndroidTestJavaWithJavac --offline` 通过（29 tasks，2026-10-27）；本机 adb 未连接任何设备。编译只证明 Java/Android 接口一致，不证明手势运行正确。

下一步在 API 29 / 35 真实模拟器运行完整 capture/input 验收，检查连续点击无丢失、无重复，并核对取消/拒绝/超时后的输入状态。同步 Pro 后需复查编译及运行结果。还需另外两个独立、有实际用途的问题修复才能立项下一小版本，不把状态字段和测试各算一个功能。
