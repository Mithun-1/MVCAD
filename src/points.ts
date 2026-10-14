export const MAX_POINTS = 100_000;
export const COORDINATE_LIMIT = 1_000_000;
export type DatumPoint = { id: string; name: string; x: number; y: number; z: number };
export type PointSet = {
  id: string;
  name: string;
  points: DatumPoint[];
  visible: boolean;
  suppressed?: boolean;
  /** Display one point, then hide this many; source coordinates remain unchanged. */
  skipPoints?: number;
  sourceFiles: string[];
};
export type EvaluatedPointSet = { id: string; positions: Float64Array };
export function coordinate(value: string): number {
  const text = value.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) throw new Error('Enter a numeric coordinate.');
  const number = Number(text);
  if (!Number.isFinite(number) || Math.abs(number) > COORDINATE_LIMIT)
    throw new Error('Coordinates must be between −1,000,000 and 1,000,000.');
  return number;
}

// PTS centerlines contain one whitespace-separated XYZ triple per line.
// Accept an optional leading point count, but never silently drop extra columns.
export function parsePointPts(text: string): DatumPoint[] {
  const rows = text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\n|\r/)
    .map((value, index) => ({ value: value.trim(), line: index + 1 }))
    .filter((row) => row.value !== '');
  if (!rows.length) throw new Error('The PTS file is empty.');
  let count: number | undefined;
  if (/^\d+$/.test(rows[0].value)) count = Number(rows.shift()!.value);
  if (!rows.length) throw new Error('The PTS contains no point rows.');
  if (rows.length > MAX_POINTS) throw new Error(`PTS exceeds ${MAX_POINTS.toLocaleString()} points.`);
  if (count !== undefined && count !== rows.length)
    throw new Error(`PTS declares ${count} points but contains ${rows.length} point rows.`);
  return rows.map(({ value, line }, index) => {
    const fields = value.split(/\s+/);
    if (fields.length !== 3)
      throw new Error(`Line ${line}: expected three space-separated coordinates (x y z).`);
    try {
      const [x, y, z] = fields.map(coordinate);
      return { id: crypto.randomUUID(), name: `P${index + 1}`, x, y, z };
    } catch (error) {
      throw new Error(`Line ${line}: ${(error as Error).message}`);
    }
  });
}

export function parsePointFile(text: string, filename: string): DatumPoint[] {
  if (/\.pts$/i.test(filename)) return parsePointPts(text);
  if (/\.csv$/i.test(filename)) return parsePointCsv(text);
  throw new Error('Only CSV and PTS point files are supported.');
}

// Parse CSV as data only. Handles BOM, CRLF, quoted fields and escaped quotes.
export function parsePointCsv(text: string): DatumPoint[] {
  const records: { fields: string[]; line: number }[] = [];
  let fields: string[] = [],
    field = '',
    quoted = false,
    closed = false,
    line = 1,
    start = 1;
  const endField = () => {
    fields.push(field.trim());
    field = '';
    closed = false;
  };
  const endRow = () => {
    endField();
    if (fields.length > 1 || fields[0] !== '') records.push({ fields, line: start });
    fields = [];
    if (records.length > MAX_POINTS + 1)
      throw new Error(`CSV exceeds ${MAX_POINTS.toLocaleString()} points.`);
  };
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else {
        field += char;
        if (char === '\n') line++;
      }
    } else if (char === ',') endField();
    else if (char === '\n' || char === '\r') {
      endRow();
      if (char === '\r' && text[i + 1] === '\n') i++;
      line++;
      start = line;
    } else if (char === '"') {
      if (field.trim() || closed) throw new Error(`Line ${line}: unexpected quote.`);
      field = '';
      quoted = true;
    } else {
      if (closed && char.trim()) throw new Error(`Line ${line}: unexpected text after a quoted field.`);
      field += char;
    }
  }
  if (quoted) throw new Error(`Line ${start}: unclosed quote.`);
  if (field || fields.length || closed) endRow();
  if (!records.length) throw new Error('The CSV file is empty.');
  const headers = records[0].fields.map((value) => value.toLowerCase());
  const hasHeader = headers.some((value) => ['x', 'y', 'z', 'name'].includes(value));
  let indices = [0, 1, 2],
    nameIndex = -1;
  if (hasHeader) {
    if (
      ![3, 4].includes(headers.length) ||
      new Set(headers).size !== headers.length ||
      !['x', 'y', 'z'].every((value) => headers.includes(value)) ||
      headers.some((value) => !['x', 'y', 'z', 'name'].includes(value))
    )
      throw new Error('CSV headers must be x,y,z or name,x,y,z (any order).');
    indices = ['x', 'y', 'z'].map((value) => headers.indexOf(value));
    nameIndex = headers.indexOf('name');
    records.shift();
  }
  if (!records.length) throw new Error('The CSV contains no point rows.');
  if (records.length > MAX_POINTS) throw new Error(`CSV exceeds ${MAX_POINTS.toLocaleString()} points.`);
  return records.map((record, index) => {
    if (record.fields.length !== (hasHeader ? headers.length : 3))
      throw new Error(`Line ${record.line}: expected ${hasHeader ? headers.length : 3} columns.`);
    try {
      const [x, y, z] = indices.map((i) => coordinate(record.fields[i]));
      const name = nameIndex < 0 ? `P${index + 1}` : record.fields[nameIndex];
      if (!name || name.length > 60) throw new Error('Point names must contain 1–60 characters.');
      return { id: crypto.randomUUID(), name, x, y, z };
    } catch (error) {
      throw new Error(`Line ${record.line}: ${(error as Error).message}`);
    }
  });
}
