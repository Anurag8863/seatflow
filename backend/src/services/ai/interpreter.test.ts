import { describe, expect, it } from 'vitest';
import { interpretLocally, normalizeSeatCode } from './providers/local.js';
import { extractJson } from './prompt.js';
import { aiIntentSchema } from './types.js';
import type { AiContext } from './types.js';

/**
 * Pure unit tests — no database, no network. These cover the deterministic
 * interpreter and the response parsing that every provider shares.
 */

const context: AiContext = {
  buildings: [
    {
      name: 'Orion HQ',
      code: 'ORN',
      floors: [
        { name: 'Floor 1', floorNumber: 1, zones: ['A', 'B', 'C'] },
        { name: 'Floor 2', floorNumber: 2, zones: ['D', 'E'] },
        { name: 'Floor 3', floorNumber: 3, zones: ['G', 'H'] },
      ],
    },
    {
      name: 'Nova Annex',
      code: 'NVA',
      floors: [{ name: 'Floor 1', floorNumber: 1, zones: ['J', 'K'] }],
    },
  ],
  departments: ['Engineering', 'Product', 'Design', 'Marketing', 'HR', 'Finance', 'Operations'],
  seatCodeExample: 'A-01',
};

describe('normalizeSeatCode', () => {
  it('canonicalises the ways a seat code gets typed', () => {
    expect(normalizeSeatCode('A-12')).toBe('A-12');
    expect(normalizeSeatCode('a12')).toBe('A-12');
    expect(normalizeSeatCode('A 12')).toBe('A-12');
    expect(normalizeSeatCode('b-7')).toBe('B-07');
    expect(normalizeSeatCode('seat C-3 please')).toBe('C-03');
  });

  it('returns null when there is no seat code', () => {
    expect(normalizeSeatCode('move everyone downstairs')).toBeNull();
  });
});

