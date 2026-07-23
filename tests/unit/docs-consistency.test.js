const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('documentation follows executable repository truth', () => {
  test('documents the pinned Node and quality thresholds without stale test counts', () => {
    const pkg = JSON.parse(read('package.json'));
    const coverage = JSON.parse(read('config/coverage-thresholds.json'));
    const tiers = JSON.parse(read('config/mutation-tiers.json'));
    const build = read('docs/BUILD.md');
    const agents = read('AGENTS.md');
    const readme = read('README.md');

    expect(read('.nvmrc').trim()).toBe('24');
    expect(pkg.engines.node).toBe('>=24');
    expect(build).toContain('Node.js 24+');
    expect(build).not.toContain('Node.js 20+');
    expect(build).toContain(`${coverage.unit.statements}% statements / ${coverage.unit.branches}% branches / ${coverage.unit.functions}% functions / ${coverage.unit.lines}% lines`);
    expect(agents).toContain(`${coverage.unit.statements} % statements, ${coverage.unit.branches} % branches, ${coverage.unit.functions} % functions, ${coverage.unit.lines} % lines`);
    expect(build).toContain(`T1 ${tiers.T1.minimum}% / T2 ${tiers.T2.minimum}% / T3 ${tiers.T3.minimum}%`);
    expect(readme).not.toMatch(/tests-[0-9]+%20passing/);
    expect(build).not.toMatch(/\b(?:468|526|994) tests\b/);
    expect(pkg.scripts.coverage).toContain('test:unit:coverage');
    expect(pkg.scripts.coverage).toContain('test:e2e:coverage');
    expect(pkg.scripts.coverage).toContain('report:merge');
  });

  test('names only committed workflows and qualifies their different permissions', () => {
    const workflows = fs.readdirSync(path.join(ROOT, '.github/workflows')).filter(name => /\.ya?ml$/.test(name)).sort();
    const agents = read('AGENTS.md');
    expect(workflows).toEqual(['ci.yml', 'claude.yml', 'release.yml']);
    for (const workflow of workflows) expect(agents).toContain(`\`${workflow}\``);
    for (const absent of ['codeql.yml', 'scorecard.yml']) expect(agents).not.toContain(absent);
    expect(agents).toContain('Claude workflow grants explicit write permissions');
    expect(agents).toContain('Release workflow grants `contents: write`, `id-token: write`, and `attestations: write`');

    for (const workflow of workflows) {
      const uses = [...read(`.github/workflows/${workflow}`).matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)];
      expect(uses.length).toBeGreaterThan(0);
      for (const [, ref] of uses) expect(ref).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  test('documents the exact release repository, artifact contract, checksums, and signing gates', () => {
    const pkg = JSON.parse(read('package.json'));
    const readme = read('README.md');
    const build = read('docs/BUILD.md');
    const { expectedArtifactNames } = require('../../scripts/release-artifacts.js');
    const repository = 'https://github.com/Binary-Parse/BP-MD-RTL-Reader';

    expect(pkg.repository.url).toBe(`git+${repository}.git`);
    for (const document of [readme, build]) expect(document).toContain(repository);
    for (const artifact of expectedArtifactNames(pkg.version)) expect(build).toContain(artifact);
    expect(build).toContain('dist/release');
    expect(build).toContain('npm run package:checksums:verify');
    expect(build).toContain('WIN_CSC_LINK_B64');
    expect(build).toContain('MAC_CSC_LINK_B64');
    expect(build).toContain('signed annotated tag');
    expect(readme).toContain('SHA256SUMS.txt');
    expect(readme).toContain('signed and notarized');
  });

  test('documents update traffic, persistence, runner ownership, and reproducible licenses', () => {
    const privacy = read('docs/PRIVACY.md');
    const guide = read('docs/USER_GUIDE.md');
    expect(privacy).toContain('api.github.com');
    expect(privacy).toContain('no note content');
    expect(privacy).toContain('Remove app only');
    expect(privacy).toContain('Remove app and all app data');
    expect(privacy).toContain('primary button is labeled **Uninstall**');
    expect(privacy).toContain('%APPDATA%\\bpmdrtlreader');
    expect(privacy).toContain('/DELETEUSERDATA');
    expect(privacy).toContain('current Windows account');
    expect(guide).toContain('up to five');
    expect(guide).toContain('Reading mode');
    expect(guide).toContain('capabilities.json');

    const { buildInventory } = require('../../scripts/dependency-license-inventory.js');
    expect(JSON.parse(read('docs/dependency-license-inventory.json'))).toEqual(buildInventory());
  });
});
