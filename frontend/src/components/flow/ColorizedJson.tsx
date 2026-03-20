import { Fragment } from "react";

const EQ   = "debug-kv__eq";    // structural: braces, brackets, colons, commas, quotes
const KEY  = "debug-kv__key";   // object keys — blue
const STR  = "debug-kv__str";   // string values — orange
const NUM  = "debug-kv__num";   // number values — green
const BOOL = "debug-kv__bool";  // boolean / null — purple

function renderValue(s: string) {
  // string value: "..." with optional trailing comma
  const strMatch = s.match(/^("(?:[^"\\]|\\.)*")(,?)$/);
  if (strMatch) {
    const inner = strMatch[1].slice(1, -1);
    return <><span className={EQ}>"</span><span className={STR}>{inner}</span><span className={EQ}>"</span>{strMatch[2] && <span className={EQ}>{strMatch[2]}</span>}</>;
  }
  // structural: { [ ] } with optional comma
  const structMatch = s.match(/^([{[\]}])(,?)$/);
  if (structMatch) {
    return <><span className={EQ}>{structMatch[1]}</span>{structMatch[2] && <span className={EQ}>{structMatch[2]}</span>}</>;
  }
  // boolean / null with optional comma
  const boolMatch = s.match(/^(true|false|null)(,?)$/);
  if (boolMatch) {
    return <><span className={BOOL}>{boolMatch[1]}</span>{boolMatch[2] && <span className={EQ}>{boolMatch[2]}</span>}</>;
  }
  // number with optional comma
  const numMatch = s.match(/^(-?\d[\d.e+\-]*)(,?)$/i);
  if (numMatch) {
    return <><span className={NUM}>{numMatch[1]}</span>{numMatch[2] && <span className={EQ}>{numMatch[2]}</span>}</>;
  }
  return <span className={STR}>{s}</span>;
}

export default function ColorizedJson({ value }: { value: unknown }) {
  const lines = (() => {
    try { return JSON.stringify(value, null, 2).split("\n"); }
    catch { return [String(value)]; }
  })();

  return (
    <pre className="debug-section__pre">
      {lines.map((line, i) => {
        const kv = line.match(/^(\s*)("(?:[^"\\]|\\.)*")(\s*:\s*)(.*)/);
        if (kv) {
          const [, indent, keyQ, colon, rest] = kv;
          const keyInner = keyQ.slice(1, -1);
          return (
            <Fragment key={i}>
              {indent}
              <span className={EQ}>"</span><span className={KEY}>{keyInner}</span><span className={EQ}>"</span>
              <span className={EQ}>{colon}</span>
              {renderValue(rest)}
              {"\n"}
            </Fragment>
          );
        }
        const bare = line.match(/^(\s*)(.*)/);
        return (
          <Fragment key={i}>
            {bare?.[1]}{renderValue(bare?.[2] ?? line)}{"\n"}
          </Fragment>
        );
      })}
    </pre>
  );
}
