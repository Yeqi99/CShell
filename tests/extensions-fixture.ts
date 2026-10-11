import type { ServerChannel, Connection } from 'ssh2';
export function extensionsFixture() {
  const commands: string[] = [],
    inputs: string[] = [];
  const environments = ['/home/test/miniconda3', '/home/test/miniconda3/envs/science'];
  return {
    commands,
    inputs,
    attach(client: Connection) {
      client.on('tcpip', (accept, reject, info) => {
        if (info.destIP !== '127.0.0.1' || info.destPort !== 8888) {
          reject();
          return;
        }
        const channel = accept();
        channel.on('error', () => {});
        channel.once('data', () =>
          channel.end('HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nJupyter'),
        );
      });
    },
    handle(command: string, stream: ServerChannel) {
      const known =
        /cshell:environment-detect|cshell:platform|conda' (env list|info --base|create|env remove|run)|-m pip|import json,sys,ast|# cshell:wait|# cshell:failure|import jupyterlab|-m jupyterlab/.test(
          command,
        );
      if (!known) return false;
      commands.push(command);
      if (command.includes('-m jupyterlab')) {
        stream.on('error', () => {});
        setTimeout(
          () => stream.stderr.write('Jupyter Server running at http://127.0.0.1:8888/lab'),
          20,
        );
        return true;
      }
      stream.on('error', () => {});
      if (command.includes('# cshell:wait')) {
        stream.write('running\n');
        return true;
      }
      if (command.includes(' run --no-capture-output')) {
        stream.write('(science) $ ');
        stream.on('data', (data: Buffer) => stream.write(data));
        return true;
      }
      let input = '';
      stream.on('data', (data: Buffer) => (input += data.toString()));
      stream.on('end', () => {
        inputs.push(input);
        let result = '';
        if (command.includes('cshell:environment-detect'))
          result = '/usr/bin/python3\nCONDA=/home/test/miniconda3/bin/conda\n';
        else if (command.includes('cshell:platform')) result = 'Linux\nx86_64\n1000\n';
        else if (command.includes('env list')) result = JSON.stringify({ envs: environments });
        else if (command.includes('info --base')) result = '/home/test/miniconda3\n';
        else if (command.includes('import json,sys,ast'))
          result = JSON.stringify({
            completions: [{ label: 'path', detail: 'module path', type: 'module' }],
            signatures: [],
            diagnostics: [],
          });
        else if (command.includes('pip list'))
          result = JSON.stringify([
            { name: 'jedi', version: '0.19.2' },
            { name: 'numpy', version: '2.3.0' },
          ]);
        else result = 'Installed successfully\n';
        if (command.includes('# cshell:failure')) {
          stream.stderr.write('permission denied');
          stream.exit(1);
          stream.end();
        } else {
          stream.write(result);
          stream.exit(0);
          stream.end();
        }
      });
      return true;
    },
  };
}
