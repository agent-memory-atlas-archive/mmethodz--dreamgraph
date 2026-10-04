# Narrator

> This node represents DreamGraph's narrative synthesis layer for turning cognitive history into a story about how the system's understanding evolved, rather than a raw execution log. The source file states it generates narratives from dream history, tension logs, and validated edges, supports executive, technical, and full depth levels, and can also maintain a persistent accumulated story with diff chapters and auto-narration on dream-cycle completion. It exists to make cognitive activity interpretable to humans by organizing discoveries, resolved tensions, promoted edges, and forgetting/merging behavior into chapter-like epochs. In the neighborhood, it is the concrete implementation depended on by `cognitive_narrator`, reads from `cognitive_engine`-owned cognitive history and tension state, and sits alongside producer/event infrastructure such as `cognitive_producers` and `event_router` for lifecycle integration.

**Table:** `narrator`  
**Storage:** memory  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the narrator. |
| context | object | Current context for narrative generation. |
| output | string | Generated narrative output. |

