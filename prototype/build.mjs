// 把 style.css / app.js 内联进 index.html，产出单文件版「同频原型.html」
// 双击即看，不需要服务器；改了三个源文件后重跑一次即可。
//
// 用法（node 不在 PATH 时用完整路径）：
//   node build.mjs
//   & "C:\Users\lenov\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" build.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');
const css = readFileSync(join(here, 'style.css'), 'utf8');
const js = readFileSync(join(here, 'app.js'), 'utf8');

if (js.includes('</script>')) {
  throw new Error('app.js 里有字面量 </script>，内联会截断，先改掉');
}

const out = html
  // 用函数式替换，避免 $& / $1 之类被当成替换模式
  .replace(/<link rel="stylesheet" href="style\.css"\s*\/?>/, () => '<style>\n' + css + '\n</style>')
  .replace(/<script src="app\.js"><\/script>/, () => '<script>\n' + js + '\n</script>');

if (/href="style\.css"|src="app\.js"/.test(out)) {
  throw new Error('还有外部引用没被内联进去，检查 index.html 里的标签写法');
}

const target = join(here, '同频原型.html');
writeFileSync(target, out, 'utf8');

const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
console.log('单文件版已生成：同频原型.html（' + kb + ' KB，' + out.split('\n').length + ' 行）');
