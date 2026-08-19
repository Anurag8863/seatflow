import type { AiContext, AiIntent, AiProvider } from '../types.js';

/**
 * A deterministic, dependency-free interpreter used when AI_PROVIDER=local.
 *
 * It exists so the assistant is fully demonstrable (and testable) without an
 * external API key, and so the rest of the AI pipeline — resolution, preview,
 * confirmation, execution, audit — can be exercised in CI without network calls.
 * It implements the same `AiProvider` contract as Gemini and Groq, so swapping
 * providers changes nothing downstream.
 */

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, one: 1, ground: 1, '1st': 1,
  second: 2, two: 2, '2nd': 2,
  third: 3, three: 3, '3rd': 3,
  fourth: 4, four: 4, '4th': 4,
  fifth: 5, five: 5, '5th': 5,
};

const SEAT_CODE = /\b([A-Za-z])\s*[-–—]?\s*(\d{1,3})\b/;

/** Turns "a12", "A 12", "a-12" into the canonical "A-12". */
export function normalizeSeatCode(input: string): string | null {
  const match = input.match(SEAT_CODE);
  if (!match || !match[1] || !match[2]) return null;
  return match[1].toUpperCase() + '-' + match[2].padStart(2, '0');
}

function findFloorQuery(text: string): string | null {
  const numeric = text.match(/floor\s*(?:number\s*)?(\d{1,2})\b/i);
  if (numeric?.[1]) return 'Floor ' + numeric[1];

  const ordinal = text.match(/\b(first|second|third|fourth|fifth|ground|1st|2nd|3rd|4th|5th)\s+floor\b/i);
  if (ordinal?.[1]) {
    const level = ORDINAL_WORDS[ordinal[1].toLowerCase()];
    if (level) return 'Floor ' + level;
  }

  const worded = text.match(/floor\s+(one|two|three|four|five)\b/i);
  if (worded?.[1]) {
    const level = ORDINAL_WORDS[worded[1].toLowerCase()];
    if (level) return 'Floor ' + level;
  }
  return null;
}

function findBuildingQuery(text: string, context: AiContext): string | null {
  const lowered = text.toLowerCase();
  for (const building of context.buildings) {
    if (lowered.includes(building.name.toLowerCase())) return building.name;
    if (new RegExp('\\b' + building.code.toLowerCase() + '\\b').test(lowered)) return building.name;
  }
  return null;
}

function findDepartment(text: string, context: AiContext): string | null {
  const lowered = text.toLowerCase();
  for (const department of context.departments) {
    const name = department.toLowerCase();
    if (lowered.includes(name)) return department;
    // "eng team", "ops floor"
    if (name.length > 5 && lowered.includes(name.slice(0, 4))) return department;
  }
  return null;
}

