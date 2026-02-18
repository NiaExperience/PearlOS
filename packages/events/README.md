# @nia/events

Auto-generated event IDs shared across TypeScript and Python.

- Source: `descriptors/events.json`
- TS Output: `src/generated/events.ts` exporting `EventIds` (const list), `EventId` (type), and `EventEnum` (enum)
- Python Output: `python/nia_events/events.py` exporting `EVENT_IDS` (list) and `EventId` (Enum)

Regenerate:

- Build once: `npm run build --workspace @nia/events`
- Watch in dev: `npm run dev --workspace @nia/events`

Python usage:

```python
from nia_events import EventId, EVENT_IDS
print(EventId.BOT_CONVERSATION_WRAPUP.value)
```

TypeScript usage:

```ts
import { EventEnum, EventIds, EventId } from '@nia/events';
const e: EventId = EventEnum.BOT_CONVERSATION_WRAPUP;
```
# @nia/events

Descriptor-driven event catalog with codegen.

- Edit descriptors in `descriptors/events.json`.
- Run package build to generate `src/generated/events.ts` and emit types into `dist/`.

Consumed by Dashboard (Personality panel) and Bot.
