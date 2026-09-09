# REPAIR REQUEST

Your previous answer was rejected by the app's validator. It was never shown to anyone, and this is the only retry — if this answer also fails, the job is reported to the user as failed.

## What you sent

```
{{PREVIOUS}}
```

## What was wrong

{{ERRORS}}

## What to do

Send the **whole answer again**, corrected, in the schema from the original task. Not a patch, not an apology, not an explanation — one JSON object and nothing else.

Common causes, in the order they usually apply:

- An exercise `id` that is not in the `library` array of the payload. Every id must be copied from there. If nothing in the library fits, choose the closest thing that does rather than inventing one.
- A `type` outside the allowed list, or a `target` naming a routine or exercise that is not in the plan.
- A value of the wrong kind — a string where a number belongs, an object where a plain value belongs.
- A missing `why`. Every change needs one.
