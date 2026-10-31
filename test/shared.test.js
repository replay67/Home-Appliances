'use strict';
const test = require('node:test');
const assert = require('node:assert');
const HP = require('../public/shared.js');

const fresh = () => {
  const s = HP.defaultState();
  s.tasks = [];
  s.members = [{ id: 'm1', name: 'Anna', color: '#2f6f5e' }, { id: 'm2', name: 'Ben', color: '#c0713b' }];
  return s;
};
const add = (s, task, by = 'm1', date = '2026-10-31') =>
  HP.applyOp(s, { type: 'task.add', by, date, task: { id: 't1', title: 'Bad putzen', dueDate: date, ...task } });

test('neue Aufgabe merkt sich, wer sie angelegt hat', () => {
  const s = fresh();
  add(s, {});
  assert.equal(s.tasks[0].createdBy, 'm1');
  assert.match(s.activity.at(-1).text, /angelegt/);
  assert.equal(s.activity.at(-1).by, 'm1');
});

test('wiederkehrende Aufgabe erledigen: Protokoll mit Person, neuer Termin', () => {
  const s = fresh();
  add(s, { recurrence: 'weekly' });
  HP.applyOp(s, { type: 'task.complete', id: 't1', logId: 'l1', by: 'm2', date: '2026-10-31' });
  assert.equal(s.tasks[0].dueDate, '2026-11-07');
  assert.equal(s.log[0].by, 'm2');
  HP.applyOp(s, { type: 'task.uncomplete', logId: 'l1', by: 'm2', date: '2026-10-31' });
  assert.equal(s.tasks[0].dueDate, '2026-10-31');
  assert.equal(s.log.length, 0);
});

test('werktags überspringt das Wochenende', () => {
  const s = fresh();
  add(s, { recurrence: 'weekdays', dueDate: '2026-10-30' }); // Freitag
  HP.applyOp(s, { type: 'task.complete', id: 't1', logId: 'l1', by: 'm1', date: '2026-10-30' });
  assert.equal(s.tasks[0].dueDate, '2026-11-02'); // Montag
});

test('monatlich am 31. landet am Monatsende', () => {
  assert.equal(HP.addMonths('2026-01-31', 1), '2026-02-28');
});

test('doppeltes Erledigen derselben einmaligen Aufgabe wird abgelehnt', () => {
  const s = fresh();
  add(s, {});
  HP.applyOp(s, { type: 'task.complete', id: 't1', logId: 'a', by: 'm1', date: '2026-10-31' });
  assert.throws(() => HP.applyOp(s, { type: 'task.complete', id: 't1', logId: 'b', by: 'm2', date: '2026-10-31' }), HP.OpError);
});

test('gelöschte Aufgabe kann nicht mehr bearbeitet werden', () => {
  const s = fresh();
  add(s, {});
  HP.applyOp(s, { type: 'task.delete', id: 't1', by: 'm1' });
  assert.throws(() => HP.applyOp(s, { type: 'task.update', id: 't1', fields: { title: 'x' } }), HP.OpError);
});

test('Person entfernen hebt Zuweisungen auf', () => {
  const s = fresh();
  add(s, { assignee: 'm2' });
  HP.applyOp(s, { type: 'member.remove', id: 'm2', by: 'm1' });
  assert.equal(s.tasks[0].assignee, null);
  assert.equal(s.members.length, 1);
});

test('Eingaben werden bereinigt', () => {
  const s = fresh();
  add(s, { title: 'x'.repeat(500), priority: 99, recurrence: 'quatsch', dueDate: 'kein-datum', category: '<script>' });
  const t = s.tasks[0];
  assert.equal(t.title.length, 100);
  assert.equal(t.priority, 3);
  assert.equal(t.recurrence, 'none');
  assert.equal(t.category, 'haushalt');
  assert.ok(HP.isISODate(t.dueDate));
});

test('Version steigt mit jeder Änderung', () => {
  const s = fresh();
  const v = s.version;
  add(s, {});
  HP.applyOp(s, { type: 'task.postpone', id: 't1', days: 1, by: 'm1', date: '2026-10-31' });
  assert.equal(s.version, v + 2);
});
