# CityWithLifeGrok — Agent Integration Guide

This guide helps when sub-agent work is ready to be reviewed and merged into the main branch.

## When an Agent Finishes

The sub-agent should provide:
1. Clear summary of what was built
2. List of new/changed files
3. New or updated tests (required for most features)
4. Any breaking changes or integration notes
5. Suggested next steps

## Integration Checklist (for Orchestrator)

- [ ] All new code has reasonable test coverage
- [ ] Existing tests still pass (`npm run test:run`)
- [ ] New system follows the "Simulation Core is Sacred" principle (no direct DOM/rendering logic)
- [ ] New classes have `getSnapshot()` or similar for observability
- [ ] Changes are documented in `ARCHITECTURE.md` if architecture-level
- [ ] No major duplication with work from other agents (check AGENTS.md)
- [ ] The feature can be toggled or isolated if risky

## Current Parallel Tracks (see AGENTS.md for latest)

- Resident Inspector UI
- Resident Needs & Behavior
- Business Entity Foundation
- Spatial World / Locations
- Canvas Rendering Improvements
- Testing & Validation

## Communication

- Main orchestrator reviews all agent output before merging.
- Significant design disagreements should be noted and escalated.

Last updated: During full autonomous multi-agent run
