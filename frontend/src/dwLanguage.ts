import type { Monaco } from "@monaco-editor/react";

export const DW_LANGUAGE_ID = "dataweave";

const KEYWORDS = [
  "output", "input", "var", "fun", "type", "ns", "import", "as",
  "if", "else", "do", "using", "match", "case", "is", "not", "and",
  "or", "null", "true", "false", "default", "update", "at",
];

const TYPE_KEYWORDS = [
  "String", "Number", "Boolean", "Array", "Object", "Null", "Any",
  "Nothing", "Binary", "DateTime", "Date", "Time", "TimeZone",
  "LocalDateTime", "LocalTime", "Period", "Regex", "Type", "Namespace",
  "Iterator", "CData", "Key",
];

const BUILTINS = [
  // Logging / debug
  "log", "logWith",
  // Type inspection
  "typeOf", "sizeOf", "isEmpty", "isBlank", "isNumeric", "isInteger",
  "isDecimal", "isLeapYear", "isDefined",
  // String
  "upper", "lower", "trim", "trimLeft", "trimRight", "capitalize",
  "camelize", "dasherize", "underscore", "pluralize", "singularize",
  "ordinalize", "humanize", "split", "joinBy", "replace", "find",
  "scan", "match", "matches", "contains", "startsWith", "endsWith",
  "substringBefore", "substringAfter", "substringBeforeLast", "substringAfterLast",
  "leftPad", "rightPad", "repeat", "charCodeAt", "char",
  // Array
  "map", "filter", "reduce", "flatMap", "flatten", "distinct",
  "groupBy", "orderBy", "minBy", "maxBy", "countBy", "partition",
  "zip", "unzip", "first", "last", "take", "drop", "takeWhile",
  "dropWhile", "indexOf", "indexWhere", "some", "every", "none",
  "count", "sum", "min", "max", "avg", "append", "prepend",
  "slice", "reverse",
  // Object
  "mapObject", "filterObject", "pluck", "keysOf", "valuesOf", "entriesOf",
  "mergeWith", "removeField", "removeMatch", "update",
  // Math
  "abs", "ceil", "floor", "round", "sqrt", "pow", "mod", "random", "randomInt",
  // Date / Time
  "now", "today", "currentDateTime", "currentTime",
  // IO / runtime
  "write", "read", "readUrl", "p", "lookup", "wait", "uuid",
  "dw", "java", "call",
];

export function registerDWLanguage(monaco: Monaco) {
  monaco.languages.register({ id: DW_LANGUAGE_ID });

  monaco.languages.setMonarchTokensProvider(DW_LANGUAGE_ID, {
    keywords: KEYWORDS,
    typeKeywords: TYPE_KEYWORDS,
    builtins: BUILTINS,

    tokenizer: {
      root: [
        // %dw header
        [/%dw\s+[\d.]+/, "keyword.control"],

        // output / input directives with mime type
        [/\boutput\b/, { token: "keyword", next: "@mime" }],
        [/\binput\b/,  { token: "keyword", next: "@mime" }],

        // --- separator
        [/^---$/, "keyword.separator"],

        // line comments
        [/\/\/.*$/, "comment"],

        // block comments
        [/\/\*/, { token: "comment", next: "@blockComment" }],

        // date/time literals  |2023-01-01T00:00:00|
        [/\|[^|]*\|/, "string.date"],

        // strings with interpolation
        [/"/, { token: "string.quote", next: "@stringDouble" }],
        [/'/, { token: "string.quote", next: "@stringSingle" }],

        // special input variables
        [/\b(payload|attributes|vars)\b/, "variable.input"],

        // type keywords before identifiers
        [/\b(String|Number|Boolean|Array|Object|Null|Any|Nothing|Binary|DateTime|Date|Time|TimeZone|LocalDateTime|LocalTime|Period|Regex|Type|Namespace|Iterator|CData|Key)\b/, "type"],

        // built-in functions
        [new RegExp(`\\b(${BUILTINS.join("|")})\\b(?=\\s*\\()`), "support.function"],

        // keywords — var/fun get special state to highlight the declared name
        [/\bvar\b/, { token: "keyword.declaration", next: "@varDecl" }],
        [/\bfun\b/, { token: "keyword.declaration", next: "@varDecl" }],
        [/\b(type|ns|import|as|if|else|do|using|match|case|is|not|and|or|default|update|at|null|true|false)\b/, "keyword"],

        // identifiers
        [/[a-zA-Z_$][\w$]*/, "variable.user"],

        // numbers
        [/\d+(\.\d+)?/, "number"],

        // operators
        [/[-+*\/=<>!&|?:~.]+/, "operator"],
        [/[{}()[\]]/, "delimiter.bracket"],
        [/[,;]/, "delimiter"],

        // whitespace
        [/\s+/, "white"],
      ],

      mime: [
        [/\s+/, "white"],
        [/[a-zA-Z0-9+\-\/]+/, { token: "string", next: "@pop" }],
        ["", "", "@pop"],
      ],

      // Double-quoted string with $(interpolation) support
      stringDouble: [
        [/[^"\\$(]+/, "string"],
        [/\$\(/, { token: "string.interp.delimiter", next: "@interpolation" }],
        [/\\./, "string.escape"],
        [/"/, { token: "string.quote", next: "@pop" }],
      ],

      stringSingle: [
        [/[^'\\]+/, "string"],
        [/\\./, "string.escape"],
        [/'/, { token: "string.quote", next: "@pop" }],
      ],

      // Inside $( ... ) — tokenize as normal DW, track nesting
      interpolation: [
        [/\)/, { token: "string.interp.delimiter", next: "@pop" }],
        [/[^)]+/, "variable"],
      ],

      // Highlight the name immediately after var/fun
      varDecl: [
        [/\s+/, "white"],
        [/[a-zA-Z_$][\w$]*/, { token: "variable.declaration", next: "@pop" }],
        ["", "", "@pop"],
      ],

      blockComment: [
        [/[^/*]+/, "comment"],
        [/\*\//, { token: "comment", next: "@pop" }],
        [/[/*]/, "comment"],
      ],
    },
  });

  // Token → theme color mappings
  monaco.languages.setLanguageConfiguration(DW_LANGUAGE_ID, {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [
      ["{", "}"], ["[", "]"], ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: "|", close: "|" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: "|", close: "|" },
    ],
  });
}
