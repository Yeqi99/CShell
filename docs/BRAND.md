# 品牌标识 · 0.7.6

CShell 与 CAgent 共用开口 C 轮廓及深色圆角底，分别以终端提示符和像素节点区分用途。基础版保持蓝色与绿色，Pro 增加金色标签。

0.7.6 按用户提供的品牌参考图更新：CShell 为蓝青渐变 C 与白色终端符号，CAgent 为薄荷绿渐变 C 与像素节点，均使用深色圆角底。Pro 共用基础图形并增加金色标识。正式资源为可编辑 SVG，PNG 与多尺寸 ICO 从同一源文件渲染。Pro 仅提供设计资源，不代表商业版本已经发布。`assets/brand/generated/` 保留旧版概念图，不参与当前应用构建。

## 历史概念图提示词（不用于当前资源）

- CShell：production app icon; bold geometric white C shell enclosing terminal >_; deep ink navy tile, electric blue accent; flat vector-like geometry, transparent surround, no text.
- CAgent：same family C silhouette; replace terminal with mint four-point spark; dark teal tile; clean, small-size readable, no robot face.
- CShell Pro：preserve silhouette and terminal; champagne gold C, pale gold prompt, dark navy tile and thin inset gold border; no crown or Pro lettering.
- CAgent Pro：preserve CAgent silhouette and spark; champagne gold C, pale mint-gold spark, dark teal tile and thin gold inset border.

## 资产与再生成

- 基础版：`assets/icon.svg`、`assets/cagent-icon.svg`，对应 PNG / ICO。
- 品牌目录：`assets/brand/cshell.svg`、`cagent.svg`、`cshell-pro.svg`、`cagent-pro.svg`。
- Windows CAgent 的窗口品牌和托盘从可执行文件内嵌图标读取，同安装图标一致。
- Android 构建复制同一 CShell 图标；macOS / Linux 包装使用共享 PNG。
- `node scripts/build-brand-vectors.mjs` 从当前设计参数重建 SVG。
- 运行 `electron scripts/render-icon.cjs icon`、`cagent-icon`、`brand/cshell-pro` 或 `brand/cagent-pro` 更新输出。

当前发布为开源版，Pro 素材不改变授权、功能或现有应用名称。
