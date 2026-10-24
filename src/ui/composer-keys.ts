/** Keep chat entry consistent; IME confirmation and held keys never submit. */
export function submitsComposer(event: {
  key: string; shiftKey: boolean; altKey: boolean; repeat: boolean;
  keyCode: number; nativeEvent: { isComposing?: boolean };
}): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.altKey &&
    !event.repeat && !event.nativeEvent.isComposing && event.keyCode !== 229;
}
