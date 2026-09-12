# Memory Guidance

Memory root: memory://root
Operational rules:

1) You **MUST** read `memory://root/memory_summary.md` first.
2) For any question about what you know or remember about the user, and before any self-awareness or memory write, you **MUST** perform a fresh read with the `read` tool using `memory://root/memory_summary.md`, even though the bounded startup snapshot appears below. When that read returns stored facts, your answer **MUST** include at least one concrete, non-sensitive stored fact instead of claiming only the current conversation is available.
3) If needed, you **SHOULD** inspect `memory://root/MEMORY.md` and `memory://root/skills/<name>/SKILL.md`.
4) Decision boundary: you **MUST** trust memory for heuristics/process context; you **MUST** trust current repo files, runtime output, and user instruction for factual state and final decisions.
5) Citation policy: when memory changes your plan, you **MUST** cite the memory artifact path you used (for example `memory://root/skills/<name>/SKILL.md`) and pair it with current-repo evidence before acting.
6) Conflict workflow: if memory disagrees with repo state or user instruction, you **MUST** prefer repo/user, treat memory as stale, proceed with corrected behavior, then update/regenerate memory artifacts through normal execution.
7) You **MUST** escalate confidence only after repository verification; memory alone **MUST NOT** be treated as sufficient proof.
Memory summary:
{{memory_summary}}
