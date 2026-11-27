// Supabase Edge Function "entitlement-token": see ../_shared/handlers.js for what it does and
// supabase/tests/handlers.test.mjs for every path it takes.
import { entitlementToken } from '../_shared/handlers.js'

Deno.serve(req => entitlementToken(req, Deno.env.toObject(), fetch))
