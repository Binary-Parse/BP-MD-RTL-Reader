import fs from 'fs';
import path from 'path';

const unitDir = './tests/unit';
const files = fs.readdirSync(unitDir).filter(f => f.endsWith('.test.js'));

for (const file of files) {
  const fp = path.join(unitDir, file);
  let content = fs.readFileSync(fp, 'utf8');

  // 1. احذف أي سطر يستورد من @playwright/test
  content = content.replace(/^import\s+.*?from\s+['"]@playwright\/test['"];?\s*$/gm, '');

  // 2. استبدل test.describe( بـ describe(
  content = content.replace(/test\.describe\(/g, 'describe(');

  // 3. استبدل test.only( بـ it.only( (اختياري)
  content = content.replace(/test\.only\(/g, 'it.only(');

  // 4. استبدل test.skip( بـ it.skip( (اختياري)
  content = content.replace(/test\.skip\(/g, 'it.skip(');

  fs.writeFileSync(fp, content);
  console.log('✅ Fixed:', file);
}