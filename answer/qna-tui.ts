import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

type Component = {
  handleInput: (data: string) => void;
  render: (width: number) => string[];
  invalidate: () => void;
};

type TUI = { requestRender: () => void };

type EditorTheme = {
  borderColor: (text: string) => string;
  selectList: {
    matchHighlight?: (text: string) => string;
    itemSecondary?: (text: string) => string;
  };
};

const PiTui = ((): {
  Editor: new (
    tui: TUI,
    theme: EditorTheme,
  ) => {
    disableSubmit?: boolean;
    onChange?: () => void;
    setText: (text: string) => void;
    getText: () => string;
    render: (width: number) => string[];
    handleInput: (data: string) => void;
  };
  Key: {
    enter: string;
    tab: string;
    escape: string;
    up: string;
    down: string;
    left: string;
    right: string;
    ctrl: (key: string) => string;
    shift: (key: string) => string;
  };
  matchesKey: (input: string, key: string) => boolean;
  truncateToWidth: (text: string, width: number, ellipsis?: string) => string;
  visibleWidth: (text: string) => number;
  wrapTextWithAnsi: (text: string, width: number) => string[];
} => {
  try {
    return require("@earendil-works/pi-tui");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "MODULE_NOT_FOUND") throw error;
    return require(
      path.join(
        os.homedir(),
        ".bun",
        "install",
        "global",
        "node_modules",
        "@earendil-works",
        "pi-tui",
      ),
    );
  }
})();

export interface QnAOption {
  label: string;
  description: string;
}

export interface QnAQuestion {
  header?: string;
  question: string;
  context?: string;
  options?: QnAOption[];
}

export interface QnATemplate {
  label: string;
  template: string;
}

export interface QnAResponse {
  selectedOptionIndex: number;
  customText: string;
  selectionTouched: boolean;
  committed: boolean;
  selectionMode: "single" | "multiple";
  selectedOptionIndexes: number[];
}

export interface QnAResult {
  text: string;
  answers: string[];
  responses: QnAResponse[];
}

export interface QnATemplateData {
  question: string;
  context?: string;
  answer: string;
  index: number;
  total: number;
}

export function getQuestionOptions(question: QnAQuestion): QnAOption[] {
  return question.options ?? [];
}

export function formatResponseAnswer(
  question: QnAQuestion,
  response: QnAResponse,
): string {
  const options = getQuestionOptions(question);
  if (options.length === 0) return response.customText;

  const otherIndex = options.length;

  // Multi-select mode
  if (response.selectionMode === "multiple") {
    const isCustomSelected =
      response.selectedOptionIndexes.includes(otherIndex);
    const selectedLabels = response.selectedOptionIndexes
      .filter((i) => i >= 0 && i < options.length)
      .map((i) => options[i].label);
    const parts = [...selectedLabels];
    if (isCustomSelected && response.customText.trim()) {
      parts.push(response.customText.trim());
    }
    return parts.length > 0 ? parts.join(", ") : "";
  }

  // Single-select mode (existing behavior)
  if (response.selectedOptionIndex === otherIndex) return response.customText;
  if (!response.selectionTouched) return "";
  return options[response.selectedOptionIndex]?.label ?? "";
}

function findOptionIndexByLabel(options: QnAOption[], label: string): number {
  const index = options.findIndex((option) => option.label === label);
  return index >= 0 ? index : options.length;
}

function inferSelectionTouched(
  options: QnAOption[],
  selectedIndex: number | undefined,
  committed: boolean | undefined,
  fallbackAnswer: string,
): boolean {
  if (typeof selectedIndex === "number") {
    if (typeof committed === "boolean") return committed === true;
    if (fallbackAnswer.trim().length === 0) return false;
    const optionIndex = findOptionIndexByLabel(options, fallbackAnswer.trim());
    return optionIndex === selectedIndex && optionIndex !== 0;
  }
  return fallbackAnswer.trim().length > 0;
}

