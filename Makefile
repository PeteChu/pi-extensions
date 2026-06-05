EXTENSIONS := ai-commit answer extension-toggle package-usage code-wiki rewrite retro
TSC_FLAGS := --noEmit --target ES2022 --module ESNext --moduleResolution bundler --strict --skipLibCheck

.PHONY: help typecheck test check typecheck-all test-all check-all require-ext

help:
	@echo "Targets:"
	@echo "  make typecheck EXT=answer  Type-check one extension"
	@echo "  make test EXT=answer       Test one extension"
	@echo "  make check EXT=answer      Type-check and test one extension"
	@echo "  make typecheck-all         Type-check all extensions"
	@echo "  make test-all              Test all extensions"
	@echo "  make check-all             Type-check and test all extensions"

require-ext:
	@if [ -z "$(EXT)" ]; then \
		echo "EXT is required. Example: make check EXT=answer"; \
		exit 2; \
	fi
	@if [ ! -d "$(EXT)" ]; then \
		echo "Extension directory not found: $(EXT)"; \
		exit 2; \
	fi

typecheck: require-ext
	@echo "Type-checking $(EXT)..."
	@files=$$(find "$(EXT)" -name '*.ts' -print); \
	if [ -z "$$files" ]; then \
		echo "No TypeScript files found in $(EXT)"; \
		exit 2; \
	fi; \
	pnpm exec tsc $(TSC_FLAGS) $$files

test: require-ext
	@echo "Testing $(EXT)..."
	@pnpm --dir "$(EXT)" test

check: typecheck test

typecheck-all:
	@for ext in $(EXTENSIONS); do \
		$(MAKE) --no-print-directory typecheck EXT=$$ext || exit $$?; \
	done

test-all:
	@for ext in $(EXTENSIONS); do \
		$(MAKE) --no-print-directory test EXT=$$ext || exit $$?; \
	done

check-all:
	@for ext in $(EXTENSIONS); do \
		$(MAKE) --no-print-directory check EXT=$$ext || exit $$?; \
	done
