import { screenshotOutput } from '../shared/visual-tools';
type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
/** REST retains the exact JSON bytes; only MCP transports attach a native image block. */
export function withMcpImage(result: TextResult) {
  if (result.isError || result.content.length !== 1) return result;
  try {
    const first = JSON.parse(result.content[0].text),
      value = typeof first === 'string' ? JSON.parse(first) : first;
    const parsed = screenshotOutput.safeParse(value);
    if (!parsed.success) return result;
    const image = parsed.data,
      bytes = Buffer.from(image.dataBase64, 'base64');
    if (
      bytes.length < 4 ||
      bytes.length > 2 * 1024 * 1024 ||
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes[2] !== 255 ||
      bytes.toString('base64') !== image.dataBase64
    )
      return result;
    const { dataBase64, ...metadata } = image;
    return {
      ...result,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ...metadata, image: 'Attached as image content' }),
        },
        { type: 'image' as const, data: dataBase64, mimeType: image.mimeType },
      ],
    };
  } catch {
    return result;
  }
}
