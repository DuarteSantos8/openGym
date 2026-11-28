// Supabase Edge Function "create-checkout-session": see ../_shared/handlers.js for what it does and
// supabase/tests/handlers.test.mjs for every path it takes.
import { createCheckoutSession } from '../_shared/handlers.js'

Deno.serve(req => createCheckoutSession(req, Deno.env.toObject(), fetch))