export function normalizeResponseForQuestion(
  question: QnAQuestion,
  response: Partial<QnAResponse> | undefined,
  fallbackAnswer: string | undefined,
  inferCommittedFromContent: boolean,
): QnAResponse {
  const options = getQuestionOptions(question);
  const rawFallback = fallbackAnswer ?? "";
  const rawCustomText = response?.customText ?? rawFallback;
  const explicitIndex = response?.selectedOptionIndex;
  const hasExplicitIndex =
    typeof explicitIndex === "number" && Number.isFinite(explicitIndex);
  let selectedOptionIndex = hasExplicitIndex
    ? Math.trunc(explicitIndex)
    : undefined;

  // Resolve selection mode (backward compat: missing = single)
  const selectionMode: "single" | "multiple" =
    response?.selectionMode === "multiple" ? "multiple" : "single";

  // Resolve selectedOptionIndexes (backward compat)
  let selectedOptionIndexes: number[];
  if (Array.isArray(response?.selectedOptionIndexes)) {
    selectedOptionIndexes = response.selectedOptionIndexes
      .filter((i): i is number => typeof i === "number" && Number.isFinite(i))
      .map((i) => Math.max(0, Math.min(options.length, Math.trunc(i))));
    // Deduplicate
    selectedOptionIndexes = [...new Set(selectedOptionIndexes)];
  } else {
    // Backward compat: derive from selectedOptionIndex
    selectedOptionIndexes =
      hasExplicitIndex && explicitIndex! > 0
        ? [Math.max(0, Math.min(options.length, Math.trunc(explicitIndex!)))]
        : [];
  }

  if (options.length === 0) {
    selectedOptionIndex = 0;
    selectedOptionIndexes = [];
  } else if (selectedOptionIndex === undefined) {
    const fallbackTrimmed = rawFallback.trim();
    if (selectionMode === "multiple") {
      // For multi-select, try to match fallback against options
      const matchedLabelIdx =
        fallbackTrimmed.length > 0
          ? findOptionIndexByLabel(options, fallbackTrimmed)
          : options.length; // default to nothing selected if no fallback
      selectedOptionIndex =
        matchedLabelIdx < options.length
          ? matchedLabelIdx
          : (selectedOptionIndexes[selectedOptionIndexes.length - 1] ?? 0);
    } else {
      selectedOptionIndex =
        fallbackTrimmed.length > 0
          ? findOptionIndexByLabel(options, fallbackTrimmed)
          : 0;
    }
  }

  const normalizedIndex = Math.max(
    0,
    Math.min(options.length, selectedOptionIndex ?? 0),
  );
  const useCustomText =
    options.length === 0 || normalizedIndex === options.length;
  const normalizedCustomText = useCustomText ? rawCustomText : "";

  let selectionTouched = response?.selectionTouched;
  if (selectionTouched === undefined) {
    selectionTouched = inferSelectionTouched(
      options,
      selectedOptionIndex,
      response?.committed,
      rawFallback,
    );
    // For multi-select, also consider selectionTouched true if any indices selected
    if (!selectionTouched && selectionMode === "multiple") {
      selectionTouched = selectedOptionIndexes.length > 0;
    }
  }

  let committed = response?.committed ?? false;
  if (response?.committed === undefined && inferCommittedFromContent) {
    committed =
      formatResponseAnswer(question, {
        selectedOptionIndex: normalizedIndex,
        customText: normalizedCustomText,
        selectionTouched,
        committed: false,
        selectionMode,
        selectedOptionIndexes,
      }).trim().length > 0;
  }

  return {
    selectedOptionIndex: normalizedIndex,
    customText: normalizedCustomText,
    selectionTouched,
    committed,
    selectionMode,
    selectedOptionIndexes,
  };
}

export function normalizeResponses(
  questions: QnAQuestion[],
  responses: Array<Partial<QnAResponse>> | undefined,
  fallbackAnswers: string[] | undefined,
  inferCommittedFromContent: boolean,
): QnAResponse[] {
  return questions.map((question, index) =>
    normalizeResponseForQuestion(
      question,
      responses?.[index],
      fallbackAnswers?.[index],
      inferCommittedFromContent,
    ),
  );
}

export function cloneResponses(responses: QnAResponse[]): QnAResponse[] {
  return responses.map((response) => ({
    ...response,
    selectedOptionIndexes: [...response.selectedOptionIndexes],
  }));
}

export function deriveAnswersFromResponses(
  questions: QnAQuestion[],
  responses: QnAResponse[],
): string[] {
  return questions.map((question, index) =>
    formatResponseAnswer(question, responses[index]),
  );
}

export function hasResponseContent(
  question: QnAQuestion,
  response: QnAResponse,
): boolean {
  return formatResponseAnswer(question, response).trim().length > 0;
}

