import type { AiContext } from './types.js';

/**
 * The model is given the *shape* of the office (buildings, floors, zones,
 * departments) but never the employee directory. Names are resolved server-side
 * against the database, which keeps personal data out of third-party prompts and
 * makes hallucinated employees fail closed.
 */
export function buildSystemPrompt(context: AiContext): string {
  const floorLines = context.buildings
    .flatMap((building) =>
      building.floors.map(
        (floor) =>
          '  - "' +
          floor.name +
          '" (floor number ' +
          floor.floorNumber +
          ') in building "' +
          building.name +
          '" [' +
          building.code +
          '], seat zones: ' +
          (floor.zones.join(', ') || 'none'),
      ),
    )
    .join('\n');

  return [
    'You are the intent parser for SeatFlow, an office seating management tool.',
    'Convert the administrator request into exactly one JSON object. Output JSON only:',
    'no prose, no markdown fences, no explanation outside the JSON.',
    '',
    'Office layout:',
    floorLines || '  (no floors configured)',
    '',
    'Departments: ' + (context.departments.join(', ') || '(none)'),
    'Seat codes look like "' + context.seatCodeExample + '" (a zone letter, a dash, two digits).',
    'Zone letters are unique across the whole company, so a seat code identifies one seat.',
    '',
    'Respond with this JSON shape (omit fields that do not apply):',
    '{',
    '  "action": one of MOVE_EMPLOYEE | ASSIGN_EMPLOYEE | RELEASE_SEAT | BULK_MOVE_DEPARTMENT |',
    '            QUERY_AVAILABLE_SEATS | QUERY_OCCUPANCY | FIND_SEAT_NEAR_TEAM |',
    '            CLARIFICATION_NEEDED | UNSUPPORTED,',
    '  "employeeQuery": string,   // the person as written by the admin, e.g. "Rahul Sharma"',
    '  "fromSeatCode": string,    // current seat, when the admin stated one',
    '  "toSeatCode": string,      // destination seat for a move/assign',
    '  "seatCode": string,        // the seat for RELEASE_SEAT',
    '  "department": string,      // e.g. "Marketing"',
    '  "floorQuery": string,      // e.g. "Floor 2", "Third Floor", "2"',
    '  "buildingQuery": string,   // e.g. "Nova Annex"',
    '  "zone": string,            // a single zone letter such as "B"',
    '  "onlyUnassigned": boolean, // true when the admin says "unassigned"/"available" people',
    '  "limit": number,           // how many results to return for queries',
    '  "reason": string,          // one short sentence describing what you understood',
    '  "clarification": string,   // the question to ask when action is CLARIFICATION_NEEDED',
    '  "confidence": number       // 0..1',
    '}',
    '',
    'Rules:',
    '1. Never invent employee names, seat codes, floors or departments. Copy what the admin wrote.',
    '2. Use MOVE_EMPLOYEE when the person already has a seat or the admin says "move".',
    '3. Use ASSIGN_EMPLOYEE for "assign", "seat", "put" when no current seat is implied.',
    '4. If a destination is described rather than named (for example "the next available seat',
    '   on Floor 2"), leave toSeatCode empty and set floorQuery instead.',
    '5. Use QUERY_AVAILABLE_SEATS for "which/what seats are free", QUERY_OCCUPANCY for',
    '   "how many seats are occupied/what is the occupancy".',
    '6. Use FIND_SEAT_NEAR_TEAM for "find a seat near the <department> team".',
    '7. Use BULK_MOVE_DEPARTMENT for requests covering a whole department.',
    '8. Use CLARIFICATION_NEEDED when a required detail is missing (for example a move with no',
    '   destination) and put the question in "clarification".',
    '9. Use UNSUPPORTED for anything unrelated to seating, or for deleting/creating records.',
    '10. Return the JSON object and nothing else.',
  ].join('\n');
}

export function buildUserPrompt(prompt: string): string {
  return 'Administrator request: ' + prompt.trim();
}

/**
 * Models occasionally wrap JSON in markdown fences or add a sentence around it.
 * Pull out the first balanced JSON object rather than failing the request.
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? text;

  try {
    return JSON.parse(candidate);
  } catch {
    // fall through to brace scanning
  }

  const start = candidate.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in model response');

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, index + 1));
      }
    }
  }

  throw new Error('Unterminated JSON object in model response');
}
