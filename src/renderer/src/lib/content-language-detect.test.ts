import { describe, expect, it } from 'vitest'
import { detectLanguageFromContent } from './content-language-detect'

function language(content: string): string | null {
  return detectLanguageFromContent(content)?.language ?? null
}

describe('detectLanguageFromContent', () => {
  it('returns null for empty and near-empty input', () => {
    expect(language('')).toBeNull()
    expect(language('hello')).toBeNull()
  })

  it('returns null for plain prose', () => {
    expect(
      language(
        'Meeting notes from Tuesday: we discussed the roadmap for next quarter and agreed to follow up on the hiring plan. Alice will send the summary.'
      )
    ).toBeNull()
  })

  it('detects SQL', () => {
    expect(
      language(
        `SELECT id, name, created_at\nFROM users\nWHERE status = 'active'\nORDER BY created_at DESC\nLIMIT 10;`
      )
    ).toBe('sql')
    expect(
      language(
        `CREATE TABLE orders (\n  id INTEGER PRIMARY KEY,\n  customer_id INTEGER NOT NULL,\n  total NUMERIC\n);\nINSERT INTO orders (customer_id, total) VALUES (1, 9.99);`
      )
    ).toBe('sql')
  })

  it('detects Go', () => {
    expect(
      language(
        `package main\n\nimport (\n\t"fmt"\n)\n\nfunc main() {\n\tmsg := "hello"\n\tif err := run(); err != nil {\n\t\tfmt.Println(msg, err)\n\t}\n}`
      )
    ).toBe('go')
  })

  it('detects TypeScript', () => {
    expect(
      language(
        `interface User {\n  id: number\n  name: string\n  email?: string\n}\n\nexport function greet(user: User): string {\n  return \`hi \${user.name}\`\n}`
      )
    ).toBe('typescript')
  })

  it('detects JavaScript without type annotations', () => {
    expect(
      language(
        `const fs = require('fs')\n\nfunction readConfig(path) {\n  const raw = fs.readFileSync(path, 'utf8')\n  return JSON.parse(raw)\n}\n\nmodule.exports = { readConfig }`
      )
    ).toBe('javascript')
  })

  it('detects Python', () => {
    expect(
      language(
        `import os\nfrom pathlib import Path\n\ndef load(path):\n    if not Path(path).exists():\n        return None\n    return Path(path).read_text()\n\nif __name__ == "__main__":\n    print(load("data.txt"))`
      )
    ).toBe('python')
  })

  it('detects Rust', () => {
    expect(
      language(
        `use std::collections::HashMap;\n\nfn main() {\n    let mut counts: HashMap<String, u32> = HashMap::new();\n    counts.insert("a".to_string(), 1);\n    println!("{:?}", counts);\n}`
      )
    ).toBe('rust')
  })

  it('detects JSON', () => {
    expect(language('{"name": "orca", "version": "1.0.0", "private": true}')).toBe('json')
    expect(language('[{"id": 1}, {"id": 2}]')).toBe('json')
  })

  it('detects YAML', () => {
    expect(
      language(
        `name: build\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm test`
      )
    ).toBe('yaml')
  })

  it('detects HTML', () => {
    expect(
      language(
        `<!DOCTYPE html>\n<html>\n<head><title>Test</title></head>\n<body><div class="app"><p>hi</p></div></body>\n</html>`
      )
    ).toBe('html')
  })

  it('detects CSS', () => {
    expect(
      language(
        `.button {\n  color: red;\n  padding: 4px 8px;\n}\n\n@media (max-width: 600px) {\n  .button { display: none; }\n}`
      )
    ).toBe('css')
  })

  it('detects shell scripts', () => {
    expect(
      language(
        `#!/bin/bash\nset -euo pipefail\n\nif [[ -z "\${1:-}" ]]; then\n  echo "usage: $0 <target>"\n  exit 1\nfi\n\necho "deploying \${1}"`
      )
    ).toBe('shell')
  })

  it('detects Java', () => {
    expect(
      language(
        `import java.util.List;\n\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("hello");\n    }\n}`
      )
    ).toBe('java')
  })

  it('detects C#', () => {
    expect(
      language(
        `using System;\nusing System.Linq;\n\nnamespace Demo\n{\n    public class Program\n    {\n        public string Name { get; set; }\n        public static void Main() => Console.WriteLine("hi");\n    }\n}`
      )
    ).toBe('csharp')
  })

  it('detects C++ over C when C++-only signals fire', () => {
    expect(
      language(
        `#include <iostream>\n#include <vector>\n\nint main() {\n    std::vector<int> xs{1, 2, 3};\n    for (auto x : xs) std::cout << x << std::endl;\n    return 0;\n}`
      )
    ).toBe('cpp')
  })

  it('detects C', () => {
    expect(
      language(
        `#include <stdio.h>\n#include <stdlib.h>\n\nint main(void) {\n    char *buf = malloc(64);\n    printf("hello\\n");\n    free(buf);\n    return 0;\n}`
      )
    ).toBe('c')
  })

  it('detects PHP', () => {
    expect(
      language(`<?php\nfunction greet($name) {\n    echo "hello " . $name;\n}\ngreet("world");`)
    ).toBe('php')
  })

  it('detects a python shebang even with sparse content', () => {
    expect(language(`#!/usr/bin/env python3\nx = 1\n`)).toBe('python')
  })

  it('returns the matching extension for the detected language', () => {
    expect(detectLanguageFromContent(`SELECT * FROM t WHERE id = 1 ORDER BY id`)?.extension).toBe(
      '.sql'
    )
  })
})
