import { randomUUID } from 'node:crypto';
import {
  applicationRequestSchema,
  applications,
  type ApplicationRequest,
  type InstallationPlan,
} from '../shared/plugins';
import { RemoteJobs, quote } from './remote-jobs';
import { httpsText } from './plugins';

export class ApplicationService {
  private plans = new Map<string, InstallationPlan>();
  constructor(private jobs: RemoteJobs) {}
  async plan(sessionId: string, input: ApplicationRequest) {
    const request = applicationRequestSchema.parse(input);
    const platform = (
      await this.jobs.exec(sessionId, '# cshell:platform\nuname -s; uname -m; id -u')
    )
      .trim()
      .split('\n')
      .map((s) => s.trim());
    if (platform[0] !== 'Linux')
      throw new Error('Application recipes currently support Linux servers');
    let command: string;
    if (request.app === 'miniconda' || request.app === 'anaconda') {
      if (!['x86_64', 'aarch64'].includes(platform[1]))
        throw new Error('No installer for this architecture');
      const full = request.app === 'anaconda';
      const base = full
        ? 'https://repo.anaconda.com/archive/'
        : 'https://repo.anaconda.com/miniconda/';
      const html = await httpsText(base, 8_000_000);
      const filenamePattern = full
        ? `Anaconda3-[0-9][^"<>/ ]*-Linux-${platform[1]}\\.sh`
        : `Miniconda3-py[^"<>/ ]*-Linux-${platform[1]}\\.sh`;
      const entries = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
        .map((m) => ({
          file: m[1].match(new RegExp(filenamePattern))?.[0],
          hash: m[1].match(/\b[a-f0-9]{64}\b/)?.[0],
        }))
        .filter((e) => e.file && e.hash)
        .sort((a, b) => b.file!.localeCompare(a.file!, 'en', { numeric: true }));
      const installer = entries[0];
      if (!installer) throw new Error('Could not verify an official installer checksum');
      const directory = full ? 'anaconda3' : 'miniconda3';
      command = `set -eu\n[ ! -e "$HOME/${directory}" ] || { echo 'Installation directory already exists'; exit 1; }\nf=$(mktemp)\ntrap 'rm -f "$f"' EXIT\ncurl --fail --location --proto '=https' --tlsv1.2 ${quote(base + installer.file)} -o "$f"\nprintf '%s  %s\\n' ${quote(installer.hash!)} "$f" | sha256sum --check -\nbash "$f" -b -p "$HOME/${directory}"\n"$HOME/${directory}/bin/conda" --version`;
    } else if (request.app === 'python') {
      if (!request.conda) throw new Error('CONDA_MISSING: Install Miniconda or Anaconda first');
      command = `${quote(request.conda)} create --yes --name ${quote(request.name)} ${quote('python=' + request.version)}`;
    } else if (request.app === 'jupyter' || request.app === 'jedi') {
      if (!request.python) throw new Error('PYTHON_MISSING: Select a Python environment first');
      command = `${quote(request.python)} -m pip install --disable-pip-version-check ${request.app === 'jedi' ? "'jedi>=0.19,<0.21'" : "'jupyterlab>=4,<5'"}`;
    } else {
      if (platform[2] !== '0')
        throw new Error(
          'This recipe requires a server connection as administrator; automatic sudo is disabled',
        );
      const pkg = request.app === 'redis' ? 'redis-server' : 'nginx';
      command = `set -eu\ncommand -v apt-get >/dev/null || { echo 'This recipe supports Debian / Ubuntu'; exit 1; }\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y ${pkg}\nsystemctl enable --now ${pkg}\nsystemctl is-active ${pkg}`;
    }
    for (const [id, plan] of this.plans) if (plan.expires < Date.now()) this.plans.delete(id);
    if (this.plans.size >= 100) throw new Error('Too many pending installation plans');
    const plan: InstallationPlan = {
      id: randomUUID(),
      sessionId,
      app: request.app,
      label: applications.find((a) => a.id === request.app)!.name,
      command,
      expires: Date.now() + 15 * 60_000,
    };
    this.plans.set(plan.id, plan);
    return { ...plan };
  }
  install(id: string, sessionId?: string) {
    const plan = this.plans.get(id);
    if (!plan || plan.expires < Date.now())
      throw new Error('Installation plan expired; check the server again');
    if (sessionId !== undefined && plan.sessionId !== sessionId)
      throw new Error('Installation plan belongs to another session');
    const job = this.jobs.start(plan.sessionId, plan.label, plan.command);
    this.plans.delete(id);
    return job;
  }
}
