/** Same event choices for local WeChat and an explicitly connected CAgent. */
export function wechatEventTypes() {
  return [
    { id: 'message.received', name: '收到消息' },
    { id: 'transfer.received', name: '收到转账' },
    { id: 'red_packet.received', name: '收到红包' },
  ];
}
