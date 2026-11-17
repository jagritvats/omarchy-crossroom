# Crossroom for Omarchy: no build step (QML + one bash launcher).
.PHONY: test validate

test:       ## everything that runs without a desktop (Node 22+, bash)
	node --test tests/*.test.mjs

validate:   ## Omarchy's own manifest validator (run on Omarchy)
	omarchy plugin validate .
