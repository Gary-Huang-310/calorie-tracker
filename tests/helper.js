// 測試用：把 index.html 引用的外部 script 內嵌回去，讓 jsdom 可以直接執行。
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
exports.html = function () {
  let h = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  h = h.replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
    '<script>' + fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script>/gi, '<\\/script>') + '</script>');
  return h;
};
