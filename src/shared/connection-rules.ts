import { extractedConnectionSchema, type ExtractedConnection } from './connection-extraction';
import { parseSshCommand } from './ssh-command';

export class ConnectionRuleError extends Error {
  constructor(public readonly reason: 'empty' | 'unsupported' | 'ambiguous' | 'invalid') {
    super(reason);
  }
}

// Deliberately deterministic: explicit labels/SSH destinations only. Never execute input,
// infer credentials, or silently choose one target from multiple conflicting records.
export function extractConnectionByRules(input: string, providerId: ExtractedConnection['providerId'] = 'cshell.ssh'): ExtractedConnection {
  if (!input.trim()) throw new ConnectionRuleError('empty');
  if (input.length > 24000) throw new ConnectionRuleError('invalid');
  const declared=/^(?:协议|连接类型|protocol)\s*[:：=]\s*(ssh|rdp|windows|agent|client|http|https)\s*$/im.exec(input);
  const scheme=/^(ssh|rdp|cshell-agent|https?):\/\//im.exec(input.trim());
  const kind=(declared?.[1]??scheme?.[1])?.toLowerCase();
  const inferred=kind?({ssh:'cshell.ssh',rdp:'cshell.rdp',windows:'cshell.rdp',agent:'cshell.client',client:'cshell.client','cshell-agent':'cshell.client',http:'cshell.http',https:'cshell.http'} as const)[kind as 'ssh']:undefined;
  if(inferred&&inferred!==providerId)throw new ConnectionRuleError('unsupported');
  if(input.trim().startsWith('{')){
    try{
      const value=JSON.parse(input);
      const fields={host:value.host,port:value.port,name:value.name};
      const parsed=extractedConnectionSchema.safeParse({providerId,fields});
      if(providerId!=='cshell.client'||!parsed.success)throw Error();
      return parsed.data;
    }catch{throw new ConnectionRuleError('invalid');}
  }
  if(providerId==='cshell.http'){
    const urls=[...new Set(input.match(/https?:\/\/[^\s<>"']+/g)??[])];
    if(urls.length!==1)throw new ConnectionRuleError(urls.length?'ambiguous':'unsupported');
    const parsed=extractedConnectionSchema.safeParse({providerId,fields:{url:urls[0]}});
    if(!parsed.success)throw new ConnectionRuleError('invalid');return parsed.data;
  }
  const fields: Record<string, string | number> = {};
  const put = (key: string, value: string | number | undefined) => {
    if (value === undefined) return;
    if (fields[key] !== undefined && fields[key] !== value)
      throw new ConnectionRuleError('ambiguous');
    fields[key] = value;
  };
  const destination = (value: string) => {
    const match = /^(?:([^\s@/:]+)@)?(\[[0-9a-f:]+\]|[a-z0-9_.-]+)(?::(\d+))?$/i.exec(value);
    if (!match) throw new ConnectionRuleError('invalid');
    put('username', match[1]);
    put('host', match[2].replace(/^\[|\]$/g, ''));
    if (match[3]) put('port', Number(match[3]));
  };
  const labels: Record<string, string> = {
    主机地址: 'host',
    服务器地址: 'host',
    服务器ip: 'host',
    ip地址: 'host',
    地址: 'host',
    主机: 'host',
    ip: 'host',
    host: 'host',
    hostname: 'host',
    address: 'host',
    端口: 'port',
    port: 'port',
    用户名: 'username',
    用户: 'username',
    账号: 'username',
    账户: 'username',
    username: 'username',
    user: 'username',
    login: 'username',
    密码: 'password',
    password: 'password',
    pass: 'password',
    名称: 'name',
    name: 'name',
    分组: 'group',
    group: 'group',
  };
  const pattern = new RegExp(
    '(?:^|[\\s,，;；]+)(' + Object.keys(labels).join('|') + ')\\s*[:：=]\\s*',
    'gi',
  );
  for (const raw of input.trim().split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^ssh\s/i.test(line)) {
      if(providerId!=='cshell.ssh')throw new ConnectionRuleError('unsupported');
      try {
        const parsed = parseSshCommand(line)!;
        destination(parsed.host.includes(':') ? `[${parsed.host}]` : parsed.host);
        put('username', parsed.username);
        put('port', parsed.port);
      } catch (e) {
        if (e instanceof ConnectionRuleError) throw e;
        throw new ConnectionRuleError('unsupported');
      }
      continue;
    }
    if (/^(ssh|rdp|cshell-agent):\/\//i.test(line)) {
      destination(line.replace(/^[^:]+:\/\//,''));
      continue;
    }
    const matches = [...line.matchAll(pattern)];
    if (matches.length) {
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i],
          key = labels[match[1].toLowerCase()];
        let value = line
          .slice(match.index! + match[0].length, matches[i + 1]?.index ?? line.length)
          .trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        )
          value = value.slice(1, -1);
        if (!value) throw new ConnectionRuleError('invalid');
        if (key === 'host') destination(value);
        else if (key === 'port') {
          if (!/^\d+$/.test(value)) throw new ConnectionRuleError('invalid');
          put(key, Number(value));
        } else put(key, value);
      }
    } else if (
      /^(?:[^\s@/:]+@)?(?:\[[0-9a-f:]+\]|[a-z0-9_-]+(?:\.[a-z0-9_-]+)+)(?::\d+)?$/i.test(line)
    )
      destination(line);
  }
  if (!fields.host) throw new ConnectionRuleError('unsupported');
  const parsed = extractedConnectionSchema.safeParse({ providerId, fields });
  if (!parsed.success) throw new ConnectionRuleError('invalid');
  return parsed.data;
}
