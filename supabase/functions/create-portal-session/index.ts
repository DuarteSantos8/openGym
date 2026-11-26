// Supabase Edge Function "create-portal-session": see ../_shared/handlers.js for what it does and
// supabase/tests/handlers.test.mjs for every path it takes.
import { createPortalSession } from '../_shared/handlers.js'

Deno.serve(req => createPortalSession(req, Deno.env.toObject(), fetch))
