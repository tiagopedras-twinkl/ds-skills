# Component naming specification

The rule a component name must satisfy. This file is the single source of truth.
`scripts/validate-names.mjs` parses the config block below at runtime, so the
regex exists in exactly one place and cannot drift from the documentation.

## Grammar

```ebnf
component  = word *( " " word ) [ "/" platform ]
word       = capital ( alnum )* *( "-" alnum-segment )
capital    = "A".."Z"
alnum      = "A".."Z" | "a".."z" | "0".."9"
platform   = "web" | "app"
```

In prose:

- A name is one or more words separated by a single space.
- Every word starts with a capital letter.
- Only the first letter is constrained, so acronyms pass as written: `CTA`, `PDF`, `URL`.
- A word may contain hyphens. A hyphen cannot start or end a word and cannot repeat.
- Case after a hyphen is free, so `In-line` and `In-Line` both pass.
- A name may end with `/web` or `/app`, lowercase, with no spaces around the slash.
- The platform slot appears only when a component genuinely has two platform versions. A shared component stays bare.

## Config

```yaml
version: 1.0.0
separator: "/"
platforms: [web, app]
maxLength: 60
regex: "^[A-Z][A-Za-z0-9]*(-[A-Za-z0-9]+)*( [A-Z][A-Za-z0-9]*(-[A-Za-z0-9]+)*)*(/(web|app))?$"
```

## Examples

```
PASS  Button
PASS  Text Field
PASS  In-line Message
PASS  CTA Banner
PASS  Heading H1
PASS  Multi-select Field/web
PASS  Nav Bar/app

FAIL  button                 lowercase-word          first word not capitalised
FAIL  Text field             lowercase-word          every word must be capitalised
FAIL  Text  Field            double-space            one space between words
FAIL  Button / web           space-around-separator  no spaces around the slash
FAIL  Button/Web             unknown-platform        platform is lowercase
FAIL  Button/desktop         unknown-platform        not in the platform list
FAIL  Button/web/large       multiple-slashes        one platform slot only
FAIL  In--line               double-hyphen           single hyphen only
FAIL  -Inline                hyphen-edge             word cannot start with a hyphen
FAIL  In-                    hyphen-edge             word cannot end with a hyphen
FAIL  1 Column               digit-word-start        a word cannot start with a digit
FAIL  Heading 1              digit-word-start        a standalone number is not a word
FAIL  Text_Field             invalid-character       underscores are not allowed
```

## Failure codes

Every code the validator can emit. All that apply are reported, not just the first.

| Code | Meaning |
|---|---|
| `empty` | Name is empty or whitespace only |
| `leading-trailing-space` | Space at the start or end |
| `double-space` | Two or more consecutive spaces |
| `lowercase-word` | A word does not start with A–Z |
| `digit-word-start` | A word starts with a digit |
| `invalid-character` | Character outside A–Z a–z 0–9 space hyphen slash |
| `space-around-separator` | Space next to a hyphen or slash |
| `multiple-slashes` | More than one slash |
| `unknown-platform` | Text after the slash is not in `platforms` |
| `hyphen-edge` | A word starts or ends with a hyphen |
| `double-hyphen` | Two or more consecutive hyphens |
| `too-long` | Longer than `maxLength` |

## Batch warnings

Raised across a set of names, never against a single name. Warnings do not fail a run.

| Code | Meaning |
|---|---|
| `orphan-platform` | `X/web` exists with no `X/app`, or the reverse |
| `bare-and-platform` | Both `X` and `X/web` exist, so which one applies is ambiguous |
| `duplicate` | The same name appears more than once |

## Open decision: standalone numbers

A digit may appear inside a word, so `H1` and `Column12` pass. A number on its
own is not a word, so `Heading 1` and `1 Column` fail. This is what the grammar
says, and it rules out a shape design systems commonly use.

To allow a trailing number, change the config regex to:

```
^[A-Z][A-Za-z0-9]*(-[A-Za-z0-9]+)*( ([A-Z][A-Za-z0-9]*|[0-9]+)(-[A-Za-z0-9]+)*)*(/(web|app))?$
```

That permits a numeric word in any position but the first, so `Heading 1` passes
and `1 Column` still fails. Update the examples and bump `version` in the same
commit.

## Known limitation: grouping slashes

Figma treats `/` as a folder separator in the assets panel, so `Button/web` and
`Button/app` nest under a `Button` folder. That is intended here.

The cost is that this spec claims the slash entirely for the platform slot. A
library that also uses slashes to categorise, such as `Forms/Text Field`, will
fail every categorised name with `unknown-platform`. If that is how the library
is organised, the spec needs a group slot adding before this skill is useful
against it. Do not work around it by relaxing the regex for one run.

## Changing the spec

Change the config block and the examples in the same commit, and bump `version`.
Never hardcode a rule in the script that is not derivable from this file.