/** Strips filler so a captured fragment becomes a clean person reference. */
function cleanName(raw: string): string {
  return raw
    .replace(/^(?:the\s+|employee\s+|user\s+)/i, '')
    .replace(/\s+(?:from|to|into|onto|at|in|over)\s*$/i, '')
    .replace(/['’]s\b/i, '')
    .replace(/[.,!?;:]+\s*$/, '')
    .trim();
}

function baseIntent(action: AiIntent['action'], confidence: number, reason: string): AiIntent {
  return { action, confidence, reason };
}

export function interpretLocally(prompt: string, context: AiContext): AiIntent {
  const text = prompt.trim();
  const lowered = text.toLowerCase();
  const floorQuery = findFloorQuery(text);
  const buildingQuery = findBuildingQuery(text, context);
  const department = findDepartment(text, context);
  const zoneMatch = text.match(/\bzone\s+([A-Za-z])\b/i);
  const zone = zoneMatch?.[1] ? zoneMatch[1].toUpperCase() : null;

  // ---------------------------------------------------------------- questions
  if (/\bhow many\b|\boccupancy\b|\butilis|\butiliz/i.test(lowered)) {
    return {
      ...baseIntent('QUERY_OCCUPANCY', 0.92, 'Reporting seat occupancy.'),
      floorQuery,
      buildingQuery,
      department,
    };
  }

  if (
    /\b(which|what|list|show|are there|any)\b/i.test(lowered) &&
    /\bseats?\b/i.test(lowered) &&
    /\b(available|free|open|empty|unoccupied|vacant)\b/i.test(lowered)
  ) {
    return {
      ...baseIntent('QUERY_AVAILABLE_SEATS', 0.92, 'Listing available seats.'),
      floorQuery,
      buildingQuery,
      zone,
      limit: 20,
    };
  }

  // ------------------------------------------------------------ seat near team
  if (/\b(near|next to|beside|close to|around|by)\b/i.test(lowered) && /\bseat\b/i.test(lowered)) {
    return {
      ...baseIntent('FIND_SEAT_NEAR_TEAM', department ? 0.88 : 0.5, 'Suggesting seats close to a team.'),
      department,
      floorQuery,
      buildingQuery,
      limit: 8,
    };
  }

  // ------------------------------------------------------------------ bulk move
  const bulk = text.match(
    /\bmove\s+(?:all|every)\s+(?:the\s+)?(?:(available|unassigned|unseated|seatless)\s+)?([A-Za-z& ]+?)\s+(?:employees|team members|team|staff|people|folks)\b/i,
  );
  if (bulk) {
    const departmentFromPhrase = findDepartment(bulk[2] ?? '', context) ?? department;
    return {
      ...baseIntent(
        'BULK_MOVE_DEPARTMENT',
        departmentFromPhrase && floorQuery ? 0.85 : 0.5,
        'Relocating a group of employees.',
      ),
      department: departmentFromPhrase,
      floorQuery,
      buildingQuery,
      onlyUnassigned: Boolean(bulk[1]),
      ...(floorQuery ? {} : { clarification: 'Which floor should I move them to?' }),
    };
  }

  // -------------------------------------------------------------------- release
  const releaseSeat = text.match(
    /\b(?:release|free|vacate|clear|empty|unassign)\b[^A-Za-z0-9]*(?:the\s+)?(?:seat\s+)?([A-Za-z]\s*[-–—]?\s*\d{1,3})\b/i,
  );
  if (releaseSeat?.[1]) {
    return {
      ...baseIntent('RELEASE_SEAT', 0.95, 'Releasing a seat.'),
      seatCode: normalizeSeatCode(releaseSeat[1]),
    };
  }

  const releasePerson = text.match(
    /\b(?:release|free up|unassign|remove)\s+(.+?)(?:['’]s)?\s+(?:seat|desk)\b/i,
  );
  if (releasePerson?.[1]) {
    return {
      ...baseIntent('RELEASE_SEAT', 0.9, 'Releasing the seat held by an employee.'),
      employeeQuery: cleanName(releasePerson[1]),
    };
  }

  // ------------------------------------------------------- move / assign a person
  const isMove = /\bmove\b|\brelocate\b|\btransfer\b|\bshift\b/i.test(lowered);
  const isAssign = /\bassign\b|\bseat\b|\bplace\b|\bput\b|\ballocate\b|\bgive\b/i.test(lowered);

  if (isMove || isAssign) {
    // "Move Priya from A-12 to B-07"
    const fromTo = text.match(
      /\b(?:move|relocate|transfer|shift)\s+(.+?)\s+from\s+(?:seat\s+)?([A-Za-z]\s*[-–—]?\s*\d{1,3})\s+to\s+(?:seat\s+)?([A-Za-z]\s*[-–—]?\s*\d{1,3})\b/i,
    );
    if (fromTo?.[1] && fromTo[2] && fromTo[3]) {
      return {
        ...baseIntent('MOVE_EMPLOYEE', 0.96, 'Moving an employee between two named seats.'),
        employeeQuery: cleanName(fromTo[1]),
        fromSeatCode: normalizeSeatCode(fromTo[2]),
        toSeatCode: normalizeSeatCode(fromTo[3]),
      };
    }

    // "Move Rahul Sharma to seat A-24" / "Assign John to B-03"
    const toSeat = text.match(
      /\b(?:move|relocate|transfer|shift|assign|seat|place|put|allocate)\s+(.+?)\s+(?:to|into|onto|at|in)\s+(?:the\s+)?(?:seat\s+)?([A-Za-z]\s*[-–—]?\s*\d{1,3})\b/i,
    );
    if (toSeat?.[1] && toSeat[2]) {
      return {
        ...baseIntent(
          isMove ? 'MOVE_EMPLOYEE' : 'ASSIGN_EMPLOYEE',
          0.94,
          isMove ? 'Moving an employee to a named seat.' : 'Assigning an employee to a named seat.',
        ),
        employeeQuery: cleanName(toSeat[1]),
        toSeatCode: normalizeSeatCode(toSeat[2]),
      };
    }

    // "Assign John to the next available seat on Floor 2"
    const toFloor = text.match(
      /\b(?:move|relocate|transfer|shift|assign|seat|place|put|allocate)\s+(.+?)\s+(?:to|into|onto|at|in|on)\s+(?:the\s+)?(?:next\s+|first\s+|any\s+)?(?:available\s+|free\s+|open\s+)?(?:seat|desk)?\s*(?:on|in|at)?\s*(?:floor|level)\b/i,
    );
    if (toFloor?.[1] && floorQuery) {
      return {
        ...baseIntent(
          isMove ? 'MOVE_EMPLOYEE' : 'ASSIGN_EMPLOYEE',
          0.86,
          'Placing an employee on the first free seat of a floor.',
        ),
        employeeQuery: cleanName(toFloor[1]),
        floorQuery,
        buildingQuery,
      };
    }

    // A person was named but no destination could be found.
    const personOnly = text.match(
      /\b(?:move|relocate|transfer|shift|assign|seat|place|put|allocate)\s+([A-Za-z][A-Za-z.'’\- ]{1,60}?)\s*$/i,
    );
    if (personOnly?.[1]) {
      return {
        ...baseIntent('CLARIFICATION_NEEDED', 0.6, 'A destination is missing.'),
        employeeQuery: cleanName(personOnly[1]),
        clarification:
          'Where should ' + cleanName(personOnly[1]) + ' go? Give me a seat code (like B-07) or a floor.',
      };
    }

    return {
      ...baseIntent('CLARIFICATION_NEEDED', 0.4, 'The request is missing details.'),
      clarification:
        'I need a bit more detail — tell me who to move and the destination seat or floor.',
    };
  }

  // -------------------------------------------------------------------- fallback
  if (/\b(seat|desk|floor|occupanc|employee)\b/i.test(lowered)) {
    return {
      ...baseIntent('CLARIFICATION_NEEDED', 0.35, 'The seating request was not specific enough.'),
      clarification:
        'I can move, assign or release seats, and answer questions about availability. Could you rephrase with the person and the seat or floor?',
    };
  }

  return {
    ...baseIntent('UNSUPPORTED', 0.9, 'The request is outside what the seating assistant can do.'),
  };
}

export function createLocalProvider(): AiProvider {
  return {
    name: 'local',
    model: 'seatflow-rule-interpreter',
    async interpret(prompt: string, context: AiContext): Promise<AiIntent> {
      return interpretLocally(prompt, context);
    },
  };
}
