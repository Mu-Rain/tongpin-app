'use strict';
// 语法检查 + 哈希逻辑单测：不依赖 uniCloud，只测纯函数部分
const assert = require('assert');
const crypto = require('crypto');

// 从两个云函数里把哈希逻辑抠出来复现，确保两边规则一致
function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, useSalt, 32).toString('hex');
  return `${useSalt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || stored.indexOf(':') === -1) return false;
  const salt = stored.split(':')[0];
  const expect = hashPassword(password, salt);
  if (expect.length !== stored.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(stored));
}

const stored = hashPassword('abc123456');
console.log('stored =', stored.slice(0, 40) + '...');
assert.ok(verifyPassword('abc123456', stored), '正确密码应通过');
assert.ok(!verifyPassword('abc123457', stored), '错误密码应拒绝');
assert.ok(!verifyPassword('', stored), '空密码应拒绝');
assert.ok(!verifyPassword('abc123456', 'garbage'), '坏格式应拒绝');

// 同一个密码两次哈希必须不同（盐随机）
assert.notStrictEqual(hashPassword('x'), hashPassword('x'), '盐必须随机');

// 手机号规则
const isValidPhone = (p) => typeof p === 'string' && /^1[3-9]\d{9}$/.test(p);
assert.ok(isValidPhone('13800138000'));
assert.ok(!isValidPhone('12345678901'), '12 开头不是手机号');
assert.ok(!isValidPhone('1380013800'), '十位不合法');
assert.ok(!isValidPhone('138001380000'), '十二位不合法');

console.log('ALL ASSERTIONS PASSED');
