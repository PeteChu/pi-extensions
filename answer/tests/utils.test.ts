import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatResponseAnswer, normalizeResponses } from "../qna-tui";
import {
  applyTemplate,
  buildToolExtractionSystemPrompt,
  mergeAnswerSettings,
  normalizeExtractedQuestions,
  normalizeTemplates,
  parseExtractionResult,
  parseExtractionToolCallResult,
  questionsMatch,
  resolveNumericOptionShortcut,
} from "../utils";

describe("parseExtractionResult", () => {
  it("extracts JSON from code blocks", () => {
    const input =
      '```json\n{\n  "questions": [{ "question": "Ready?" }]\n}\n```';
    const result = parseExtractionResult(input);
    assert.ok(result);
    assert.strictEqual(result.questions[0]?.question, "Ready?");
    assert.strictEqual(result.questions[0]?.id, "ready");
  });

  it("normalizes ids/options and leaves header optional", () => {
    const input = JSON.stringify({
      questions: [
        {
          question: "Should we ship now?",
          options: [
            { label: "Yes", description: "Release this week." },
            { label: "No" },
          ],
        },
      ],
    });

    const result = parseExtractionResult(input);
    assert.ok(result);
    assert.deepEqual(result.questions[0], {
      id: "should_we_ship_now",
      question: "Should we ship now?",
      options: [
        { label: "Yes", description: "Release this week." },
        { label: "No", description: "" },
      ],
    });
  });

  it("returns null for invalid JSON", () => {
    const result = parseExtractionResult("not json");
    assert.strictEqual(result, null);
  });
});

describe("private tool-call extraction", () => {
  it("parses and normalizes extract_questions tool calls", () => {
    const result = parseExtractionToolCallResult([
      {
        type: "toolCall",
        id: "call-1",
        name: "extract_questions",
        arguments: {
          questions: [
            {
              question: "Pick a database?",
              options: [{ label: "PostgreSQL" }],
            },
          ],
        },
      },
    ]);

    assert.deepEqual(result, {
      questions: [
        {
          id: "pick_a_database",
          question: "Pick a database?",
          options: [{ label: "PostgreSQL", description: "" }],
        },
      ],
    });
  });

  it("supports empty question tool calls", () => {
    const result = parseExtractionToolCallResult([
      {
        type: "toolCall",
        id: "call-1",
        name: "extract_questions",
        arguments: { questions: [] },
      },
    ]);

    assert.deepEqual(result, { questions: [] });
  });

  it("normalizes unknown question payloads defensively", () => {
    assert.deepEqual(normalizeExtractedQuestions("not an array"), []);
  });

  it("appends tool-call instructions to configured extraction prompts", () => {
    const prompt = buildToolExtractionSystemPrompt("Extract questions.");
    assert.ok(prompt.includes("Extract questions."));
    assert.ok(prompt.includes("call it exactly once"));
  });
});

describe("applyTemplate", () => {
  it("replaces placeholders", () => {
    const template =
      "Q: {{question}}\nA: {{answer}}\nContext: {{context}}\n{{index}}/{{total}}";
    const output = applyTemplate(template, {
      question: "Ship it?",
      context: "CI is green",
      answer: "Yes",
      index: 1,
      total: 3,
    });

    assert.strictEqual(
      output,
      "Q: Ship it?\nA: Yes\nContext: CI is green\n2/3",
    );
  });
});

describe("normalizeTemplates", () => {
  it("builds labels for mixed templates", () => {
    const templates = normalizeTemplates([
      "Use bullet points",
      { label: "Short", template: "Be brief" },
    ]);

    assert.deepEqual(templates, [
      { label: "Template 1", template: "Use bullet points" },
      { label: "Short", template: "Be brief" },
    ]);
  });
});

describe("mergeAnswerSettings", () => {
  it("project overrides global drafts settings", () => {
    const merged = mergeAnswerSettings(
      { drafts: { enabled: false, autosaveMs: 500 } },
      { drafts: { promptOnRestore: false } },
    );

    assert.strictEqual(merged.drafts?.enabled, false);
    assert.strictEqual(merged.drafts?.autosaveMs, 500);
    assert.strictEqual(merged.drafts?.promptOnRestore, false);
  });
});

describe("questionsMatch", () => {
  it("allows non-semantic metadata drift", () => {
    const left = [
      {
        id: "runtime",
        header: "Runtime",
        question: "What runtime?",
        context: "Current service runs with Bun",
        options: [
          { label: "Node", description: "Use Node.js" },
          { label: "Bun", description: "Use Bun" },
        ],
      },
    ];
    const right = [
      {
        id: "runtime",
        header: "JS runtime",
        question: "Which runtime should we use?",
        context: "Current deployment uses Bun",
        options: [
          { label: "Node", description: "Node.js for compatibility" },
          { label: "Bun", description: "Bun for speed" },
        ],
      },
    ];

    assert.strictEqual(questionsMatch(left, right), true);
    assert.strictEqual(
      questionsMatch(
        [{ id: "runtime_choice", question: "What runtime?" }],
        [{ id: "js_runtime", question: "What runtime?" }],
      ),
      true,
    );
  });

  it("still requires option shape compatibility", () => {
    const left = [
      {
        id: "runtime",
        question: "What runtime?",
        options: [
          { label: "Node", description: "Use Node.js" },
          { label: "Bun", description: "Use Bun" },
        ],
      },
    ];

    assert.strictEqual(
      questionsMatch(left, [
        {
          id: "runtime",
          question: "What runtime?",
          options: [{ label: "Node", description: "Use Node.js" }],
        },
      ]),
      false,
    );

    assert.strictEqual(
      questionsMatch(left, [
        {
          id: "runtime",
          question: "What runtime?",
          options: [
            { label: "Node", description: "Use Node.js" },
            { label: "Deno", description: "Use Deno" },
          ],
        },
      ]),
      false,
    );
  });
});

