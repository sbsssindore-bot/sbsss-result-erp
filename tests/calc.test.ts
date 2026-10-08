import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeOf, subjectResult, overallResult, resultStatus, annualSubject, type Band } from '../lib/calc';
import { normalizeClass, normalizeSection, normalizeStream, normalizeSessionLabel, normalizeDate } from '../lib/normalize';

const bands: Band[] = [['A1',91],['A2',81],['B1',71],['B2',61],['C1',51],['C2',41],['D',33],['E1',21],['E2',0]].map(([grade,min])=>({grade:grade as string,min:min as number}));
const comps = [{code:'PT1',label:'PT-I',max:10},{code:'MT',label:'MT',max:10},{code:'FT',label:'First Term',max:80}];

test('grade boundaries use exact percentage, no decimal gaps', () => {
  assert.equal(gradeOf(9100,10000,bands),'A1');
  assert.equal(gradeOf(9099,10000,bands),'A2');
  assert.equal(gradeOf(9050,10000,bands),'A2');
  assert.equal(gradeOf(3300,10000,bands),'D');
  assert.equal(gradeOf(3299,10000,bands),'E1');
  assert.equal(gradeOf(2100,10000,bands),'E1');
  assert.equal(gradeOf(2099,10000,bands),'E2');
  assert.equal(gradeOf(0,10000,bands),'E2');
});
test('subject total, percentage and decimals', () => {
  const r = subjectResult(comps,{PT1:7.5,MT:5,FT:65},bands);
  assert.equal(r.total,77.5); assert.equal(r.pct,77.5); assert.equal(r.grade,'B1'); assert.ok(r.complete);
});
test('missing marks make the subject incomplete; AB counts as zero', () => {
  const a = subjectResult(comps,{PT1:7.5,MT:null,FT:65},bands);
  assert.equal(a.complete,false); assert.equal(a.grade,'—');
  const b = subjectResult(comps,{PT1:'AB',MT:'AB',FT:'AB'},bands);
  assert.equal(b.complete,true); assert.equal(b.total,0); assert.equal(b.grade,'E2');
});
test('XI-XII subject-specific maxima (30+70 and 20+80)', () => {
  const phys = subjectResult([{code:'PRAC',label:'P',max:30},{code:'FT',label:'F',max:70}],{PRAC:27,FT:63},bands);
  const math = subjectResult([{code:'PRAC',label:'P',max:20},{code:'FT',label:'F',max:80}],{PRAC:18,FT:72},bands);
  assert.equal(phys.max,100); assert.equal(phys.pct,90); assert.equal(math.pct,90);
});
test('overall and result rule', () => {
  const ok = subjectResult(comps,{PT1:8,MT:8,FT:60},bands), low = subjectResult(comps,{PT1:2,MT:2,FT:20},bands);
  const o = overallResult([{inOverall:true,r:ok},{inOverall:true,r:low}],bands);
  assert.ok(o.complete); assert.equal(o.pct,(76+24)/2);
  const rule = {mode:'auto',overall_min:33,subject_min:33,required_subject_fail:'FAIL',pass:'PASS',fail:'FAIL'};
  assert.equal(resultStatus(rule,o,[{passRequired:true,r:ok},{passRequired:true,r:low}]),'FAIL');
  assert.equal(resultStatus(rule,o,[{passRequired:true,r:ok},{passRequired:false,r:low}]),'PASS');
  assert.equal(resultStatus({mode:'manual'},o,[]),null);
});
test('annual: weighted average and sum', () => {
  const t1 = subjectResult(comps,{PT1:8,MT:8,FT:64},bands), t2 = subjectResult(comps,{PT1:6,MT:6,FT:48},bands);
  const w = annualSubject([{r:t1,weight:40},{r:t2,weight:60}],'WEIGHTED',bands);
  assert.equal(+w.pct.toFixed(2),68.00); assert.equal(w.grade,'B2');
  const s = annualSubject([{r:t1,weight:1},{r:t2,weight:1}],'SUM',bands);
  assert.equal(s.max,200); assert.equal(s.total,140);
});
test('class / section / stream / session normalisation', () => {
  for (const [t,e] of [['I',1],['1',1],['Class I',1],['1st',1],['Grade 1',1],['Class-VI',6],['VIII',8],['10th',10],['XII',12],['Std. 9',9],[5,5],['13',null],['Nursery',null]] as const) assert.equal(normalizeClass(t),e,String(t));
  for (const [t,e] of [['A','A'],['Section A','A'],['A Section','A'],[' b ','B'],['SEC-C','C'],['',null]] as const) assert.equal(normalizeSection(t),e,String(t));
  assert.equal(normalizeStream('SCI'),'Science'); assert.equal(normalizeStream('commerce'),'Commerce');
  assert.equal(normalizeSessionLabel('2026–27'),'2026-27'); assert.equal(normalizeSessionLabel('2026-2027'),'2026-27');
  assert.equal(normalizeDate('05/04/2014'),'2014-04-05'); assert.equal(normalizeDate('2014-4-5'),'2014-04-05');
});
