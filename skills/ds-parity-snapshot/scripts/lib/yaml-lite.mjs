// A copy of ds-inventory/scripts/lib/yaml-lite.mjs, vendored here so the skill
// runs without the inventory repo's scripts folder on disk. The inventory's own
// scripts still use the original; if that one changes, copy it over again.
//
// A deliberately small YAML reader for exactly the subset ds-inventory records
// use: block mappings and sequences, 2-space indentation, plain/quoted
// scalars, empty flow collections (`[]`, `{}`), `>-` folded block scalars,
// and `#` comments. Not a general YAML parser — do not point it at anything
// this project didn't write.
//
// Returns plain JS values (object / array / string / number / boolean / null).

export function parseYamlLite(text, filename = "<input>") {
  const rawLines = text.split("\n");
  const lines = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const indent = raw.match(/^ */)[0].length;
    const trimmed = raw.slice(indent);
    if (trimmed === "" || trimmed.startsWith("#")) continue; // blank / comment-only
    lines.push({ n: i + 1, indent, text: stripComment(trimmed), raw: trimmed });
  }

  let pos = 0;

  function peek() {
    return lines[pos];
  }

  function err(msg, lineNo) {
    throw new Error(`${filename}:${lineNo ?? peek()?.n ?? "?"}: ${msg}`);
  }

  // Parses the block starting at `pos`, whose lines all sit at exactly `indent`.
  function parseBlock(indent) {
    if (!peek() || peek().indent < indent) return {};
    if (peek().indent > indent) err(`unexpected indent`, peek().n);

    const isSequence = peek().text.startsWith("- ") || peek().text === "-";
    return isSequence ? parseSequence(indent) : parseMapping(indent);
  }

  function parseMapping(indent) {
    const out = {};
    while (peek() && peek().indent === indent && !peek().text.startsWith("- ") && peek().text !== "-") {
      const line = peek();
      const m = matchKeyValue(line.text);
      if (!m) err(`expected "key: value", got "${line.text}"`, line.n);
      const { key, rest } = m;
      pos++;
      out[key] = parseValue(rest, indent, line.n);
    }
    return out;
  }

  function parseSequence(indent) {
    const out = [];
    while (peek() && peek().indent === indent && (peek().text.startsWith("- ") || peek().text === "-")) {
      const line = peek();
      const rest = line.text === "-" ? "" : line.text.slice(2);
      pos++;
      if (rest === "") {
        // Item is a nested block at indent+2.
        out.push(parseBlock(indent + 2));
      } else if (matchKeyValue(rest)) {
        // Item is an inline mapping: "- key: value", more keys follow indented
        // to align under the first key (indent + 2).
        const itemIndent = indent + 2;
        // Re-inject the "- " line's remainder as a synthetic first mapping line
        // at itemIndent, then parse the rest of the mapping normally.
        const { key, rest: valueText } = matchKeyValue(rest);
        const item = {};
        item[key] = parseValue(valueText, itemIndent, line.n);
        Object.assign(item, parseMapping(itemIndent));
        out.push(item);
      } else {
        out.push(parseScalar(rest, line.n));
      }
    }
    return out;
  }

  function parseValue(text, parentIndent, lineNo) {
    if (text === "") {
      // Nested block, or a genuinely empty/null value with nothing under it.
      if (peek() && peek().indent > parentIndent) return parseBlock(peek().indent);
      return null;
    }
    if (text === ">-" || text === "|-" || text === ">" || text === "|") {
      return parseBlockScalar(parentIndent);
    }
    if (text === "[]") return [];
    if (text === "{}") return {};
    return parseScalar(text, lineNo);
  }

  function parseBlockScalar(parentIndent) {
    const parts = [];
    while (peek() && peek().indent > parentIndent) {
      parts.push(peek().raw);
      pos++;
    }
    return parts.join(" ");
  }

  function parseScalar(text, lineNo) {
    if (text.startsWith('"')) {
      if (!text.endsWith('"') || text.length < 2) err(`unterminated quoted string`, lineNo);
      try {
        return JSON.parse(text);
      } catch {
        err(`could not parse quoted string: ${text}`, lineNo);
      }
    }
    if (text === "null" || text === "~") return null;
    if (text === "true") return true;
    if (text === "false") return false;
    if (/^-?\d+$/.test(text)) return parseInt(text, 10);
    if (/^-?\d+\.\d+$/.test(text)) return parseFloat(text);
    return text; // plain scalar, verbatim
  }

  const result = parseBlock(0);
  if (peek()) err(`unconsumed content`, peek().n);
  return result;
}

// Splits a line's content into a mapping key and the raw value text after
// it. The key is either a double-quoted string or everything up to the first
// ": " (or a trailing ":" with nothing after it) — so a key may contain
// spaces, as our Figma variant axis names do ("Items selected", "<100 chars").
function matchKeyValue(text) {
  if (text.startsWith('"')) {
    const m = text.match(/^"([^"]*)":(\s+(.*))?$/);
    if (!m) return null;
    return { key: m[1], rest: m[3] === undefined ? "" : m[3] };
  }
  const m = text.match(/^([^:]+):(\s+(.*))?$/);
  if (!m) return null;
  return { key: m[1], rest: m[3] === undefined ? "" : m[3] };
}

// Strips a trailing `# comment`, but only outside quoted strings.
function stripComment(text) {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== "\\") inQuotes = !inQuotes;
    if (c === "#" && !inQuotes && (i === 0 || text[i - 1] === " ")) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}