function summarizeAnswer(text: string, maxLength = 58): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 1)}…`;
}

function defaultResolveNumericShortcut(
  input: string,
  maxOptionIndex: number,
  usingCustomEditor: boolean,
): number | null {
  if (usingCustomEditor || !/^[1-9]$/.test(input)) return null;

  const selectedIndex = Number(input) - 1;
  return selectedIndex <= maxOptionIndex ? selectedIndex : null;
}

function defaultApplyTemplate(template: string, data: QnATemplateData): string {
  const replacements: Record<string, string> = {
    question: data.question,
    context: data.context ?? "",
    answer: data.answer,
    index: String(data.index + 1),
    total: String(data.total),
  };

  return template.replace(
    /\{\{(question|context|answer|index|total)\}\}/g,
    (_match, key: string) => replacements[key] ?? "",
  );
}

export class QnATuiComponent<
  TQuestion extends QnAQuestion,
> implements Component {
  private questions: TQuestion[];
  private responses: QnAResponse[];
  private currentIndex = 0;
  private editor: {
    disableSubmit?: boolean;
    onChange?: () => void;
    setText: (text: string) => void;
    getText: () => string;
    render: (width: number) => string[];
    handleInput: (data: string) => void;
  };
  private tui: TUI;
  private onDone: (result: QnAResult | null) => void;
  private showingConfirmation = false;
  private templates: QnATemplate[];
  private templateIndex = 0;
  private onResponsesChange?: (responses: QnAResponse[]) => void;
  private title: string;
  private resolveNumericShortcut: (
    input: string,
    maxOptionIndex: number,
    usingCustomEditor: boolean,
  ) => number | null;
  private applyTemplate: (template: string, data: QnATemplateData) => string;
  private questionSummaryLabel: (question: TQuestion, index: number) => string;

  private focusIndex = 0;

  private cachedWidth?: number;
  private cachedLines?: string[];
  private lastEditorText = "";

  private dim = (s: string) => s;
  private bold = (s: string) => s;
  private italic = (s: string) => `\x1b[3m${s}\x1b[0m`;
  private accent = (s: string) => s;
  private success = (s: string) => s;
  private warning = (s: string) => s;
  private muted = (s: string) => s;

  constructor(
    questions: TQuestion[],
    tui: TUI,
    onDone: (result: QnAResult | null) => void,
    options?: {
      title?: string;
      templates?: QnATemplate[];
      initialResponses?: Array<Partial<QnAResponse>>;
      fallbackAnswers?: string[];
      inferCommittedFromContent?: boolean;
      onResponsesChange?: (responses: QnAResponse[]) => void;
      resolveNumericShortcut?: (
        input: string,
        maxOptionIndex: number,
        usingCustomEditor: boolean,
      ) => number | null;
      applyTemplate?: (template: string, data: QnATemplateData) => string;
      questionSummaryLabel?: (question: TQuestion, index: number) => string;
      accentColor?: (text: string) => string;
      successColor?: (text: string) => string;
      warningColor?: (text: string) => string;
      mutedColor?: (text: string) => string;
      dimColor?: (text: string) => string;
      boldText?: (text: string) => string;
      italicText?: (text: string) => string;
    },
  ) {
    this.questions = questions;
    this.templates = options?.templates ?? [];
    this.responses = normalizeResponses(
      questions,
      options?.initialResponses,
      options?.fallbackAnswers,
      options?.inferCommittedFromContent ?? false,
    );
    this.tui = tui;
    this.onDone = onDone;
    this.onResponsesChange = options?.onResponsesChange;
    this.title = options?.title ?? "Answer Studio";
    this.resolveNumericShortcut =
      options?.resolveNumericShortcut ?? defaultResolveNumericShortcut;
    this.applyTemplate = options?.applyTemplate ?? defaultApplyTemplate;
    this.questionSummaryLabel =
      options?.questionSummaryLabel ??
      ((question) => question.header?.trim() || question.question);
    this.accent = options?.accentColor ?? this.accent;
    this.success = options?.successColor ?? this.success;
    this.warning = options?.warningColor ?? this.warning;
    this.muted = options?.mutedColor ?? this.muted;
    this.dim = options?.dimColor ?? this.dim;
    this.bold = options?.boldText ?? this.bold;
    this.italic = options?.italicText ?? this.italic;

    const editorTheme: EditorTheme = {
      borderColor: this.dim,
      selectList: { matchHighlight: this.accent, itemSecondary: this.muted },
    };

    const { Editor } = PiTui;
    this.editor = new Editor(tui, editorTheme);
    this.editor.disableSubmit = true;
    this.editor.onChange = () => {
      const currentText = this.editor.getText();
      if (currentText !== this.lastEditorText) {
        this.lastEditorText = currentText;
        this.saveCurrentResponse();
        this.invalidate();
        this.tui.requestRender();
      }
    };
    this.loadEditorForCurrentQuestion();
  }

  private getCurrentQuestion(): TQuestion {
    return this.questions[this.currentIndex];
  }
  private shouldUseEditor(index = this.currentIndex): boolean {
    const options = getQuestionOptions(this.questions[index]);
    const response = this.responses[index];
    if (options.length === 0) return true;
    if (response.selectionMode === "multiple") {
      // In multi-select mode, editor is active when 'Other' is toggled
      return response.selectedOptionIndexes.includes(options.length);
    }
    return response.selectedOptionIndex === options.length;
  }
  private getCurrentAnswerText(): string {
    return formatResponseAnswer(
      this.getCurrentQuestion(),
      this.responses[this.currentIndex],
    );
  }
  private getAnswerText(index: number): string {
    return formatResponseAnswer(this.questions[index], this.responses[index]);
  }
  private emitResponseChange(): void {
    this.onResponsesChange?.(cloneResponses(this.responses));
  }

  private isPrintableInput(data: string): boolean {
    return (
      data.length === 1 &&
      data.charCodeAt(0) >= 32 &&
      data.charCodeAt(0) !== 127
    );
  }

  private loadEditorForCurrentQuestion(): void {
    const text = this.shouldUseEditor()
      ? (this.responses[this.currentIndex].customText ?? "")
      : "";
    this.editor.setText(text);
    this.lastEditorText = text;
  }

  private saveCurrentResponse(emit = true): void {
    if (this.shouldUseEditor()) {
      const text = this.editor.getText();
      this.responses[this.currentIndex].customText = text;
      const question = this.questions[this.currentIndex];
      if (getQuestionOptions(question).length === 0 || text.trim().length > 0)
        this.responses[this.currentIndex].selectionTouched = true;
    }
    if (emit) this.emitResponseChange();
  }

  private navigateTo(index: number): void {
    if (index < 0 || index >= this.questions.length) return;
    this.saveCurrentResponse();
    this.currentIndex = index;
    this.showingConfirmation = false;
    this.focusIndex = 0;
    this.loadEditorForCurrentQuestion();
    this.invalidate();
  }

  private navigateTab(delta: number): void {
    if (this.questions.length <= 1) return;
    const nextIndex = this.currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= this.questions.length) return;
    this.navigateTo(nextIndex);
    this.tui.requestRender();
  }

  private toggleMode(): void {
    const response = this.responses[this.currentIndex];
    const question = this.getCurrentQuestion();
    const options = getQuestionOptions(question);
    if (options.length === 0) return; // no options to toggle between modes

    this.saveCurrentResponse(false);

    if (response.selectionMode === "multiple") {
      // Switch to single mode: keep only the first selected option (or other)
      const firstSelected = response.selectedOptionIndexes[0] ?? 0;
      response.selectionMode = "single";
      response.selectedOptionIndex = Math.min(firstSelected, options.length);
      response.selectedOptionIndexes =
        response.selectedOptionIndex > 0 &&
        response.selectedOptionIndex < options.length
          ? [response.selectedOptionIndex]
          : [];
      response.selectionTouched = response.selectedOptionIndex > 0;
    } else {
      // Switch to multiple mode: begin with current selection
      response.selectionMode = "multiple";
      const current = response.selectedOptionIndex;
      response.selectedOptionIndexes =
        current > 0 && current < options.length
          ? [current]
          : current === options.length
            ? [options.length]
            : [];
      response.selectedOptionIndex =
        response.selectedOptionIndexes[
          response.selectedOptionIndexes.length - 1
        ] ?? 0;
      response.selectionTouched =
        response.selectedOptionIndexes.length > 0 ||
        (current === options.length && response.customText.trim().length > 0);
    }

    this.focusIndex = 0;
    this.loadEditorForCurrentQuestion();
    this.emitResponseChange();
    this.invalidate();
    this.tui.requestRender();
  }

  private toggleOption(index: number): void {
    const question = this.getCurrentQuestion();
    const options = getQuestionOptions(question);
    if (options.length === 0) return;
    const normalized = Math.max(0, Math.min(options.length, index));
    const response = this.responses[this.currentIndex];

    this.saveCurrentResponse(false);

    const alreadySelected = response.selectedOptionIndexes.includes(normalized);
    if (alreadySelected) {
      // Remove from selection
      response.selectedOptionIndexes = response.selectedOptionIndexes.filter(
        (i) => i !== normalized,
      );
    } else {
      // Add to selection
      response.selectedOptionIndexes = [
        ...response.selectedOptionIndexes,
        normalized,
      ];
    }

    response.selectedOptionIndex = normalized;
    response.selectionTouched = response.selectedOptionIndexes.length > 0;
    this.loadEditorForCurrentQuestion();
    this.emitResponseChange();
    this.invalidate();
    this.tui.requestRender();
  }

  private selectOption(index: number): void {
    const options = getQuestionOptions(this.getCurrentQuestion());
    if (options.length === 0) return;
    const normalized = Math.max(0, Math.min(options.length, index));
    const currentResponse = this.responses[this.currentIndex];
    if (
      normalized === currentResponse.selectedOptionIndex &&
      currentResponse.selectionTouched
    )
      return;
    this.saveCurrentResponse(false);
    currentResponse.selectedOptionIndex = normalized;
    currentResponse.selectionTouched = true;
    this.loadEditorForCurrentQuestion();
    this.emitResponseChange();
    this.invalidate();
    this.tui.requestRender();
  }

  private applyNextTemplate(): void {
    if (this.templates.length === 0) return;
    const question = this.getCurrentQuestion();
    const options = getQuestionOptions(question);
    if (options.length > 0 && !this.shouldUseEditor())
      this.selectOption(options.length);
    const template = this.templates[this.templateIndex];
    const updated = this.applyTemplate(template.template, {
      question: question.question,
      context: question.context,
      answer: this.getCurrentAnswerText(),
      index: this.currentIndex,
      total: this.questions.length,
    });
    this.editor.setText(updated);
    this.saveCurrentResponse();
    this.templateIndex = (this.templateIndex + 1) % this.templates.length;
    this.invalidate();
    this.tui.requestRender();
  }

  private submit(): void {
    this.saveCurrentResponse();
    const answers = deriveAnswersFromResponses(this.questions, this.responses);
    const parts: string[] = [];
    for (let i = 0; i < this.questions.length; i++) {
      const answer = answers[i] ?? "";
      const hasAnswer = answer.trim().length > 0;
      parts.push(`Q: ${this.questions[i].question}`);
      parts.push(`A: ${hasAnswer ? answer : "(not answered)"}`);
      parts.push("");
    }
    this.onDone({
      text: parts.join("\n").trim(),
      answers,
      responses: cloneResponses(this.responses),
    });
  }

  private cancel(): void {
    this.onDone(null);
  }
  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  handleInput(data: string): void {
    const { Key, matchesKey } = PiTui;
    if (this.showingConfirmation) {
      if (matchesKey(data, Key.enter)) return this.submit();
      if (matchesKey(data, Key.ctrl("c"))) return this.cancel();
      if (matchesKey(data, Key.escape)) {
        this.showingConfirmation = false;
        this.invalidate();
        this.tui.requestRender();
      }
      return;
    }

    if (matchesKey(data, Key.ctrl("c"))) return this.cancel();

    const question = this.getCurrentQuestion();
    const options = getQuestionOptions(question);
    const response = this.responses[this.currentIndex];
    const isMulti = response.selectionMode === "multiple" && options.length > 0;
    const usingEditor = this.shouldUseEditor();

    // Enter must be checked before Ctrl+M, because on most terminals Enter sends \r
    // which is the same ASCII code as Ctrl+M. Checking Enter first ensures it commits
    // and navigates to the next question. Ctrl+M toggles mode only when the terminal
    // sends a distinct sequence (e.g., Kitty keyboard protocol).
    if (matchesKey(data, Key.enter) && !matchesKey(data, Key.shift("enter"))) {
      if (options.length > 0 && !usingEditor && !response.selectionTouched)
        response.selectionTouched = true;
      this.saveCurrentResponse();
      response.committed = true;
      this.emitResponseChange();
      if (this.currentIndex < this.questions.length - 1)
        this.navigateTo(this.currentIndex + 1);
      else this.showingConfirmation = true;
      this.invalidate();
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.ctrl("m"))) return this.toggleMode();
    if (matchesKey(data, Key.ctrl("t"))) return this.applyNextTemplate();
    if (matchesKey(data, Key.ctrl("r"))) {
      this.saveCurrentResponse();
      this.showingConfirmation = true;
      this.invalidate();
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.left)) return this.navigateTab(-1);
    if (matchesKey(data, Key.right)) return this.navigateTab(1);
    if (matchesKey(data, Key.tab)) {
      if (this.currentIndex < this.questions.length - 1) {
        this.navigateTo(this.currentIndex + 1);
        this.tui.requestRender();
      }
      return;
    }
    if (matchesKey(data, Key.shift("tab"))) {
      if (this.currentIndex > 0) {
        this.navigateTo(this.currentIndex - 1);
        this.tui.requestRender();
      }
      return;
    }

    if (isMulti) {
      // Multi-select: up/down moves cursor, space toggles, number keys toggle
      const otherIndex = options.length;
      if (matchesKey(data, Key.up)) {
        this.focusIndex = Math.max(0, this.focusIndex - 1);
        this.invalidate();
        this.tui.requestRender();
        return;
      }
      if (matchesKey(data, Key.down)) {
        this.focusIndex = Math.min(otherIndex, this.focusIndex + 1);
        this.invalidate();
        this.tui.requestRender();
        return;
      }
      // Space toggles the option at cursor
      if (data === " ") {
        this.toggleOption(this.focusIndex);
        return;
      }
      // Number keys toggle options
      if (/^[1-9]$/.test(data)) {
        const idx = Number(data) - 1;
        if (idx <= otherIndex) {
          this.focusIndex = idx;
          this.toggleOption(idx);
        }
        return;
      }
    } else if (options.length > 0) {
      // Single-select: up/down changes selection, number keys select
      const otherIndex = options.length;
      const isOnOther = response.selectedOptionIndex === otherIndex;
      const canSwitchFromCustomInput =
        usingEditor && isOnOther && this.editor.getText().length === 0;
      const allowOptionNavigation = !usingEditor || canSwitchFromCustomInput;
      if (allowOptionNavigation && matchesKey(data, Key.up))
        return this.selectOption(response.selectedOptionIndex - 1);
      if (allowOptionNavigation && matchesKey(data, Key.down))
        return this.selectOption(response.selectedOptionIndex + 1);
      const selectedIndex = this.resolveNumericShortcut(
        data,
        otherIndex,
        usingEditor,
      );
      if (selectedIndex !== null) return this.selectOption(selectedIndex);
    }

    if (this.shouldUseEditor()) {
      this.editor.handleInput(data);
      this.invalidate();
      this.tui.requestRender();
      return;
    }
    if (this.isPrintableInput(data)) {
      if (isMulti) {
        // In multi-select, printable input toggles 'Other' and starts typing
        if (!response.selectedOptionIndexes.includes(options.length)) {
          this.toggleOption(options.length);
        }
        this.focusIndex = options.length;
      } else {
        this.selectOption(options.length);
      }
      this.editor.handleInput(data);
      this.saveCurrentResponse();
      this.invalidate();
      this.tui.requestRender();
    }
  }

  private renderTabs(contentWidth: number): string {
    const { truncateToWidth, visibleWidth } = PiTui;
    const separator = this.dim(" ");
    const tabWidth = Math.max(5, String(this.questions.length).length + 5);
    const makeTab = (index: number): string => {
      const current = index === this.currentIndex;
      const answered = hasResponseContent(
        this.questions[index],
        this.responses[index],
      );
      let status = "○";
      if (answered) status = "✓";
      if (current) status = "◆";

      const raw = ` ${status} ${index + 1} `;
      const clipped = truncateToWidth(raw, tabWidth, "…");
      if (current) return this.accent(this.bold(clipped));
      if (answered) return this.success(clipped);
      return this.dim(clipped);
    };
    const build = (start: number, end: number): string => {
      const parts: string[] = [];
      if (start > 0) parts.push(this.dim("‹"));
      for (let i = start; i <= end; i++) parts.push(makeTab(i));
      if (end < this.questions.length - 1) parts.push(this.dim("›"));
      return parts.join(separator);
    };

    let start = this.currentIndex;
    let end = this.currentIndex;
    let expanded = true;
    while (expanded) {
      expanded = false;
      if (start > 0 && visibleWidth(build(start - 1, end)) <= contentWidth) {
        start -= 1;
        expanded = true;
      }
      if (
        end < this.questions.length - 1 &&
        visibleWidth(build(start, end + 1)) <= contentWidth
      ) {
        end += 1;
        expanded = true;
      }
    }

    return truncateToWidth(build(start, end), contentWidth, "…");
  }

  private renderQuestionBody(contentWidth: number): string[] {
    const { truncateToWidth, wrapTextWithAnsi } = PiTui;
    const lines: string[] = [];
    const question = this.getCurrentQuestion();
    const response = this.responses[this.currentIndex];
    const options = getQuestionOptions(question);
    const usesEditor = this.shouldUseEditor();
    const isMulti = response.selectionMode === "multiple" && options.length > 0;
    if (question.header)
      lines.push(`${this.accent("◆")} ${this.bold(question.header)}`);
    for (const line of wrapTextWithAnsi(
      `${this.bold("Question")} ${question.question}`,
      contentWidth,
    ))
      lines.push(line);
    if (question.context) {
      lines.push("");
      lines.push(this.dim("Context"));
      for (const line of wrapTextWithAnsi(
        this.muted(question.context),
        contentWidth,
      ))
        lines.push(`  ${line}`);
    }
    if (options.length > 0) {
      lines.push("");
      const modeIndicator = isMulti ? this.warning("[M]") : this.dim("[S]");
      lines.push(`${this.dim("Choices")} ${modeIndicator}`);
      for (let i = 0; i <= options.length; i++) {
        const isOther = i === options.length;
        const optionLabel = isOther
          ? "Other / custom answer"
          : options[i].label;
        const description = isOther
          ? "Type your own answer"
          : options[i].description;

        if (isMulti) {
          // Multi-select: checkbox + cursor highlight
          const checked = response.selectedOptionIndexes.includes(i);
          const isFocused = i === this.focusIndex;
          const marker = checked ? this.success("☑") : this.dim("☐");
          const cursor = isFocused ? this.accent("▸") : " ";
          const number = this.dim(`${i + 1}.`);
          let optionText = optionLabel;
          if (checked) {
            optionText = this.success(optionLabel);
          }
          if (isFocused) {
            optionText = this.accent(optionText);
          }
          lines.push(
            truncateToWidth(
              `${cursor}${marker} ${number} ${optionText}`,
              contentWidth,
            ),
          );
          if (checked && description?.trim()) {
            for (const line of wrapTextWithAnsi(
              this.muted(description),
              Math.max(10, contentWidth - 5),
            ))
              lines.push(`     ${line}`);
          }
        } else {
          // Single-select: radio buttons (existing)
          const selected = response.selectedOptionIndex === i;
          const marker = selected ? this.accent("●") : this.dim("○");
          const number = this.dim(`${i + 1}.`);
          let optionText = optionLabel;
          if (selected && response.selectionTouched) {
            optionText = this.success(optionLabel);
          } else if (selected) {
            optionText = this.accent(optionLabel);
          }
          lines.push(
            truncateToWidth(`${marker} ${number} ${optionText}`, contentWidth),
          );
          if (selected && description?.trim()) {
            for (const line of wrapTextWithAnsi(
              this.muted(description),
              Math.max(10, contentWidth - 5),
            ))
              lines.push(`     ${line}`);
          }
        }
      }
    }
    lines.push("");
    lines.push(this.dim("Answer"));
    if (usesEditor) {
      const editorWidth = Math.max(20, contentWidth - 2);
      const editorLines = this.editor.render(editorWidth);
      for (let i = 1; i < editorLines.length - 1; i++)
        lines.push(`  ${editorLines[i]}`);
    } else if (isMulti) {
      // In multi-select without editor, show summary of selected options
      const selectedLabels = response.selectedOptionIndexes
        .filter((i) => i >= 0 && i < options.length)
        .map((i) => options[i].label);
      if (selectedLabels.length > 0) {
        lines.push(`  ${selectedLabels.join(", ")}`);
      } else {
        lines.push(`  ${this.dim("select options with space or number keys")}`);
      }
    } else {
      const selectedLabel = response.selectionTouched
        ? (options[response.selectedOptionIndex]?.label ?? "")
        : this.dim("select an option");
      lines.push(`  ${selectedLabel}`);
    }
    return lines;
  }

  private renderReviewBody(contentWidth: number): string[] {
    const { truncateToWidth, wrapTextWithAnsi } = PiTui;
    const lines: string[] = [];
    lines.push(
      `${this.warning("Review")} ${this.dim("Press Enter to submit, Esc to edit")}`,
    );
    lines.push("");
    for (let i = 0; i < this.questions.length; i++) {
      const summaryLabel = this.questionSummaryLabel(this.questions[i], i);
      const answerText = this.getAnswerText(i);
      const answerPreview =
        answerText.trim().length > 0
          ? this.success(summarizeAnswer(answerText))
          : this.warning("(no answer)");
      lines.push(
        truncateToWidth(
          `${this.bold(`${i + 1}.`)} ${this.accent(summaryLabel)}`,
          contentWidth,
        ),
      );
      for (const line of wrapTextWithAnsi(
        `${this.dim("Answer:")} ${answerPreview}`,
        contentWidth - 2,
      ))
        lines.push(`  ${line}`);
    }
    return lines;
  }

  render(width: number): string[] {
    const { truncateToWidth, visibleWidth } = PiTui;
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const safeWidth = Math.max(24, width);
    const boxWidth = Math.min(Math.max(42, safeWidth), 118);
    const contentWidth = Math.max(18, boxWidth - 4);
    const lines: string[] = [];
    const horizontal = (count: number) => "─".repeat(Math.max(0, count));
    const padAnsi = (line: string, targetWidth: number): string => {
      const clipped = truncateToWidth(line, targetWidth, "…");
      return (
        clipped + " ".repeat(Math.max(0, targetWidth - visibleWidth(clipped)))
      );
    };
    const padOuter = (line: string): string => padAnsi(line, safeWidth);
    const boxLine = (content: string): string => {
      const clipped = truncateToWidth(content, contentWidth, "…");
      return padOuter(
        `${this.dim("│")} ${padAnsi(clipped, contentWidth)} ${this.dim("│")}`,
      );
    };
    const empty = () => boxLine("");

    lines.push(padOuter(this.dim(`╭${horizontal(boxWidth - 2)}╮`)));
    const subtitle = this.showingConfirmation
      ? "review"
      : `${this.currentIndex + 1}/${this.questions.length}`;
    lines.push(boxLine(`${this.bold(this.title)} ${this.dim(subtitle)}`));
    if (!this.showingConfirmation)
      lines.push(boxLine(this.renderTabs(contentWidth)));
    lines.push(padOuter(this.dim(`├${horizontal(boxWidth - 2)}┤`)));

    const body = this.showingConfirmation
      ? this.renderReviewBody(contentWidth)
      : this.renderQuestionBody(contentWidth);
    for (const bodyLine of body)
      lines.push(bodyLine.length === 0 ? empty() : boxLine(bodyLine));

    lines.push(padOuter(this.dim(`├${horizontal(boxWidth - 2)}┤`)));
    const separator = this.accent(" · ");
    const formatHint = (shortcut: string, action: string) =>
      `${this.bold(shortcut)} ${this.italic(action)}`;
    const controls = this.showingConfirmation
      ? [
          formatHint("Enter", "submit"),
          formatHint("Esc", "back"),
          formatHint("Ctrl+C", "cancel"),
        ]
      : [
          formatHint("←/→", "tabs"),
          formatHint("Enter", "commit"),
          formatHint("Ctrl+R", "review"),
          ...(this.templates.length > 0
            ? [formatHint("Ctrl+T", "template")]
            : []),
          ...(getQuestionOptions(this.getCurrentQuestion()).length > 0
            ? [
                formatHint(
                  "Ctrl+M",
                  this.responses[this.currentIndex]?.selectionMode ===
                    "multiple"
                    ? "single"
                    : "multiple",
                ),
              ]
            : []),
          formatHint("Ctrl+C", "cancel"),
        ];
    lines.push(boxLine(controls.join(separator)));
    lines.push(padOuter(this.dim(`╰${horizontal(boxWidth - 2)}╯`)));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}
