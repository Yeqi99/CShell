// CommonMark treats some CJK punctuation beside ** as non-delimiters. Repair
// only literal text nodes; fenced/inline code and escaped asterisks stay intact.
export function remarkCjkStrong() {
  return (tree: any, file: any) => {
    const visit = (node: any) => {
      if (!node.children || ['code', 'inlineCode', 'strong'].includes(node.type)) return;
      node.children = node.children.flatMap((child: any) => {
        if (child.type !== 'text') {
          visit(child);
          return [child];
        }
        const raw = String(file.value).slice(
          child.position?.start.offset,
          child.position?.end.offset,
        );
        if (raw.includes('\\*')) return [child];
        const value: string = child.value,
          pieces: any[] = [];
        let end = 0;
        for (const match of value.matchAll(/\*\*([^*\n]+)\*\*/g)) {
          if (!/[\u3000-\u9fff]/.test(match[1])) continue;
          pieces.push(
            { type: 'text', value: value.slice(end, match.index) },
            { type: 'strong', children: [{ type: 'text', value: match[1] }] },
          );
          end = match.index! + match[0].length;
        }
        return end ? [...pieces, { type: 'text', value: value.slice(end) }] : [child];
      });
    };
    visit(tree);
  };
}
