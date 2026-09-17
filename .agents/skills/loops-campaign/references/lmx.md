# LMX — Loops Markup Language

The email body for a Loops campaign must be **LMX**, not HTML or plain text. LMX is an XML-like markup. Source of truth: https://loops.so/docs/creating-emails/lmx

## Core rules

- **No single root element.** The body is a sequence of top-level **block** tags, optionally preceded by one `<Style />` tag. (You usually don't need `<Style>` — Loops applies the team theme automatically.)
- **No bare text at the top level.** Wrap text in a block tag like `<Paragraph>`.
- Tags are **case-sensitive, PascalCase**. Self-closing tags must end with `/>` (e.g. `<Image />`, `<Divider />`).
- Attribute values are quoted strings. Whitespace between block tags is ignored, so pretty-printing / newlines between tags is safe.
- Max payload 100KB.

## Block tags (top level)

| Tag | Purpose |
|-----|---------|
| `<Paragraph>` | A paragraph of text |
| `<H1>` `<H2>` `<H3>` | Headings |
| `<Button href="...">` | Call-to-action button |
| `<Image src="..." />` | Image (requires `src`) |
| `<Divider />` | Horizontal rule |
| `<Quote>` | Blockquote |
| `<CodeBlock>` | Code block |
| `<OrderedList>` `<UnorderedList>` | Lists |
| `<Columns>` | Multi-column layout |
| `<Section>` | Grouped container |
| `<Icons>` | Social icon row |
| `<Component componentId="..." />` | A reusable component defined in your account |
| `<Style ... />` | Document styling, top-level only |

## Inline tags (inside block tags)

`<Strong>`, `<Em>`, `<Underline>`, `<Strike>`, `<Code>`, `<Link href="...">`, `<Text>`

Example of a hyperlink inside a paragraph:
```xml
<Paragraph>Try it here: <Link href="https://woven.video"><Underline>woven.video</Underline></Link></Paragraph>
```

## Personalization

- Use `{contact.propertyName}` — e.g. `{contact.firstName}`.
- **LMX does not support inline fallback/default syntax.** The older `{firstName}` and `{EVENT_PROPERTY:...}` forms are NOT valid in LMX (they only work in MJML/the visual editor). If a contact lacks the property, configure a default on the field in the Loops editor — you can't do it in the LMX string. Because of this, prefer a no-name opener for broadcasts unless you've confirmed the property is populated and a default is set.

## Styling attributes (optional)

Block tags accept: `fontSize`, `lineHeight`, `align`, `blockColor`, `blockBorderRadius`, `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`. Inline tags accept `textColor`. Leave these off to inherit the team theme.

## Minimal example

```xml
<Paragraph>Last year I introduced the Woven Canvas. Today I'm introducing the Woven Editor, a video editor you can talk to.</Paragraph>
<Paragraph>It's free, and it works with your existing ChatGPT subscription.</Paragraph>
<Button href="https://woven.video">Try it here</Button>
```

## In the JSON payload

The `lmx` field is a JSON string, so quotes inside attributes must be escaped (`href=\"...\"`). To avoid escaping headaches, write the payload to a file and `curl -d @file.json` rather than inlining it in the shell.
