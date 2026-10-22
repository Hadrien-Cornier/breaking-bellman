const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function content() {
  const context = { window: {} };
  context.window.window = context.window;
  vm.createContext(context);
  for (const file of ['web/content.js', 'web/content2.js', 'web/measured.js', 'web/content3.js', 'web/fetch-level.js', 'web/quiz-content.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  return context.window.CONTENT;
}

function questions(c) {
  return c.levels.flatMap((level) => ['predict', 'diagnose', 'explain']
    .filter((kind) => level[kind])
    .map((kind) => ({ level: level.id, kind, question: level[kind] })));
}

test('every campaign quiz has one defensible answer and complete per-option feedback', () => {
  const qs = questions(content());
  assert.equal(qs.length, 50);
  for (const { level, kind, question } of qs) {
    const where = `${level} ${kind}`;
    assert.equal(question.options.length, 3, `${where} option count`);
    assert.equal(question.options.filter((option) => option.correct).length, 1, `${where} correct answer count`);
    for (const option of question.options) {
      assert.equal(option.steps.length, 3, `${where} reasoning-step count`);
      assert.ok(option.steps.every((step) => step.trim().length >= 20), `${where} detailed reasoning`);
      assert.ok(option.result.trim().length >= 10, `${where} result`);
      assert.ok(option.why.trim().length >= 50, `${where} targeted feedback`);
    }
  }
});

test('quiz choices do not expose correctness through gross length or answer position', () => {
  const qs = questions(content());
  const positions = [0, 0, 0];
  for (const { level, kind, question } of qs) {
    const lengths = question.options.map((option) => option.steps.join(' ').length + option.result.length);
    assert.ok(Math.max(...lengths) / Math.min(...lengths) < 1.5,
      `${level} ${kind} has a gross length cue: ${lengths.join(', ')}`);

    const shift = [...question.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % question.options.length;
    const correct = question.options.findIndex((option) => option.correct);
    positions[(correct - shift + question.options.length) % question.options.length]++;
  }
  assert.ok(Math.min(...positions) >= qs.length / 4, `correct answers are position-cued: ${positions.join(', ')}`);
});
