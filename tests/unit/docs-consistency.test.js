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
    expect(workflows).toEqual(['ci.yml', 'claude.yml']);
    for (const workflow of workflows) expect(agents).toContain(`\`${workflow}\``);
    for (const absent of ['codeql.yml', 'release.yml', 'scorecard.yml']) expect(agents).not.toContain(absent);
    expect(agents).toContain('Claude workflow grants explicit write permissions');

    for (const workflow of workflows) {
      const uses = [...read(`.github/workflows/${workflow}`).matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)];
      expect(uses.length).toBeGreaterThan(0);
      for (const [, ref] of uses) expect(ref).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  test('documents update traffic, persistence, runner ownership, and reproducible licenses', () => {
    const privacy = read('docs/PRIVACY.md');
    const guide = read('docs/USER_GUIDE.md');
    const contributing = read('CONTRIBUTING.md');
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
    expect(contributing).toContain('tests/electron/**/*.spec.js');
    expect(contributing).toContain('tests/installer/*.test.ps1');

    const { buildInventory } = require('../../scripts/dependency-license-inventory.js');
    expect(JSON.parse(read('docs/dependency-license-inventory.json'))).toEqual(buildInventory());
  });
});
