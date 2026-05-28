import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDraftStore,
  getLatestDraft,
  type AnswerDraft,
} from "../qna-adapter";
import { formatResponseAnswer, normalizeResponses } from "../qna-tui";

const QUESTIONS = [
  {
    id: "runtime",
    question: "Which runtime should we use?",
    options: [
      { label: "Node", description: "Use Node.js" },
      { label: "Bun", description: "Use Bun" },
    ],
  },
];

describe("getLatestDraft", () => {
  it("returns matching latest draft and ignores cleared state", () => {
    const cleared: AnswerDraft = {
      version: 2,
      sourceEntryId: "msg-1",
      questions: QUESTIONS,
      answers: [],
      responses: [],
      updatedAt: 1,
      state: "cleared",
    };

    const draft = getLatestDraft(
      [
        {
          type: "custom",
          customType: "answer:draft",
          data: { ...cleared, state: "draft" },
        },
        { type: "custom", customType: "answer:draft", data: cleared },
      ],
      "msg-1",
      QUESTIONS,
    );

    assert.strictEqual(draft, null);
  });

  it("returns null when questions differ", () => {
    const draft = getLatestDraft(
      [
        {
          type: "custom",
          customType: "answer:draft",
          data: {
            version: 2,
            sourceEntryId: "msg-1",
            questions: [{ id: "language", question: "Language?" }],
            answers: ["TypeScript"],
            updatedAt: 1,
            state: "draft",
          },
        },
      ],
      "msg-1",
      QUESTIONS,
    );

    assert.strictEqual(draft, null);
  });
});

describe("createDraftStore", () => {
  it("saves and clears draft entries", () => {
    const entries: Array<{ type: string; payload: unknown }> = [];
    const pi = {
      appendEntry(type: string, payload: unknown) {
        entries.push({ type, payload });
      },
    } as any;

    const store = createDraftStore(
      pi,
      { sourceEntryId: "msg-1", questions: QUESTIONS },
      { enabled: true, autosaveMs: 0, promptOnRestore: true },
    );

    store.schedule([
      {
        selectedOptionIndex: 1,
        customText: "",
        selectionTouched: true,
        committed: true,
        selectionMode: "single",
        selectedOptionIndexes: [1],
      },
    ]);
    store.clear();

    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0]?.type, "answer:draft");
    assert.strictEqual(
      (entries[0]?.payload as { state: string }).state,
      "draft",
    );
    assert.strictEqual(
      (entries[1]?.payload as { state: string }).state,
      "cleared",
    );
  });

  it("saves multi-select response fields in draft", () => {
    const entries: Array<{ type: string; payload: unknown }> = [];
    const pi = {
      appendEntry(type: string, payload: unknown) {
        entries.push({ type, payload });
      },
    } as any;

    const store = createDraftStore(
      pi,
      { sourceEntryId: "msg-1", questions: QUESTIONS },
      { enabled: true, autosaveMs: 0, promptOnRestore: true },
    );

    store.schedule([
      {
        selectedOptionIndex: 0,
        customText: "",
        selectionTouched: true,
        committed: true,
        selectionMode: "multiple",
        selectedOptionIndexes: [0, 1],
      },
    ]);

    assert.strictEqual(entries.length, 1);
    const payload = entries[0]?.payload as AnswerDraft;
    assert.strictEqual(payload.version, 3);
    assert.strictEqual(payload.responses?.[0]?.selectionMode, "multiple");
    assert.deepEqual(payload.responses?.[0]?.selectedOptionIndexes, [0, 1]);
  });

  it("V2 draft with single-select loads correctly via normalizeResponses", () => {
    // Simulate a V2 draft (no selectionMode/selectedOptionIndexes)
    const v2Draft: AnswerDraft = {
      version: 2,
      sourceEntryId: "msg-1",
      questions: QUESTIONS,
      answers: ["Bun"],
      responses: [
        {
          selectedOptionIndex: 1,
          customText: "",
          selectionTouched: true,
          committed: true,
        },
      ],
      updatedAt: Date.now(),
      state: "draft",
    };

    const responses = normalizeResponses(
      QUESTIONS,
      v2Draft.responses,
      v2Draft.answers,
      true,
    );

    assert.strictEqual(responses[0].selectionMode, "single");
    assert.deepEqual(responses[0].selectedOptionIndexes, [1]);
    assert.strictEqual(formatResponseAnswer(QUESTIONS[0], responses[0]), "Bun");
  });
});