describe('local interpreter', () => {
  const parse = (prompt: string) => aiIntentSchema.parse(interpretLocally(prompt, context));

  it('reads a move with an explicit destination seat', () => {
    const intent = parse('Move Rahul Sharma to seat A-24.');
    expect(intent.action).toBe('MOVE_EMPLOYEE');
    expect(intent.employeeQuery).toBe('Rahul Sharma');
    expect(intent.toSeatCode).toBe('A-24');
  });

  it('reads a move that names both the current and the new seat', () => {
    const intent = parse('Move Priya from A-12 to B-07.');
    expect(intent.action).toBe('MOVE_EMPLOYEE');
    expect(intent.employeeQuery).toBe('Priya');
    expect(intent.fromSeatCode).toBe('A-12');
    expect(intent.toSeatCode).toBe('B-07');
  });

  it('reads an assignment to the next free seat on a floor', () => {
    const intent = parse('Assign John to the next available seat on Floor 2.');
    expect(intent.action).toBe('ASSIGN_EMPLOYEE');
    expect(intent.employeeQuery).toBe('John');
    expect(intent.floorQuery).toBe('Floor 2');
    expect(intent.toSeatCode).toBeFalsy();
  });

  it('recognises a proximity request', () => {
    const intent = parse('Find an available seat near the engineering team.');
    expect(intent.action).toBe('FIND_SEAT_NEAR_TEAM');
    expect(intent.department).toBe('Engineering');
  });

  it('recognises a bulk departmental move', () => {
    const intent = parse('Move all available marketing employees to Floor 3.');
    expect(intent.action).toBe('BULK_MOVE_DEPARTMENT');
    expect(intent.department).toBe('Marketing');
    expect(intent.floorQuery).toBe('Floor 3');
    expect(intent.onlyUnassigned).toBe(true);
  });

  it('asks which floor when a bulk move has no destination', () => {
    const intent = parse('Move all marketing employees somewhere else.');
    expect(intent.action).toBe('BULK_MOVE_DEPARTMENT');
    expect(intent.clarification).toContain('floor');
  });

  it('answers availability questions as a read-only query', () => {
    const intent = parse('Which seats are available on Floor 2?');
    expect(intent.action).toBe('QUERY_AVAILABLE_SEATS');
    expect(intent.floorQuery).toBe('Floor 2');
  });

  it('answers occupancy questions as a read-only query', () => {
    const intent = parse('How many seats are occupied on Floor 1?');
    expect(intent.action).toBe('QUERY_OCCUPANCY');
    expect(intent.floorQuery).toBe('Floor 1');
  });

  it('understands ordinal floor wording', () => {
    expect(parse('How many seats are occupied on the third floor?').floorQuery).toBe('Floor 3');
  });

  it('picks up the building when one is named', () => {
    const intent = parse('Which seats are free on Floor 1 of the Nova Annex?');
    expect(intent.action).toBe('QUERY_AVAILABLE_SEATS');
    expect(intent.buildingQuery).toBe('Nova Annex');
  });

  it('reads a seat release', () => {
    const intent = parse('Release seat A-05.');
    expect(intent.action).toBe('RELEASE_SEAT');
    expect(intent.seatCode).toBe('A-05');
  });

  it('reads a release addressed to a person', () => {
    const intent = parse("Release Priya Nair's seat");
    expect(intent.action).toBe('RELEASE_SEAT');
    expect(intent.employeeQuery).toBe('Priya Nair');
  });

  it('asks for a destination when a move has none', () => {
    const intent = parse('Move Rahul Sharma');
    expect(intent.action).toBe('CLARIFICATION_NEEDED');
    expect(intent.clarification).toContain('Rahul Sharma');
  });

  it('declines requests that are not about seating', () => {
    expect(parse('Delete the production database').action).toBe('UNSUPPORTED');
    expect(parse('What is the weather today?').action).toBe('UNSUPPORTED');
  });

  it('always produces a schema-valid intent', () => {
    const prompts = [
      'Move Rahul Sharma to seat A-24.',
      'Assign John to the next available seat on Floor 2.',
      'Release seat A-05.',
      'nonsense input !!!',
      '',
    ];
    for (const prompt of prompts) {
      expect(() => aiIntentSchema.parse(interpretLocally(prompt, context))).not.toThrow();
    }
  });
});

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"action":"MOVE_EMPLOYEE"}')).toEqual({ action: 'MOVE_EMPLOYEE' });
  });

  it('unwraps a fenced code block', () => {
    const raw = '```json\n{"action":"RELEASE_SEAT","seatCode":"A-01"}\n```';
    expect(extractJson(raw)).toEqual({ action: 'RELEASE_SEAT', seatCode: 'A-01' });
  });

  it('finds the object when a model adds surrounding prose', () => {
    const raw = 'Sure! Here is the result:\n{"action":"QUERY_OCCUPANCY","floorQuery":"Floor 1"}\nHope that helps.';
    expect(extractJson(raw)).toEqual({ action: 'QUERY_OCCUPANCY', floorQuery: 'Floor 1' });
  });

  it('is not confused by braces inside strings', () => {
    const raw = '{"action":"MOVE_EMPLOYEE","reason":"contains a } brace"}';
    expect(extractJson(raw)).toEqual({ action: 'MOVE_EMPLOYEE', reason: 'contains a } brace' });
  });

  it('throws when there is no JSON at all', () => {
    expect(() => extractJson('I am sorry, I cannot help with that.')).toThrow();
  });
});

describe('aiIntentSchema', () => {
  it('rejects an action the system does not implement', () => {
    expect(() => aiIntentSchema.parse({ action: 'DROP_TABLE_SEATS' })).toThrow();
  });

  it('rejects a confidence outside 0..1', () => {
    expect(() => aiIntentSchema.parse({ action: 'MOVE_EMPLOYEE', confidence: 4 })).toThrow();
  });

  it('strips unknown fields a model might invent', () => {
    const parsed = aiIntentSchema.parse({
      action: 'MOVE_EMPLOYEE',
      employeeQuery: 'Ada',
      toSeatCode: 'A-01',
      sql: 'DELETE FROM "Seat";',
    });
    expect(parsed).not.toHaveProperty('sql');
  });
});
