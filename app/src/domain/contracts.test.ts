import { coachApprovalDoc, routineDoc, sessionDoc } from './contracts';
import { coachApprovalFixture, routineFixture, sessionFixture } from './fixtures';

test('fixtures satisfy the frozen contracts', () => {
  expect(routineDoc.parse(routineFixture)).toEqual(routineFixture);
  expect(sessionDoc.parse(sessionFixture)).toEqual(sessionFixture);
  expect(coachApprovalDoc.parse(coachApprovalFixture)).toEqual(coachApprovalFixture);
});

test('exercise keys keep catalog source IDs as strings', () => {
  expect(routineDoc.safeParse({ ...routineFixture, exercises: [{ ...routineFixture.exercises[0], exerciseKey: 'catalog:0001' }] }).success).toBe(true);
  expect(routineDoc.safeParse({ ...routineFixture, exercises: [{ ...routineFixture.exercises[0], exerciseKey: '0001' }] }).success).toBe(false);
});
