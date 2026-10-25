// The host sends exactly one JSON request and closes stdin. Stdout is the response only.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (Buffer.byteLength(input) > 65536) process.exit(1); });
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  process.stdout.write(JSON.stringify({ protocol: 1, id: request.id, result: { text: request.args.text.toUpperCase() } }));
});
