# Diagrams

A flowchart diagram:

```mermaid
graph TD
  A[Start] --> B{Choice}
  B -->|yes| C[Proceed]
  B -->|no| D[Stop]
```

An invalid diagram must fall back to its code block:

```mermaid
@@@ this is not a valid mermaid diagram @@@
```

فقرة عربية حول المخطط أعلاه للتأكد من بقاء المخطط من اليسار إلى اليمين.