describe("resolveNumericOptionShortcut", () => {
  it("returns selected index in option mode", () => {
    assert.strictEqual(resolveNumericOptionShortcut("1", 3, false), 0);
    assert.strictEqual(resolveNumericOptionShortcut("4", 3, false), 3);
  });

  it("does not capture numeric input while editing custom answer", () => {
    assert.strictEqual(resolveNumericOptionShortcut("1", 3, true), null);
    assert.strictEqual(resolveNumericOptionShortcut("9", 3, true), null);
  });

  it("ignores invalid shortcut inputs", () => {
    assert.strictEqual(resolveNumericOptionShortcut("0", 3, false), null);
    assert.strictEqual(resolveNumericOptionShortcut("x", 3, false), null);
    assert.strictEqual(resolveNumericOptionShortcut("9", 3, false), null);
  });
});

describe("shared qna helpers", () => {
  it("normalizes fallback answers into option selection", () => {
    const questions = [
      {
        question: "Preferred runtime?",
        options: [
          { label: "Node", description: "Use Node.js" },
          { label: "Bun", description: "Use Bun" },
        ],
      },
    ];

    const responses = normalizeResponses(questions, undefined, ["Bun"], false);
    assert.strictEqual(formatResponseAnswer(questions[0], responses[0]), "Bun");
  });

  it("treats non-option fallback as custom answer", () => {
    const questions = [
      {
        question: "Notes",
        options: [{ label: "No", description: "Skip" }],
      },
    ];

    const responses = normalizeResponses(
      questions,
      undefined,
      ["Need more context"],
      false,
    );
    assert.strictEqual(
      formatResponseAnswer(questions[0], responses[0]),
      "Need more context",
    );
  });

  it("returns only custom text for other selections", () => {
    const questions = [
      {
        question: "Preferred runtime?",
        options: [
          { label: "Node", description: "Use Node.js" },
          { label: "Bun", description: "Use Bun" },
        ],
      },
    ];

    assert.strictEqual(
      formatResponseAnswer(questions[0], {
        selectedOptionIndex: 2,
        customText: "Deno",
        selectionTouched: true,
        committed: true,
        selectionMode: "single",
        selectedOptionIndexes: [],
      }),
      "Deno",
    );
  });

  it("formats multi-select answer as comma-separated labels", () => {
    const question = {
      question: "Preferred runtimes?",
      options: [
        { label: "Node", description: "Node.js" },
        { label: "Bun", description: "Bun.js" },
        { label: "Deno", description: "Deno.js" },
      ],
    };

    const answer = formatResponseAnswer(question, {
      selectedOptionIndex: 1,
      customText: "",
      selectionTouched: true,
      committed: true,
      selectionMode: "multiple",
      selectedOptionIndexes: [0, 2],
    });

    assert.strictEqual(answer, "Node, Deno");
  });

  it("formats multi-select with custom text included", () => {
    const question = {
      question: "Preferred runtimes?",
      options: [
        { label: "Node", description: "Node.js" },
        { label: "Bun", description: "Bun.js" },
      ],
    };

    const answer = formatResponseAnswer(question, {
      selectedOptionIndex: 2,
      customText: "Deno",
      selectionTouched: true,
      committed: true,
      selectionMode: "multiple",
      selectedOptionIndexes: [0, 2],
    });

    assert.strictEqual(answer, "Node, Deno");
  });

  it("returns empty string for multi-select with no selection", () => {
    const question = {
      question: "Preferred runtimes?",
      options: [
        { label: "Node", description: "Node.js" },
        { label: "Bun", description: "Bun.js" },
      ],
    };

    const answer = formatResponseAnswer(question, {
      selectedOptionIndex: 0,
      customText: "",
      selectionTouched: false,
      committed: false,
      selectionMode: "multiple",
      selectedOptionIndexes: [],
    });

    assert.strictEqual(answer, "");
  });

  it("normalizes response with multi-select fields from draft", () => {
    const questions = [
      {
        question: "Preferred runtimes?",
        options: [
          { label: "Node", description: "Node.js" },
          { label: "Bun", description: "Bun.js" },
        ],
      },
    ];

    const responses = normalizeResponses(
      questions,
      [
        {
          selectedOptionIndex: 0,
          customText: "",
          selectionTouched: true,
          committed: true,
          selectionMode: "multiple" as const,
          selectedOptionIndexes: [0, 1],
        },
      ],
      undefined,
      true,
    );

    assert.strictEqual(responses[0].selectionMode, "multiple");
    assert.deepEqual(responses[0].selectedOptionIndexes, [0, 1]);
    assert.strictEqual(
      formatResponseAnswer(questions[0], responses[0]),
      "Node, Bun",
    );
  });

  it("backward compat: missing selectionMode defaults to single", () => {
    const questions = [
      {
        question: "Preferred runtime?",
        options: [
          { label: "Node", description: "Node.js" },
          { label: "Bun", description: "Bun.js" },
        ],
      },
    ];

    // Simulate old V2 draft response without selectionMode/selectedOptionIndexes
    const responses = normalizeResponses(
      questions,
      [
        {
          selectedOptionIndex: 1,
          customText: "",
          selectionTouched: true,
          committed: true,
        },
      ],
      undefined,
      true,
    );

    assert.strictEqual(responses[0].selectionMode, "single");
    assert.deepEqual(responses[0].selectedOptionIndexes, [1]);
    assert.strictEqual(formatResponseAnswer(questions[0], responses[0]), "Bun");
  });
});
