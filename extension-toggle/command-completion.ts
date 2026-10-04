import { getKeybindings, type AutocompleteProvider, type EditorComponent } from "@earendil-works/pi-tui";

const hook = Symbol.for("pi-extension-toggle.command-completion");
const argumentContext = /^\/extension-toggle\s/;

type CompletionMethods = {
  handleInput: EditorComponent["handleInput"];
  setProvider: NonNullable<EditorComponent["setAutocompleteProvider"]>;
};

function isCompletionMethods(value: unknown): value is CompletionMethods {
  return value !== null && typeof value === "object" &&
    "handleInput" in value && typeof value.handleInput === "function" &&
    "setProvider" in value && typeof value.setProvider === "function";
}

// Pi closes its dropdown after a completion.
export function withExtensionToggleCompletion<T extends EditorComponent>(editor: T): T {
  const stored: unknown = Reflect.get(editor, hook);
  const hasOriginals = isCompletionMethods(stored);
  const methods = hasOriginals ? stored : {
    handleInput: editor.handleInput.bind(editor),
    setProvider: editor.setAutocompleteProvider?.bind(editor),
  };
  const { handleInput, setProvider } = methods;
  if (!setProvider) return editor;
  if (!hasOriginals) Object.defineProperty(editor, hook, { value: methods });

  editor.setAutocompleteProvider = (provider: AutocompleteProvider) => {
    setProvider({
      getSuggestions(lines, line, col, options) {
        return provider.getSuggestions(lines, line, col,
          argumentContext.test((lines[line] ?? "").slice(0, col)) ? { ...options, force: false } : options);
      },
      applyCompletion: (lines, line, col, item, prefix) =>
        provider.applyCompletion(lines, line, col, item, prefix),
      shouldTriggerFileCompletion: (lines, line, col) =>
        argumentContext.test((lines[line] ?? "").slice(0, col)) || (provider.shouldTriggerFileCompletion?.(lines, line, col) ?? true),
    });
  };
  editor.handleInput = data => {
    const before = editor.getText();
    handleInput(data);
    if (getKeybindings().matches(data, "tui.input.tab") && before !== editor.getText() && /^\/extension-toggle\s+(?:use\s+)?$/.test(editor.getText())) {
      handleInput(data);
    }
  };
  return editor;
}
